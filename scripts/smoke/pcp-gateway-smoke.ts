#!/usr/bin/env -S npx tsx
/**
 * Real-HTTP smoke test of the payment + OTP-provider flows against a RUNNING server whose gateway
 * base URLs point at protocol-accurate local mocks (see tests/helpers/mock-gateways.ts / mock-otp.ts).
 * The server is the production BUILD started with NODE_ENV=staging (production guards intentionally
 * off so the mock base URLs are honoured — in production they are ignored by design).
 *
 * What this proves: the real adapters, BFF, routes, database and jobs behave correctly end to end.
 * What it cannot prove: that the real Razorpay / PhonePe / Fast2SMS services accept the credentials.
 */
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { startMockPhonePe, startMockRazorpay } from "../../tests/helpers/mock-gateways";
import { codeFromMail, startMockFast2Sms, startMockSmtp } from "../../tests/helpers/mock-otp";
import { Client, assertNoSecretsSeen, check, finish, sleep } from "./lib";

const env = process.env;
const SECRETS = (env.SMOKE_SECRETS ?? "").split(",").filter(Boolean);
const CRON = env.CRON_SECRET as string;
const PW = "Smoke#Pass-12345";
const RZ = { keyId: "rzp_test_SmokeKey0001", keySecret: "smoke-rzp-secret-AAAA1111", webhookSecret: "smoke-rzp-webhook-BBBB2222" };
const PP = { clientId: "smoke-pp-client", clientSecret: "smoke-pp-secret-CCCC3333", clientVersion: "1", webhookUsername: "smokeppuser", webhookPassword: "smoke-pp-webhook-DDDD4444" };
SECRETS.push(RZ.keySecret, RZ.webhookSecret, PP.clientSecret, PP.webhookPassword);

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const smtp = await startMockSmtp({ user: env.SMTP_USER as string, pass: env.SMTP_PASS as string }, Number(env.SMTP_PORT));
  const f2s = await startMockFast2Sms(env.FAST2SMS_API_KEY as string, 45873);
  const rzp = await startMockRazorpay({ keyId: RZ.keyId, keySecret: RZ.keySecret }, 45871);
  const pp = await startMockPhonePe({ clientId: PP.clientId, clientSecret: PP.clientSecret, clientVersion: PP.clientVersion }, 45872);
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const anon = new Client("anon");
  const planPrice = Number((await db.query("select price_in_paise p from membership_plans where code = 'PLAN_MONTHLY_INR'")).rows[0].p);

  // ---------------------------------------------------------------- admin bootstrap
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  check("G0 bootstrap Super Admin", boot.status === 0 && tempPw.length === 16);
  const owner = new Client("owner");
  await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  let r = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: PW });
  check("G0b first password change", r.status === 200);

  // ---------------------------------------------------------------- member helper (real SMTP relay)
  let n = 0;
  async function signup(tag: string) {
    n += 1;
    const c = new Client(tag);
    const email = `${tag}@smoke.example`;
    let x = await c.post("/bff/auth/register", { name: `Smoke ${tag}`, email, mobileNumber: String(9876500000 + n), countryCode: "+91" });
    if (x.status >= 300) throw new Error(`register ${tag}: ${x.status} ${x.text.slice(0, 160)}`);
    await sleep(250);
    const mail = [...smtp.mails].reverse().find((m) => m.to.includes(email));
    x = await c.post("/bff/auth/verify-signup-otp", { identifier: email, code: codeFromMail(mail!.text) });
    const ticket = x.data?.ticket ?? x.data?.setPasswordTicket ?? (Object.values(x.data ?? {})[0] as string);
    x = await c.post("/bff/auth/set-password", { identifier: email, ticket, password: PW });
    if (x.status >= 300) throw new Error(`set-password ${tag}: ${x.status} ${x.text.slice(0, 160)}`);
    await c.post("/bff/profiles/me", { gender: n % 2 ? "FEMALE" : "MALE", dateOfBirth: "1995-03-02" });
    const me = await c.get("/bff/users/me");
    return { c, email, id: me.data?.user?.id as string };
  }
  const payRow = async (id: string) => (await db.query("select status, amount_in_paise a, gateway_reference ref, membership_id from payments where id = $1", [id])).rows[0];
  const membershipStatus = async (id: string) => (await db.query("select status from memberships where id = $1", [id])).rows[0]?.status;
  const invoicesFor = async (id: string) => (await db.query("select count(*)::int n from invoices where payment_id = $1", [id])).rows[0].n;

  // ---------------------------------------------------------------- payment admin: credentials + test connection + switch
  r = await owner.put("/bff/admin/payments/config/razorpay/credentials", { mode: "test", keyId: RZ.keyId, keySecret: RZ.keySecret, webhookSecret: RZ.webhookSecret });
  check("G1 save Razorpay credentials (200, response has no secret)", r.status === 200 && !r.text.includes(RZ.keySecret), r.text.slice(0, 200));
  r = await owner.post("/bff/admin/payments/config/razorpay/test-connection");
  check("G2 Razorpay test-connection → ok against the mock (read-only call made with Basic auth)", r.status === 200 && r.data?.ok === true && rzp.requests.some((q) => q.method === "GET" && q.path.startsWith("/v1/orders")), r.text.slice(0, 200));
  r = await owner.put("/bff/admin/payments/config/phonepe/credentials", { mode: "test", clientId: PP.clientId, clientSecret: PP.clientSecret, clientVersion: PP.clientVersion, webhookUsername: PP.webhookUsername, webhookPassword: PP.webhookPassword });
  check("G3 save PhonePe credentials (200, no secret in response)", r.status === 200 && !r.text.includes(PP.clientSecret) && !r.text.includes(PP.webhookPassword), r.text.slice(0, 200));
  r = await owner.post("/bff/admin/payments/config/phonepe/test-connection");
  check("G4 PhonePe test-connection → ok against the mock (OAuth token issued)", r.status === 200 && r.data?.ok === true && pp.tokensIssued >= 1, r.text.slice(0, 200));
  r = await owner.put("/bff/admin/payments/config/razorpay/credentials", { mode: "test", keyId: RZ.keyId, keySecret: "wrong-secret-xxxxxxxx" });
  const bad = await owner.post("/bff/admin/payments/config/razorpay/test-connection");
  check("G5 a wrong saved secret makes test-connection report failure honestly", bad.status === 200 && bad.data?.ok === false, bad.text.slice(0, 200));
  await owner.put("/bff/admin/payments/config/razorpay/credentials", { mode: "test", keyId: RZ.keyId, keySecret: RZ.keySecret });
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "RAZORPAY" });
  check("G6 activate Razorpay", r.status === 200 && r.data?.gateways?.filter((g: any) => g.isActive).length === 1 && r.data?.activeGateway === "RAZORPAY", r.text.slice(0, 200));

  // ---------------------------------------------------------------- Razorpay end to end
  const m1 = await signup("rzpmember1");
  r = await m1.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR", amountInPaise: 1, amount: 1 });
  const clientAmountRefused = r.status === 400;
  if (clientAmountRefused) r = await m1.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR" });
  const gw = r.data?.gatewayCheckout;
  check("RZ1 checkout → Razorpay hand-off with public values only (key id, order id, server-side amount)", r.status < 300 && gw?.provider === "RAZORPAY" && gw.keyId === RZ.keyId && gw.amount === planPrice && !r.text.includes(RZ.keySecret), r.text.slice(0, 240));
  check("RZ2 a client-supplied amount is never trusted (refused, or ignored: DB amount is the plan price)", (await payRow(r.data.paymentId)).a === planPrice, `client amount ${clientAmountRefused ? "refused with 400" : "ignored"}`);
  const rzOrder = rzp.orders.get(gw.orderId);
  check("RZ3 the order at the gateway has the plan amount", rzOrder?.amount === planPrice && rzOrder?.currency === "INR");
  const pay1 = r.data.paymentId as string;
  r = await m1.c.post(`/bff/payments/${pay1}/razorpay/confirm`, { razorpay_payment_id: "pay_FORGED00001", razorpay_order_id: gw.orderId, razorpay_signature: "a".repeat(64) });
  check("RZ4 a forged signature is refused and the payment stays PENDING", r.status >= 400 && (await payRow(pay1)).status === "PENDING", String(r.status));
  const rzPayId = rzp.capture(gw.orderId);
  const sig = createHmac("sha256", RZ.keySecret).update(`${gw.orderId}|${rzPayId}`).digest("hex");
  r = await m1.c.post(`/bff/payments/${pay1}/razorpay/confirm`, { razorpay_payment_id: rzPayId, razorpay_order_id: gw.orderId, razorpay_signature: sig });
  check("RZ5 valid signature + captured payment at the gateway → SUCCESS", r.status === 200 && (await payRow(pay1)).status === "SUCCESS", r.text.slice(0, 200));
  check("RZ6 membership is ACTIVE and exactly one invoice exists", (await membershipStatus((await payRow(pay1)).membership_id)) === "ACTIVE" && (await invoicesFor(pay1)) === 1);
  r = await m1.c.post(`/bff/payments/${pay1}/razorpay/confirm`, { razorpay_payment_id: rzPayId, razorpay_order_id: gw.orderId, razorpay_signature: sig });
  check("RZ7 confirming twice is idempotent (no second invoice)", r.status === 200 && (await invoicesFor(pay1)) === 1, r.text.slice(0, 120));
  const other = await signup("rzpmember1b");
  r = await other.c.post(`/bff/payments/${pay1}/razorpay/confirm`, { razorpay_payment_id: rzPayId, razorpay_order_id: gw.orderId, razorpay_signature: sig });
  check("RZ8 another member cannot confirm someone else's payment (IDOR → 403/404)", r.status === 403 || r.status === 404, String(r.status));
  r = await other.c.get(`/bff/payments/${pay1}`);
  check("RZ9 another member cannot read someone else's payment (403/404)", r.status === 403 || r.status === 404, String(r.status));

  // webhooks
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: rzPayId, order_id: gw.orderId, status: "captured" } } } });
  const whSig = (b: string, secret = RZ.webhookSecret) => createHmac("sha256", secret).update(b).digest("hex");
  const wh = (b: string, signature: string, eventId: string) => anon.post("/api/v1/webhooks/razorpay", b, { raw: true, noOrigin: true, headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } });
  r = await wh(body, whSig(body, "wrong-webhook-secret"), "evt_smoke_1");
  check("RZ10 webhook with a wrong signature → 401", r.status === 401, String(r.status));
  r = await wh(body, whSig(body), "evt_smoke_1");
  check("RZ11 webhook with a valid signature → 200", r.status === 200, r.text.slice(0, 160));
  r = await wh(body, whSig(body), "evt_smoke_1");
  check("RZ12 replaying the same event id → DUPLICATE, nothing changes", r.status === 200 && r.data?.outcome === "DUPLICATE" && (await invoicesFor(pay1)) === 1, r.text.slice(0, 160));
  const whRows = (await db.query("select count(*)::int n from payment_webhook_events where provider = 'RAZORPAY' and event_id = 'evt_smoke_1'")).rows[0].n;
  check("RZ13 exactly one idempotency row for that event id", whRows === 1, String(whRows));

  // tampered amount
  const m2 = await signup("rzpmember2");
  r = await m2.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR" });
  const gw2 = r.data.gatewayCheckout;
  const pay2 = r.data.paymentId as string;
  const rzPay2 = rzp.capture(gw2.orderId, { amount: 100 });
  const sig2 = createHmac("sha256", RZ.keySecret).update(`${gw2.orderId}|${rzPay2}`).digest("hex");
  r = await m2.c.post(`/bff/payments/${pay2}/razorpay/confirm`, { razorpay_payment_id: rzPay2, razorpay_order_id: gw2.orderId, razorpay_signature: sig2 });
  const row2 = await payRow(pay2);
  check("RZ14 a captured payment for the WRONG amount never activates a membership", row2.status !== "SUCCESS" && (await membershipStatus(row2.membership_id)) !== "ACTIVE", `${r.status} ${row2.status}`);

  // refund
  rzp.newRefundStatus = "processed";
  r = await owner.post(`/bff/admin/payments/${pay1}/refunds`, { reason: "Smoke full refund" });
  check("RF1 admin full refund → 201 and the gateway received exactly one refund call", r.status === 201 && rzp.requests.filter((q) => q.method === "POST" && /\/refund/.test(q.path)).length === 1, r.text.slice(0, 200));
  check("RF2 payment is REFUNDED and the invoice VOID", (await payRow(pay1)).status === "REFUNDED" && (await db.query("select status from invoices where payment_id = $1", [pay1])).rows[0].status === "VOID");
  r = await owner.post(`/bff/admin/payments/${pay1}/refunds`, { reason: "Smoke double refund" });
  check("RF3 a second refund of the same payment is refused (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  r = await owner.get(`/bff/admin/payments/${pay1}/refunds`);
  check("RF4 refund history lists one processed refund and zero refundable", r.status === 200 && r.data?.refunds?.length === 1 && r.data?.refundableInPaise === 0, r.text.slice(0, 200));
  r = await m1.c.post(`/bff/admin/payments/${pay1}/refunds`, { reason: "member trying" });
  check("RF5 a member cannot refund (401/403)", r.status === 401 || r.status === 403, String(r.status));

  // ---------------------------------------------------------------- switch to PhonePe
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "PHONEPE" });
  const active = (await db.query("select name from payment_gateways where is_active")).rows.map((x) => x.name);
  check("SW1 switch to PhonePe: Razorpay is no longer active, exactly one gateway active", r.status === 200 && active.length === 1 && /PhonePe/.test(active[0]), JSON.stringify(active));
  const m3 = await signup("ppmember3");
  r = await m3.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR" });
  const ppGw = r.data?.gatewayCheckout;
  const pay3 = r.data?.paymentId as string;
  const merchantOrder = (await payRow(pay3)).ref as string;
  check("PP1 checkout now goes to PhonePe: https redirect URL only, order amount = plan price at the gateway", r.status < 300 && ppGw?.provider === "PHONEPE" && /^https:\/\//.test(ppGw.redirectUrl) && pp.orders.get(merchantOrder)?.amount === planPrice && !r.text.includes(PP.clientSecret), r.text.slice(0, 240));
  const ppAuth = sha256hex(`${PP.webhookUsername}:${PP.webhookPassword}`);
  const ppHook = (payload: unknown, auth: string) => anon.post("/api/v1/webhooks/phonepe", JSON.stringify(payload), { raw: true, noOrigin: true, headers: { "content-type": "application/json", authorization: auth } });
  const completed = { event: "checkout.order.completed", payload: { merchantOrderId: merchantOrder, state: "COMPLETED", amount: planPrice } };
  r = await ppHook(completed, "b".repeat(64));
  check("PP2 PhonePe webhook with wrong credentials → 401", r.status === 401, String(r.status));
  r = await ppHook(completed, ppAuth);
  check("PP3 an authenticated webhook that claims COMPLETED cannot activate while PhonePe still says PENDING", r.status === 200 && (await payRow(pay3)).status === "PENDING", r.text.slice(0, 160));
  pp.setOrderState(merchantOrder, "COMPLETED");
  r = await ppHook({ ...completed, payload: { ...completed.payload, note: "second delivery" } }, `SHA256 ${ppAuth}`);
  check("PP4 once PhonePe reports COMPLETED the webhook activates the membership", r.status === 200 && (await payRow(pay3)).status === "SUCCESS" && (await invoicesFor(pay3)) === 1, r.text.slice(0, 160));
  r = await ppHook({ ...completed, payload: { ...completed.payload, note: "second delivery" } }, ppAuth);
  check("PP5 an exact replay is DUPLICATE", r.status === 200 && r.data?.outcome === "DUPLICATE", r.text.slice(0, 160));
  r = await m3.c.post(`/bff/payments/${pay3}/verify`);
  check("PP6 the return-page verify call is idempotent (no second invoice)", r.status === 200 && (await invoicesFor(pay3)) === 1, r.text.slice(0, 160));
  // old Razorpay payments are unaffected by the switch
  r = await m1.c.get(`/bff/payments/${pay1}`);
  check("PP7 payments created under Razorpay stay readable after switching to PhonePe", r.status === 200, String(r.status));

  // ---------------------------------------------------------------- reconciliation job
  const m4 = await signup("ppmember4");
  r = await m4.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR" });
  const pay4 = r.data.paymentId as string;
  pp.setOrderState((await payRow(pay4)).ref, "COMPLETED");
  const m5 = await signup("ppmember5");
  r = await m5.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR" });
  const pay5 = r.data.paymentId as string;
  const m6 = await signup("ppmember6");
  r = await m6.c.post("/bff/memberships/checkout", { planCode: "PLAN_MONTHLY_INR" });
  const pay6 = r.data.paymentId as string;
  await db.query("update payments set created_at = now() - interval '20 minutes' where id = $1", [pay4]);
  await db.query("update payments set created_at = now() - interval '3 hours' where id = $1", [pay5]);
  await db.query("update payments set created_at = now() - interval '3 hours' where id = $1", [pay6]);
  const jobRes = await anon.post("/api/v1/internal/jobs/payment-reconcile", {}, { noOrigin: true, headers: { authorization: `Bearer ${CRON}` } });
  check("JB1 payment-reconcile over HTTP → 200", jobRes.status === 200 && /SUCCEEDED/.test(jobRes.text), jobRes.text.slice(0, 240));
  check("JB2 a paid-but-unreported PhonePe order is completed by the job (SUCCESS + invoice)", (await payRow(pay4)).status === "SUCCESS" && (await invoicesFor(pay4)) === 1);
  check("JB3 an unpaid order older than the expiry is closed as FAILED only after the gateway confirmed it is unpaid", (await payRow(pay5)).status === "FAILED");
  const second = await anon.post("/api/v1/internal/jobs/payment-reconcile", {}, { noOrigin: true, headers: { authorization: `Bearer ${CRON}` } });
  check("JB4 running the job again changes nothing (idempotent)", second.status === 200 && (await invoicesFor(pay4)) === 1 && (await payRow(pay4)).status === "SUCCESS");
  // gateway outage must NOT close payments
  await pp.close();
  await db.query("update payments set status = 'PENDING' where id = $1", [pay6]);
  const outage = await anon.post("/api/v1/internal/jobs/payment-reconcile", {}, { noOrigin: true, headers: { authorization: `Bearer ${CRON}` } });
  check("JB5 while the gateway is unreachable the job leaves PENDING payments untouched (never closes on an error)", outage.status === 200 && (await payRow(pay6)).status === "PENDING", `${outage.status} ${(await payRow(pay6)).status}`);

  // ---------------------------------------------------------------- OTP provider switching with an in-flight code
  r = await owner.get("/bff/admin/otp/provider");
  check("OT1 both providers report configured; EMAIL is active", r.status === 200 && r.data.providers.every((p: any) => p.configured) && r.data.activeProvider === "EMAIL", r.text.slice(0, 300));
  const a = new Client("otpA");
  const emailA = "otp.a@smoke.example";
  await a.post("/bff/auth/register", { name: "OTP A", email: emailA, mobileNumber: "9876511111", countryCode: "+91" });
  await sleep(250);
  const mailA = [...smtp.mails].reverse().find((m) => m.to.includes(emailA));
  check("OT2 under EMAIL the code is sent by e-mail and nothing goes to Fast2SMS", !!mailA && f2s.calls.length === 0);
  r = await owner.patch("/bff/admin/otp/provider", { activeProvider: "FAST2SMS_SMS" });
  check("OT3 switch to Fast2SMS → 200 (single atomic change)", r.status === 200 && r.data?.activeProvider === "FAST2SMS_SMS", r.text.slice(0, 200));
  r = await a.post("/bff/auth/verify-signup-otp", { identifier: emailA, code: codeFromMail(mailA!.text) });
  check("OT4 the code issued BEFORE the switch still verifies after it", r.status === 200, r.text.slice(0, 160));
  const b = new Client("otpB");
  const emailB = "otp.b@smoke.example";
  const before = smtp.mails.length;
  r = await b.post("/bff/auth/register", { name: "OTP B", email: emailB, mobileNumber: "9876522222", countryCode: "+91" });
  const idB = (r.data?.identifier as string) ?? emailB; // under SMS the sign-up identifier is the mobile number, as the API tells the client
  await sleep(250);
  const call = f2s.calls[f2s.calls.length - 1];
  check("OT5 under SMS the code goes to Fast2SMS with the documented request and no e-mail is sent", r.status < 300 && !!call && call.headers.authorization === env.FAST2SMS_API_KEY && call.body.mobile === "9876522222" && call.body.otp_id === "smoke-otp-id" && smtp.mails.length === before, JSON.stringify(call?.body));
  const smsCode = String(call?.body.otp);
  r = await b.post("/bff/auth/reset-password", { email: emailB, code: smsCode, newPassword: "Another#Pass-12345" });
  check("OT6 a SIGNUP code cannot be used for another purpose (reset-password refused)", r.status >= 400 && r.status < 500, String(r.status));
  r = await b.post("/bff/auth/verify-signup-otp", { identifier: idB, code: smsCode });
  check("OT7 the SMS code verifies for SIGNUP (identifier = the mobile number returned by register)", r.status === 200, r.text.slice(0, 160));
  f2s.failNext = { status: 500 };
  const c = new Client("otpC");
  r = await c.post("/bff/auth/register", { name: "OTP C", email: "otp.c@smoke.example", mobileNumber: "9876533333", countryCode: "+91" });
  check("OT8 a Fast2SMS outage gives an honest 503 (no fake delivery)", r.status === 503, `${r.status} ${r.text.slice(0, 120)}`);
  r = await owner.patch("/bff/admin/otp/provider", { activeProvider: "EMAIL" });
  check("OT9 switch back to EMAIL", r.status === 200 && r.data?.activeProvider === "EMAIL");
  const logs = (await db.query("select count(*)::int n from audit_logs where action = 'otp_config.provider_switched'")).rows[0].n;
  check("OT10 both switches are audited", logs === 2, String(logs));

  // ---------------------------------------------------------------- finish
  assertNoSecretsSeen(SECRETS);
  const dump = (await db.query("select config::text c from payment_gateways")).rows.map((x) => x.c).join("");
  check("Z1 no gateway secret is stored in plaintext in the database", ![RZ.keySecret, RZ.webhookSecret, PP.clientSecret, PP.webhookPassword].some((s) => dump.includes(s)));
  await Promise.all([smtp.close(), f2s.close(), rzp.close()]);
  await db.end();
  finish("PCP gateway-flow HTTP smoke");
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(2);
});
