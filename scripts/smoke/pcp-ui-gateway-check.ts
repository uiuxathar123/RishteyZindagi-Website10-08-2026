/**
 * Browser (Chromium) check of the payment screens added in the production-completion phase.
 *
 * What this DOES prove: our checkout page, hand-off code, payment-return page and the admin refund drawer work in a
 * real browser against the production build and the local mock gateways (same wire format as the vendors' docs),
 * that the member's browser only ever receives public values, and that the server — not the page — decides success.
 *
 * What this does NOT prove: Razorpay's own popup (checkout.js) and PhonePe's hosted page are never rendered. The
 * Razorpay popup is replaced by a stub that returns a validly signed response; the PhonePe page is replaced by a
 * static placeholder. REQUIRES EXTERNAL CREDENTIALS / NOT VERIFIED against the real vendors.
 *
 * Playwright is not a dependency of this repository (see pcp-ui-check.ts for how to supply it).
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { startMockSmtp, codeFromMail } from "../../tests/helpers/mock-otp";
import { startMockRazorpay, startMockPhonePe } from "../../tests/helpers/mock-gateways";
import { BASE, Client, check, finish, sleep } from "./lib";

const env = process.env;
const SHOTS = env.SMOKE_SHOTS_DIR ?? "/tmp/rz-ui-shots";
mkdirSync(SHOTS, { recursive: true });
const PW = "Smoke#Pass-12345";
const ADMIN_PW = "Owner#Pass-123456";
const RZ = { keyId: "rzp_test_UiGatewayKey1", keySecret: "ui-gw-rzp-secret-AAAA1111", webhookSecret: "ui-gw-rzp-webhook-BBBB2222" };
const PP = { clientId: "ui-gw-pp-client", clientSecret: "ui-gw-pp-secret-CCCC3333", clientVersion: "1", webhookUsername: "uigwppuser", webhookPassword: "ui-gw-pp-webhook-DDDD4444" };

async function loadChromium(): Promise<any> {
  const mod: any = await import(env.PLAYWRIGHT_MODULE ?? "playwright");
  return mod.chromium ?? mod.default?.chromium; // untyped on purpose: Playwright is not a dependency of this repo
}

let livePage: any = null;

async function main() {
  const chromium = await loadChromium();
  const smtp = await startMockSmtp({ user: env.SMTP_USER as string, pass: env.SMTP_PASS as string }, Number(env.SMTP_PORT));
  const rzp = await startMockRazorpay({ keyId: RZ.keyId, keySecret: RZ.keySecret }, 45871);
  const pp = await startMockPhonePe({ clientId: PP.clientId, clientSecret: PP.clientSecret, clientVersion: PP.clientVersion }, 45872);
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const planCode = "PLAN_MONTHLY_INR";
  const planPrice = Number((await db.query("select price_in_paise p from membership_plans where code = $1", [planCode])).rows[0].p);

  // ---- fixtures through the API ----------------------------------------------------------------------------
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  check("GW0 Super Admin bootstrapped", boot.status === 0 && tempPw.length === 16);
  const owner = new Client("owner");
  await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  let r = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: ADMIN_PW });
  check("GW0b first password change", r.status === 200);
  r = await owner.put("/bff/admin/payments/config/razorpay/credentials", { mode: "test", keyId: RZ.keyId, keySecret: RZ.keySecret, webhookSecret: RZ.webhookSecret });
  check("GW0c Razorpay credentials saved", r.status === 200);
  r = await owner.put("/bff/admin/payments/config/phonepe/credentials", { mode: "test", clientId: PP.clientId, clientSecret: PP.clientSecret, clientVersion: PP.clientVersion, webhookUsername: PP.webhookUsername, webhookPassword: PP.webhookPassword });
  check("GW0d PhonePe credentials saved", r.status === 200);
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "RAZORPAY" });
  check("GW0e Razorpay activated", r.status === 200);

  let n = 0;
  async function member(tag: string) {
    n += 1;
    const c = new Client(tag);
    const email = `${tag}@smoke.example`;
    let x = await c.post("/bff/auth/register", { name: `Gw ${tag}`, email, mobileNumber: String(9876600000 + n), countryCode: "+91" });
    await sleep(300);
    const mail = [...smtp.mails].reverse().find((m) => m.to.includes(email));
    x = await c.post("/bff/auth/verify-signup-otp", { identifier: email, code: codeFromMail(mail!.text) });
    const ticket = x.data?.ticket ?? x.data?.setPasswordTicket ?? (Object.values(x.data ?? {})[0] as string);
    x = await c.post("/bff/auth/set-password", { identifier: email, ticket, password: PW });
    if (x.status >= 300) throw new Error(`member ${tag}: ${x.status}`);
    const me = await c.get("/bff/users/me");
    return { c, email, id: me.data?.user?.id as string };
  }
  const sessionCookies = (c: Client) => Object.entries(c.jar).map(([name, value]) => ({ name, value, url: BASE }));

  const m1 = await member("gwmember1");
  const m2 = await member("gwmember2");

  // ---- browser ---------------------------------------------------------------------------------------------
  const browser = await chromium.launch({ executablePath: env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium", headless: true });
  const csp: string[] = [];
  const errs: string[] = [];
  const watch = (p: any) => {
    p.on("console", (m: any) => {
      if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) csp.push(m.text().slice(0, 200));
    });
    p.on("pageerror", (e: any) => errs.push(e.message.slice(0, 200)));
  };
  const newCtx = async (c: Client) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": c.ip } });
    await ctx.addCookies(sessionCookies(c));
    await ctx.addInitScript(() => {
      (window as any).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    return ctx;
  };
  const cspEvents = async (p: any) => ((await p.evaluate(() => (window as any).__csp ?? [])) as string[]);

  // ===== 1. Razorpay hand-off with a stubbed Checkout popup =====
  const ctx1 = await newCtx(m1.c);
  const page = await ctx1.newPage();
  livePage = page;
  watch(page);
  const seen: { orderId?: string; amount?: number; key?: string; secretLeak?: boolean } = {};
  let stubMode: "pay" | "dismiss" = "dismiss";
  await page.exposeFunction("__rzpCapture", (orderId: string) => {
    const payId = rzp.capture(orderId);
    return { razorpay_payment_id: payId, razorpay_order_id: orderId, razorpay_signature: createHmac("sha256", RZ.keySecret).update(`${orderId}|${payId}`).digest("hex") };
  });
  await page.exposeFunction("__rzpSeen", (opts: any) => {
    seen.orderId = opts.order_id;
    seen.amount = opts.amount;
    seen.key = opts.key;
    seen.secretLeak = JSON.stringify(opts).includes(RZ.keySecret);
  });
  await page.exposeFunction("__rzpMode", () => stubMode);
  await page.addInitScript(() => {
    // STUB of Razorpay's checkout.js (the real popup is NOT exercised here)
    (window as any).Razorpay = function (opts: any) {
      this.opts = opts;
      this.on = () => undefined;
      this.open = async () => {
        await (window as any).__rzpSeen(opts);
        if ((await (window as any).__rzpMode()) === "dismiss") return opts.modal.ondismiss();
        const resp = await (window as any).__rzpCapture(opts.order_id);
        opts.handler(resp);
      };
    };
  });

  await page.goto(`${BASE}/membership/checkout?plan=${planCode}`);
  const payBtn = page.getByRole("button", { name: /^Pay / });
  await payBtn.waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/20-checkout.png` });
  check("GW1 production checkout shows a real 'Pay' button (no simulation panel)", (await page.getByText(/Run simulated payment/i).count()) === 0);

  // dismissed popup first: nothing may be granted
  stubMode = "dismiss";
  await payBtn.click();
  await page.getByText(/pending/i).first().waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/21-checkout-dismissed.png` });
  const dismissedRow = (await db.query("select status, amount_in_paise a from payments where user_id = $1 order by created_at desc limit 1", [m1.id])).rows[0];
  check("GW2 closing the popup without paying leaves the payment PENDING and grants nothing", dismissedRow?.status === "PENDING" && (await db.query("select count(*)::int n from memberships where user_id = $1 and status = 'ACTIVE'", [m1.id])).rows[0].n === 0, JSON.stringify(dismissedRow));
  check("GW3 the browser was handed only public values: key id, order id and the SERVER-side amount, never a secret", seen.key === RZ.keyId && !!seen.orderId && seen.amount === planPrice && seen.secretLeak === false, JSON.stringify({ ...seen, secretLeak: seen.secretLeak }));

  // The member presses "Pay" again straight away: the server's duplicate-checkout guard answers 409 …
  await page.goto(`${BASE}/membership/checkout?plan=${planCode}`);
  const again = page.getByRole("button", { name: /^Pay / });
  await again.waitFor({ state: "visible", timeout: 20_000 });
  const ordersBefore = rzp.orders.size;
  await again.click();
  await page.getByText(/already pending/i).first().waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/21b-checkout-already-pending.png` });
  check("GW3b a second 'Pay' while one is pending is refused by the server (no second order at the gateway)", rzp.orders.size === ordersBefore);
  // … and the page offers the way back into the SAME order
  await page.getByRole("button", { name: "Check the pending payment" }).click();
  const cont = page.getByRole("button", { name: "Continue to payment" });
  await cont.waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/21c-checkout-continue.png` });
  stubMode = "pay";
  const firstOrder = seen.orderId;
  await cont.click();
  await page.getByText("Payment verified").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/22-checkout-verified.png` });
  const paid = (await db.query("select id, status, amount_in_paise a, membership_id from payments where user_id = $1 and status = 'SUCCESS'", [m1.id])).rows;
  const inv = paid[0] ? (await db.query("select count(*)::int n from invoices where payment_id = $1", [paid[0].id])).rows[0].n : 0;
  const ms = paid[0] ? (await db.query("select status from memberships where id = $1", [paid[0].membership_id])).rows[0]?.status : null;
  check("GW4 a signed capture is confirmed by the server: payment SUCCESS for the plan price, membership ACTIVE, exactly one invoice", paid.length === 1 && paid[0].a === planPrice && ms === "ACTIVE" && inv === 1, JSON.stringify({ paid: paid.length, ms, inv }));
  check("GW5 the order that was paid is the ORIGINAL order (reopened, not recreated) and carries the server-side plan amount", seen.orderId === firstOrder && rzp.orders.size === ordersBefore && rzp.orders.get(seen.orderId!)?.amount === planPrice);
  const cspPage1 = await cspEvents(page);
  check("GW6 checkout produced no CSP violation", cspPage1.length === 0 && csp.length === 0, [...cspPage1, ...csp].join(" | "));
  const w1 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check("GW6b checkout: no horizontal page scroll at 1280px", w1.sw <= w1.iw + 1);

  // ===== 2. PhonePe: redirect + return page =====
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "PHONEPE" });
  check("GW7 admin switches the active gateway to PhonePe (Razorpay becomes inactive)", r.status === 200 && (await db.query("select count(*)::int n from payment_gateways where is_active")).rows[0].n === 1);
  const ctx2 = await newCtx(m2.c);
  const page2 = await ctx2.newPage();
  watch(page2);
  const hosted: string[] = [];
  await page2.route("https://mercury-uat.phonepe.com/**", (route: any) => {
    hosted.push(route.request().url());
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>PhonePe (stub)</title><h1>PhonePe hosted page (stub)</h1>" });
  });
  await page2.goto(`${BASE}/membership/checkout?plan=${planCode}`);
  const pp1 = page2.getByRole("button", { name: /^Pay / });
  await pp1.waitFor({ state: "visible", timeout: 20_000 });
  await pp1.click();
  await page2.waitForURL(/mercury-uat\.phonepe\.com/, { timeout: 20_000 });
  await page2.screenshot({ path: `${SHOTS}/23-phonepe-redirect.png` });
  check("GW8 PhonePe checkout sends the browser to the https hosted page returned by the server", hosted.length === 1 && /^https:\/\/mercury-uat\.phonepe\.com\//.test(hosted[0]), hosted.join(","));
  const ppPay = (await db.query("select id, status, amount_in_paise a, gateway_reference ref from payments where user_id = $1 order by created_at desc limit 1", [m2.id])).rows[0];
  check("GW8b the PhonePe payment is PENDING for the server-side amount", ppPay?.status === "PENDING" && ppPay.a === planPrice, JSON.stringify(ppPay));
  // return before the gateway has completed: must not show success
  await page2.goto(`${BASE}/membership/payment-return?paymentId=${ppPay.id}`);
  await page2.getByText("Payment still pending").first().waitFor({ state: "visible", timeout: 20_000 });
  await page2.screenshot({ path: `${SHOTS}/24-return-pending.png` });
  check("GW9 returning while PhonePe still reports PENDING shows 'Payment still pending', not success", (await db.query("select status from payments where id = $1", [ppPay.id])).rows[0].status === "PENDING");
  // PhonePe completes the order
  pp.setOrderState(ppPay.ref ?? [...pp.orders.keys()].pop()!, "COMPLETED");
  await page2.goto(`${BASE}/membership/payment-return?paymentId=${ppPay.id}`);
  await page2.getByText("Payment successful").first().waitFor({ state: "visible", timeout: 25_000 });
  await page2.screenshot({ path: `${SHOTS}/25-return-success.png` });
  check("GW10 after PhonePe reports COMPLETED the return page verifies with the server: payment SUCCESS, membership ACTIVE", (await db.query("select status from payments where id = $1", [ppPay.id])).rows[0].status === "SUCCESS" && (await db.query("select count(*)::int n from memberships where user_id = $1 and status = 'ACTIVE'", [m2.id])).rows[0].n === 1);
  // IDOR through the return page: member 2 opens member 1's payment id
  const m1Pay = paid[0].id as string;
  await page2.goto(`${BASE}/membership/payment-return?paymentId=${m1Pay}`);
  await sleep(1500);
  const idorText = await page2.locator("body").innerText();
  check("GW11 the return page cannot be used to read or verify someone else's payment (no success shown, no payment data)", !/Payment successful/.test(idorText) && !idorText.includes(m1.email), idorText.slice(0, 160));
  await page2.screenshot({ path: `${SHOTS}/26-return-idor.png` });
  await page2.goto(`${BASE}/membership/payment-return`);
  await sleep(500);
  check("GW12 the return page without a payment id shows no success", !/Payment successful/.test(await page2.locator("body").innerText()));
  const cspPage2 = await cspEvents(page2);
  check("GW12b PhonePe return pages produced no CSP violation", cspPage2.length === 0 && csp.length === 0, [...cspPage2, ...csp].join(" | "));

  // ===== 3. admin refund drawer =====
  const ctx3 = await newCtx(owner);
  const adminPage = await ctx3.newPage();
  watch(adminPage);
  await adminPage.goto(`${BASE}/admin/super/revenue`);
  await adminPage.getByRole("button", { name: "Refunds" }).first().waitFor({ state: "visible", timeout: 25_000 });
  await adminPage.screenshot({ path: `${SHOTS}/27-revenue.png` });
  // the Razorpay payment is the one with a refund-able gateway reference; pick its row by amount + provider text
  const razorpayRow = adminPage.locator("tr", { hasText: /Razorpay/i }).filter({ has: adminPage.getByRole("button", { name: "Refunds" }) }).first();
  await razorpayRow.getByRole("button", { name: "Refunds" }).click();
  await adminPage.locator("#refund-reason").waitFor({ state: "visible", timeout: 20_000 });
  await adminPage.screenshot({ path: `${SHOTS}/28-refund-drawer.png` });
  const submit = adminPage.getByRole("button", { name: "Issue refund" });
  check("GW13 a refund cannot be submitted without a reason", await submit.isDisabled());
  await adminPage.fill("#refund-amount", "999999");
  await adminPage.fill("#refund-reason", "Browser check refund");
  check("GW14 an amount above the refundable balance cannot be submitted", await submit.isDisabled());
  await adminPage.fill("#refund-amount", "");
  const refundReq = adminPage.waitForResponse((x: any) => /\/refunds$/.test(x.url()) && x.request().method() === "POST", { timeout: 25_000 });
  await submit.click();
  const refundResp = await refundReq;
  await adminPage.getByText(/Refund initiated/).first().waitFor({ state: "visible", timeout: 20_000 });
  await adminPage.getByText("Nothing left to refund on this payment.").first().waitFor({ state: "visible", timeout: 20_000 });
  await adminPage.screenshot({ path: `${SHOTS}/29-refund-pending.png` });
  check("GW15a the drawer refreshes itself: balance drops to nothing refundable and the refund is listed as Pending", /Pending/.test(await adminPage.locator('[role="dialog"]').innerText()));
  let refundRow = (await db.query("select status, amount_in_paise a from payment_refunds where payment_id = $1", [paid[0].id])).rows[0];
  check("GW15 a full refund goes to the gateway; while Razorpay has not confirmed it the UI says so and the refund stays PENDING (no false 'processed')", refundResp.status() < 300 && refundRow?.status === "PENDING" && refundRow.a === planPrice && rzp.requests.some((q) => q.method === "POST" && /refund/.test(q.path)), JSON.stringify({ http: refundResp.status(), refundRow }));
  check("GW15b the payment is not yet marked REFUNDED while the refund is pending", (await db.query("select status from payments where id = $1", [paid[0].id])).rows[0].status === "SUCCESS");
  // the gateway later confirms; the scheduled reconcile job (called over HTTP with the cron secret) settles it
  for (const x of rzp.refunds.values()) x.status = "processed";
  await db.query("update payment_refunds set created_at = now() - interval '20 minutes' where payment_id = $1", [paid[0].id]); // the job only re-reads refunds older than 5 minutes
  const job = await fetch(`${BASE}/api/v1/internal/jobs/payment-reconcile`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  check("GW15c the payment-reconcile job runs over HTTP", job.status === 200);
  refundRow = (await db.query("select status from payment_refunds where payment_id = $1", [paid[0].id])).rows[0];
  check("GW15d after the gateway confirms, the job marks the refund PROCESSED and the payment REFUNDED", refundRow?.status === "PROCESSED" && (await db.query("select status from payments where id = $1", [paid[0].id])).rows[0].status === "REFUNDED");
  await adminPage.reload();
  await adminPage.getByRole("button", { name: "Refunds" }).first().waitFor({ state: "visible", timeout: 25_000 });
  check("GW15e the refund is in the audit log", (await db.query("select count(*)::int n from audit_logs where entity_id = $1 and action like 'payment.refund%'", [paid[0].id])).rows[0].n >= 1);
  const cspAdmin = await cspEvents(adminPage);
  check("GW16 the admin revenue/refund screens produced no CSP violation", cspAdmin.length === 0 && csp.length === 0, [...cspAdmin, ...csp].join(" | "));

  // ===== 4. phone width =====
  for (const [p, path, label] of [
    [page, `/membership/checkout?plan=${planCode}`, "checkout"],
    [page2, `/membership/payment-return?paymentId=${ppPay.id}`, "payment return"],
    [adminPage, "/admin/super/revenue", "admin revenue"],
  ] as const) {
    await p.setViewportSize({ width: 375, height: 800 });
    await p.goto(`${BASE}${path}`);
    await sleep(1200);
    const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`GW17 ${label}: no horizontal page scroll at 375px`, w.sw <= w.iw + 1, `${w.sw} > ${w.iw}`);
  }
  check("GW18 no uncaught page error on any page", errs.length === 0, errs.join(" | "));
  check("GW19 no CSP violation was logged to any console", csp.length === 0, csp.join(" | "));

  await browser.close();
  await smtp.close();
  await rzp.close();
  await pp.close();
  await db.end();
  finish("PCP payment-screen browser check");
}

main().catch(async (e) => {
  console.error("browser check crashed:", e);
  try {
    await livePage?.screenshot({ path: `${SHOTS}/crash-gw.png` });
    console.error("page text at crash:", String(await livePage?.locator("body").innerText()).slice(0, 1200));
  } catch {
    /* best effort */
  }
  process.exit(2);
});
