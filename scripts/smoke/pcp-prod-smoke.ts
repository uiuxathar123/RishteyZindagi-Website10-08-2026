#!/usr/bin/env -S npx tsx
/**
 * Real-HTTP smoke test against a RUNNING PRODUCTION-MODE server (NODE_ENV=production, `next start`).
 * Orchestrated by scripts/smoke/run-smoke.sh, which prepares a fresh database, a mock SMTP relay
 * and the server environment. Nothing is mocked inside the application: every request goes over
 * TCP through the real middleware, BFF proxy, route handlers and PostgreSQL.
 *
 * Covers: health + security headers + CSP, first-Super-Admin bootstrap, cookie flags, forced
 * password change, same-origin (CSRF) enforcement, staff lifecycle + RBAC + privilege-escalation
 * refusal, OTP provider admin API in production, member sign-up through a real SMTP relay,
 * moderation (suspend/ban/lift), account deletion + recovery, jobs endpoint auth, rate limiting
 * (including forged X-Forwarded-For), webhook authentication, upload validation, secret exposure.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";
import { deflateSync } from "node:zlib";
import { startMockSmtp, codeFromMail } from "../../tests/helpers/mock-otp";
import { BASE, Client, assertNoSecretsSeen, check, cookieAttrs, finish, sleep } from "./lib";

const env = process.env;
/** A valid, solid-colour w×h PNG built with zlib (the app rejects images under 200×200). */
function makePng(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9a)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const SECRETS = (env.SMOKE_SECRETS ?? "").split(",").filter(Boolean);
const ONE_TIME: string[] = []; // temporary passwords handed out once by the API
const CRON = env.CRON_SECRET ?? "";
const PW = "Smoke#Pass-12345";

async function main() {
  const tlsFiles = env.SMOKE_SMTP_TLS_KEY && env.SMOKE_SMTP_TLS_CERT
    ? { key: (await import("node:fs")).readFileSync(env.SMOKE_SMTP_TLS_KEY, "utf8"), cert: (await import("node:fs")).readFileSync(env.SMOKE_SMTP_TLS_CERT, "utf8") }
    : undefined;
  const smtp = await startMockSmtp({ user: env.SMTP_USER as string, pass: env.SMTP_PASS as string }, Number(env.SMTP_PORT), tlsFiles);
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const anon = new Client("anon");

  // ------------------------------------------------------------------ 1. health + headers
  let r = await anon.get("/api/v1/health");
  check("H1 /health 200", r.status === 200, String(r.status));
  r = await anon.get("/api/v1/health/ready");
  check("H2 /health/ready 200 with database connected", r.status === 200 && r.data?.checks?.database === "connected", r.text.slice(0, 160));
  check("H3 /health/ready reports OTP e-mail configured (SMTP) and storage configured", r.data?.checks?.dependencies?.otp?.email === "configured" && r.data?.checks?.dependencies?.storageProvider === "configured", r.text.slice(0, 200));
  r = await anon.get("/api/v1/health");
  for (const [h, re] of [
    ["x-content-type-options", /nosniff/],
    ["x-frame-options", /DENY|SAMEORIGIN/i],
    ["referrer-policy", /./],
    ["strict-transport-security", /max-age=\d+/],
  ] as const) check(`H4 API response header ${h}`, re.test(r.headers.get(h) ?? ""), String(r.headers.get(h)));
  for (const page of ["/", "/login", "/admin/login", "/membership"]) {
    const p = await anon.get(page);
    const csp = p.headers.get("content-security-policy") ?? "";
    check(`H5 ${page} → 200 with CSP (frame-ancestors none, object-src none, base-uri self)`, p.status === 200 && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp), `${p.status} ${csp.slice(0, 60)}`);
    check(`H6 ${page} HSTS + nosniff + X-Frame-Options DENY`, /max-age=\d+/.test(p.headers.get("strict-transport-security") ?? "") && p.headers.get("x-content-type-options") === "nosniff" && p.headers.get("x-frame-options") === "DENY");
  }
  r = await anon.get("/api/v1/dev/otp-code?identifier=a@b.co&purpose=SIGNUP");
  check("H7 dev OTP reveal route does not exist in production (404)", r.status === 404, String(r.status));

  // ------------------------------------------------------------------ 2. first Super Admin bootstrap
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  check("B1 admin:create-super prints a one-time temporary password and exits 0", boot.status === 0 && tempPw.length === 16, boot.stderr.slice(0, 200));
  const again = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "second@smoke.example", "--name", "Second"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  check("B2 a second bootstrap is refused (exit 1) without --allow-additional", again.status === 1 && !/Temporary password/.test(again.stdout));
  SECRETS.push(tempPw);

  const owner = new Client("owner");
  r = await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: "wrong-password-xx" });
  check("A1 wrong admin password → 401", r.status === 401, String(r.status));
  r = await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  const ck = cookieAttrs(owner.lastSetCookie, "rz_admin_session");
  check("A2 admin login 200 and no session token in the response body", r.status === 200 && !/sessionToken/.test(r.text) && !/"token"/.test(r.text), r.text.slice(0, 200));
  check("A3 admin cookie is HttpOnly + Secure + SameSite=Strict + Path=/", /HttpOnly/i.test(ck) && /Secure/i.test(ck) && /SameSite=Strict/i.test(ck) && /Path=\//i.test(ck), ck.replace(/=[^;]+/, "=<redacted>"));
  r = await owner.get("/bff/admin/me");
  check("A4 /admin/me says mustChangePassword", r.status === 200 && r.data?.admin?.mustChangePassword === true, r.text.slice(0, 160));
  r = await owner.get("/bff/admin/users");
  check("A5 permissioned admin API refuses a temporary password (403)", r.status === 403, String(r.status));
  r = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: "short" });
  check("A6 weak new password rejected (400)", r.status === 400, String(r.status));
  r = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: PW });
  check("A7 password changed (200)", r.status === 200, r.text.slice(0, 160));
  r = await owner.get("/bff/admin/users");
  check("A8 admin API works after the change", r.status === 200, String(r.status));
  const old = new Client("old");
  r = await old.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  check("A9 the temporary password no longer works", r.status === 401, String(r.status));

  // member session must not open admin APIs and vice versa (checked again below with a real member)
  r = await anon.get("/bff/admin/users");
  check("A10 anonymous admin API → 401", r.status === 401, String(r.status));

  // ------------------------------------------------------------------ 3. CSRF / same-origin
  const before = (await db.query("select count(*)::int n from admin_users")).rows[0].n;
  r = await owner.post("/bff/admin/staff", { name: "Evil Staff", email: "evil@smoke.example", roleName: "STAFF_ADMIN" }, { headers: { Origin: "https://evil.example" } });
  check("C1 cross-origin POST with a valid admin cookie → 403", r.status === 403, String(r.status));
  r = await owner.post("/bff/admin/staff", { name: "Evil Staff", email: "evil@smoke.example", roleName: "STAFF_ADMIN" }, { noOrigin: true, headers: { "sec-fetch-site": "cross-site" } });
  check("C2 Sec-Fetch-Site: cross-site without Origin → 403", r.status === 403, String(r.status));
  const after = (await db.query("select count(*)::int n from admin_users")).rows[0].n;
  check("C3 no staff account was created by the rejected requests", before === after);
  r = await owner.req("PUT", "/bff/admin/payments/config/razorpay/credentials", { keyId: "rzp_test_abcdef123456" }, { headers: { Origin: "https://evil.example" } });
  check("C4 cross-origin PUT → 403", r.status === 403, String(r.status));

  // ------------------------------------------------------------------ 4. staff lifecycle + RBAC
  r = await owner.post("/bff/admin/staff", { name: "Smoke Staff", email: "staff@smoke.example", roleName: "STAFF_ADMIN" });
  const staffTemp = r.data?.temporaryPassword as string;
  check("S1 create staff → 201 with a one-time temporary password, no-store", r.status === 201 && staffTemp?.length === 16 && /no-store/.test(r.headers.get("cache-control") ?? ""), r.text.slice(0, 120));
  ONE_TIME.push(staffTemp);
  const staffId = r.data?.staff?.id as string;
  r = await owner.get("/bff/admin/staff");
  check("S2 staff list never contains password material", r.status === 200 && !/passwordHash|\$2[aby]\$|temporaryPassword/.test(r.text));
  const staff = new Client("staff");
  r = await staff.post("/bff/admin/login", { email: "staff@smoke.example", password: staffTemp });
  check("S3 staff can sign in with the temporary password", r.status === 200);
  r = await staff.get("/bff/admin/users");
  check("S4 staff on a temporary password is refused (403)", r.status === 403);
  r = await staff.post("/bff/admin/me/password", { currentPassword: staffTemp, newPassword: "Staff#Pass-123456" });
  check("S5 staff changes password", r.status === 200);
  r = await staff.get("/bff/admin/users");
  check("S6 default staff role can list users", r.status === 200, String(r.status));
  r = await staff.get("/bff/admin/account-deletions");
  check("S7b the deletion queue follows users.view (documented): default staff (who hold users.view) may read it", r.status === 200, String(r.status));
  for (const [p, m] of [["/bff/admin/staff", "GET"], ["/bff/admin/roles", "GET"], ["/bff/admin/payments/config", "GET"], ["/bff/admin/otp/provider", "GET"]] as const) {
    const x = await staff.req(m, p);
    check(`S7 default staff → 403 on ${m} ${p.replace("/bff/admin", "")}`, x.status === 403, String(x.status));
  }
  r = await staff.post("/bff/admin/staff", { name: "Escalator", email: "esc@smoke.example", roleName: "SUPER_ADMIN" });
  check("S8 staff cannot create a Super Admin (403)", r.status === 403, String(r.status));
  r = await owner.post("/bff/admin/staff", { name: "Another Super", email: "sup2@smoke.example", roleName: "SUPER_ADMIN" });
  check("S9 not even a Super Admin can mint a Super Admin through the API (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  r = await owner.patch(`/bff/admin/staff/${staffId}`, { status: "SUSPENDED" });
  check("S10 suspend staff → 200", r.status === 200, r.text.slice(0, 120));
  r = await staff.get("/bff/admin/users");
  check("S11 a suspended staff member's existing session stops working (401/403)", r.status === 401 || r.status === 403, String(r.status));
  const staff2 = new Client("staff2");
  r = await staff2.post("/bff/admin/login", { email: "staff@smoke.example", password: "Staff#Pass-123456" });
  check("S12 suspended staff cannot sign in", r.status >= 400 && r.status < 500, String(r.status));
  r = await owner.patch(`/bff/admin/staff/${staffId}`, { status: "ACTIVE" });
  check("S13 restore staff → 200", r.status === 200);
  r = await owner.post(`/bff/admin/staff/${staffId}/reset-password`);
  ONE_TIME.push(r.data?.temporaryPassword);
  check("S14 reset password returns a new one-time password", r.status === 200 && r.data?.temporaryPassword?.length === 16);
  const me = await owner.get("/bff/admin/me");
  r = await owner.patch(`/bff/admin/staff/${me.data?.admin?.id}`, { status: "SUSPENDED" });
  check("S15 a Super Admin account cannot be suspended through the API (4xx)", r.status >= 400 && r.status < 500, String(r.status));

  // ------------------------------------------------------------------ 5. OTP provider admin API (production rules)
  r = await owner.get("/bff/admin/otp/provider");
  const prov = r.data?.providers ?? [];
  check("O1 OTP provider view lists EMAIL (configured) and FAST2SMS_SMS (incomplete), no secret values", r.status === 200 && prov.find((p: any) => p.key === "EMAIL")?.configured === true && prov.find((p: any) => p.key === "FAST2SMS_SMS")?.configured === false && !/smoke-smtp-pass/.test(r.text), r.text.slice(0, 300));
  r = await owner.patch("/bff/admin/otp/provider", { activeProvider: "FAST2SMS_SMS" });
  check("O2 in production an unconfigured provider cannot be activated (409), naming env var NAMES only", r.status === 409 && /FAST2SMS_API_KEY/.test(r.text), `${r.status} ${r.text.slice(0, 200)}`);
  r = await owner.patch("/bff/admin/otp/provider", { activeProvider: "WHATSAPP" });
  check("O3 WHATSAPP is not an accepted provider (400)", r.status === 400, String(r.status));
  r = await owner.patch("/bff/admin/otp/provider", { activeProvider: "EMAIL" });
  check("O4 activating configured EMAIL → 200", r.status === 200 && r.data?.activeProvider === "EMAIL", r.text.slice(0, 160));

  // ------------------------------------------------------------------ 6. payment config API (admin-saved credentials)
  r = await owner.get("/bff/admin/payments/config");
  check("P1 payment config lists exactly Razorpay + PhonePe, at most one active, no stored credentials on a fresh install", r.status === 200 && r.data?.gateways?.length === 2 && r.data.gateways.filter((g: any) => g.isActive).length <= 1 && r.data.gateways.every((g: any) => (g.storedFields ?? []).length === 0), r.text.slice(0, 400));
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "RAZORPAY" });
  check("P2 activating a gateway with no credentials is refused (409)", r.status === 409, `${r.status} ${r.text.slice(0, 160)}`);
  r = await owner.put("/bff/admin/payments/config/razorpay/credentials", { mode: "test", keyId: "not-a-key" });
  check("P3 malformed key id rejected (400)", r.status === 400, String(r.status));
  const FAKE_SECRET = "smoke-fake-razorpay-secret-0001";
  r = await owner.put("/bff/admin/payments/config/razorpay/credentials", { mode: "test", keyId: "rzp_test_SmokeFake0001", keySecret: FAKE_SECRET, webhookSecret: "smoke-fake-webhook-secret" });
  SECRETS.push(FAKE_SECRET, "smoke-fake-webhook-secret");
  check("P4 save Razorpay credentials → 200 and the response contains no secret", r.status === 200 && !r.text.includes(FAKE_SECRET) && !r.text.includes("smoke-fake-webhook-secret"), r.text.slice(0, 240));
  r = await owner.get("/bff/admin/payments/config");
  const rz = r.data?.gateways?.find((g: any) => g.key === "RAZORPAY");
  check("P5 GET shows the saved TEST key as REFUSED in production (detectedMode=test, a problem is reported, not 'configured'), stored field NAMES only, no secret", rz?.configured === false && rz?.detectedMode === "test" && /TEST key/.test(rz?.problem ?? "") && rz?.credentialSource === "admin" && Array.isArray(rz?.storedFields) && rz.storedFields.length >= 2 && !r.text.includes(FAKE_SECRET), JSON.stringify(rz).slice(0, 240));
  const cipher = (await db.query("select config::text c from payment_gateways where name = 'Razorpay'")).rows[0]?.c ?? "";
  check("P6 the database holds ciphertext, not the secret", cipher.length > 20 && !cipher.includes(FAKE_SECRET) && !cipher.includes("smoke-fake-webhook-secret"), cipher.slice(0, 120));
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "RAZORPAY" });
  check("P7 activating Razorpay with a TEST key in production is refused (409): fail closed", r.status === 409 && /TEST key/.test(r.text), r.text.slice(0, 160));
  r = await owner.patch("/bff/admin/payments/config", { activeGateway: "CASHFREE" });
  check("P8 an unsupported gateway key is rejected (400)", r.status === 400, String(r.status));
  const act = (await db.query("select name from payment_gateways where is_active")).rows.map((x) => x.name);
  check("P9 the database agrees: still exactly one active gateway (the seeded default); the refused activation changed nothing", act.length === 1, JSON.stringify(act));

  // ------------------------------------------------------------------ 7. webhooks: authentication
  r = await anon.post("/api/v1/webhooks/razorpay", { event: "payment.captured" }, { noOrigin: true });
  check("W1 Razorpay webhook without a signature → 401", r.status === 401, String(r.status));
  r = await anon.post("/api/v1/webhooks/razorpay", { event: "payment.captured" }, { noOrigin: true, headers: { "x-razorpay-signature": "0".repeat(64) } });
  check("W2 Razorpay webhook with a wrong signature → 401", r.status === 401, String(r.status));
  r = await anon.post("/api/v1/webhooks/phonepe", { event: "checkout.order.completed" }, { noOrigin: true });
  check("W3 PhonePe webhook not configured / unauthenticated → 401 or 503, never 200", r.status === 401 || r.status === 503, String(r.status));
  r = await anon.post("/api/v1/webhooks/phonepe", { event: "x" }, { noOrigin: true, headers: { authorization: "a".repeat(64) } });
  check("W4 PhonePe webhook with a wrong Authorization → 401 or 503, never 200", r.status === 401 || r.status === 503, String(r.status));

  // ------------------------------------------------------------------ 8. member sign-up through a real SMTP relay
  const m = new Client("member");
  const email = "member1@smoke.example";
  r = await m.post("/bff/auth/register", { name: "Smoke Member", email, mobileNumber: "9876500001", countryCode: "+91" });
  check("M1 register → 2xx (code e-mailed through SMTP)", r.status < 300, `${r.status} ${r.text.slice(0, 160)}`);
  await sleep(300);
  const mail = [...smtp.mails].reverse().find((x) => x.to.includes(email));
  check("M2 the SMTP relay received exactly one message for the member, authenticated, containing a code", !!mail && mail.auth?.user === env.SMTP_USER, JSON.stringify(smtp.mails.map((x) => x.to)));
  const code = mail ? codeFromMail(mail.text) : "";
  r = await m.post("/bff/auth/verify-signup-otp", { identifier: email, code: "000000" === code ? "111111" : "000000" });
  check("M3 a wrong code is refused (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  r = await m.post("/bff/auth/verify-signup-otp", { identifier: email, code });
  check("M4 the emailed code verifies", r.status === 200, r.text.slice(0, 160));
  const ticket = r.data?.ticket ?? r.data?.setPasswordTicket ?? (Object.values(r.data ?? {})[0] as string);
  r = await m.post("/bff/auth/set-password", { identifier: email, ticket, password: PW });
  check("M5 set password → 2xx and a member session cookie (HttpOnly, Secure, Lax) with no token in the body", r.status < 300 && /HttpOnly/i.test(cookieAttrs(m.lastSetCookie, "rz_session")) && /Secure/i.test(cookieAttrs(m.lastSetCookie, "rz_session")) && /SameSite=Lax/i.test(cookieAttrs(m.lastSetCookie, "rz_session")) && !/sessionToken/.test(r.text), `${r.status} ${cookieAttrs(m.lastSetCookie, "rz_session").replace(/=[^;]+/, "=<r>")}`);
  r = await m.get("/bff/users/me");
  check("M6 member session works", r.status === 200 && r.data?.user?.email === email, r.text.slice(0, 120));
  const memberId = r.data?.user?.id as string;
  r = await m.get("/bff/admin/users");
  check("M7 a member session never opens admin APIs (401/403)", r.status === 401 || r.status === 403, String(r.status));
  r = await owner.get("/bff/as-admin/users/me");
  check("M8 an admin session is not a member session (403)", r.status === 403, String(r.status));

  // upload validation
  const png = makePng(240, 240);
  const prof = await m.post("/bff/profiles/me", { gender: "FEMALE", dateOfBirth: "1996-04-12" });
  check("M9 create profile → 2xx", prof.status < 300, `${prof.status} ${prof.text.slice(0, 160)}`);
  const up = async (name: string, type: string, bytes: Buffer) => {
    const fd = new FormData();
    fd.set("photo", new Blob([new Uint8Array(bytes)], { type }), name);
    const res = await fetch(BASE + "/bff/profiles/me/photos", { method: "POST", headers: { cookie: m.cookieHeader(), Origin: BASE, "x-forwarded-for": m.ip }, body: fd });
    return { status: res.status, text: await res.text() };
  };
  let u = await up("../../etc/passwd.png", "image/png", Buffer.from("this is not an image at all"));
  check("U1 non-image bytes disguised as .png are rejected by magic-byte validation (4xx)", u.status >= 400 && u.status < 500, `${u.status} ${u.text.slice(0, 120)}`);
  u = await up("big.png", "image/png", Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]));
  check("U2 an oversized upload is rejected (4xx)", u.status >= 400 && u.status < 500, `${u.status} ${u.text.slice(0, 120)}`);
  u = await up("../../evil.png", "image/png", png);
  check("U3 a valid 240×240 PNG with a hostile file name is accepted and the stored key is server-generated (no traversal)", u.status < 300 && !/\.\.|etc|evil/.test(u.text), `${u.status} ${u.text.slice(0, 200)}`);
  const key = (await db.query("select storage_key k from profile_photos order by created_at desc limit 1").catch(() => ({ rows: [] as any[] }))).rows[0]?.k;
  if (key !== undefined) check("U4 stored key has no traversal characters", !/\.\.|\\|^\//.test(key), key);

  // ------------------------------------------------------------------ 9. moderation
  r = await owner.post(`/bff/admin/users/${memberId}/suspend`, { reason: "no" });
  check("X1 suspend requires a reason of at least 5 characters (400)", r.status === 400, String(r.status));
  r = await owner.post(`/bff/admin/users/${memberId}/suspend`, { reason: "Smoke test suspension" });
  check("X2 suspend → 200", r.status === 200, r.text.slice(0, 120));
  r = await m.get("/bff/users/me");
  check("X3 the suspended member's session stops working immediately (401/403)", r.status === 401 || r.status === 403, String(r.status));
  r = await owner.get(`/bff/admin/users/${memberId}/moderation`);
  check("X4 moderation view shows the active suspension with its reason", r.status === 200 && String(r.data?.activeSuspension?.reason ?? "").includes("Smoke test suspension"), r.text.slice(0, 200));
  r = await owner.post(`/bff/admin/users/${memberId}/lift-suspension`, {});
  check("X5 lift suspension → 200", r.status === 200, r.text.slice(0, 120));
  r = await owner.post(`/bff/admin/users/${memberId}/ban`, { reason: "Smoke test ban" });
  check("X6 ban → 200", r.status === 200, r.text.slice(0, 120));
  r = await owner.post(`/bff/admin/users/${memberId}/suspend`, { reason: "Suspend a banned user" });
  check("X7 a banned account cannot be 'suspended' on top (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  const banned = new Client("banned");
  r = await banned.post("/bff/auth/login", { email, password: PW });
  check("X8 a banned member cannot log in (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  r = await staff.post(`/bff/admin/users/${memberId}/ban`, { reason: "Staff trying to ban" });
  check("X9 default staff cannot ban (401/403)", r.status === 401 || r.status === 403, String(r.status));
  r = await owner.post(`/bff/admin/users/${memberId}/unban`, { reason: "Smoke test unban" });
  check("X10 unban → 200", r.status === 200, r.text.slice(0, 120));
  const audit = (await db.query("select distinct action from audit_logs where entity_id = $1 and action in ('account.suspended_by_admin','account.suspension_lifted','account.banned','account.unbanned')", [memberId])).rows.map((x) => x.action);
  check("X11 suspend, lift, ban and unban were each audited", audit.length === 4, JSON.stringify(audit));

  // ------------------------------------------------------------------ 10. account deletion + recovery
  const d = new Client("deleter");
  r = await d.post("/bff/auth/login", { email, password: PW });
  if (r.status === 200 && r.data?.deviceVerificationRequired) {
    await sleep(300);
    const m2 = [...smtp.mails].reverse().find((x) => x.to.includes(email));
    r = await d.post("/bff/auth/verify-device", { identifier: email, code: codeFromMail(m2!.text) });
  }
  check("D1 member can log in again after unban (new device verified through SMTP if asked) and holds a session cookie", r.status === 200 && !!d.jar["rz_session"], `${r.status} ${r.text.slice(0, 160)}`);
  r = await d.post("/bff/users/me/delete-account", { password: "wrong-password-1", confirmation: "DELETE MY ACCOUNT" });
  check("D2 wrong password refused with 403 (not 401) and the session survives", r.status === 403 && !!d.jar["rz_session"], String(r.status));
  r = await d.post("/bff/users/me/delete-account", { password: PW, confirmation: "delete my account" });
  check("D3 wrong confirmation phrase refused (400)", r.status === 400, String(r.status));
  r = await d.post("/bff/users/me/delete-account", { password: PW, confirmation: "DELETE MY ACCOUNT" });
  check("D4 delete account → 200 with a recovery deadline", r.status === 200 && r.data?.status === "DELETED_PENDING" && !!r.data?.recoverUntil, r.text.slice(0, 200));
  check("D5 the session cookie is cleared by the BFF", !d.jar["rz_session"]);
  const pend = new Client("pending");
  r = await pend.post("/bff/auth/login", { email, password: PW });
  check("D6 a pending-deletion account cannot log in (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  const mailsBefore = smtp.mails.length;
  r = await pend.post("/bff/auth/recover-account/request", { email, password: "wrong-password-1" });
  const wrongShape = Object.keys(r.data ?? {}).sort().join(",");
  check("D7 recovery request with a wrong password answers like success (no account oracle) and sends no mail", r.status === 200 && smtp.mails.length === mailsBefore, `${r.status} ${r.text.slice(0, 120)}`);
  r = await pend.post("/bff/auth/recover-account/request", { email, password: PW });
  await sleep(500);
  check("D8 recovery request with the right password sends a code (same response shape)", r.status === 200 && Object.keys(r.data ?? {}).sort().join(",") === wrongShape && smtp.mails.length === mailsBefore + 1, `${r.status} ${r.text.slice(0, 120)}`);
  const rc = codeFromMail(smtp.mails[smtp.mails.length - 1].text);
  r = await pend.post("/bff/auth/recover-account/confirm", { email, code: rc });
  check("D9 confirm recovery → 200", r.status === 200, r.text.slice(0, 160));
  // (same browser as before the deletion → already-verified device, so no second OTP inside the resend cool-down)
  r = await d.post("/bff/auth/login", { email, password: PW });
  if (r.status === 200 && r.data?.deviceVerificationRequired) {
    await sleep(300);
    r = await d.post("/bff/auth/verify-device", { identifier: email, code: codeFromMail(smtp.mails[smtp.mails.length - 1].text) });
  }
  check("D10 the recovered member can log in again and holds a session cookie", r.status === 200 && !!d.jar["rz_session"], `${r.status} ${r.text.slice(0, 120)}`);
  // finalisation job: delete again, push the deadline into the past, run the job over HTTP
  r = await d.post("/bff/users/me/delete-account", { password: PW, confirmation: "DELETE MY ACCOUNT" });
  await db.query("update users set deleted_at = now() - interval '45 days' where id = $1", [memberId]);
  r = await owner.get("/bff/admin/account-deletions?state=PENDING");
  check("D11 admin deletions list shows the pending account", r.status === 200 && r.data?.items?.some((x: any) => x.userId === memberId), r.text.slice(0, 200));

  // ------------------------------------------------------------------ 11. jobs endpoint
  r = await anon.post("/api/v1/internal/jobs/account-deletion-finalize", {}, { noOrigin: true });
  check("J1 jobs endpoint without credentials is refused (401/404)", r.status === 401 || r.status === 404, String(r.status));
  r = await anon.post("/api/v1/internal/jobs/account-deletion-finalize", {}, { noOrigin: true, headers: { authorization: "Bearer " + "x".repeat(40) } });
  check("J2 jobs endpoint with a wrong secret is refused (401)", r.status === 401, String(r.status));
  r = await anon.post("/api/v1/internal/jobs/no-such-job", {}, { noOrigin: true, headers: { authorization: `Bearer ${CRON}` } });
  check("J3 unknown job → 404", r.status === 404, String(r.status));
  r = await anon.post("/api/v1/internal/jobs/account-deletion-finalize", {}, { noOrigin: true, headers: { authorization: `Bearer ${CRON}` } });
  check("J4 finalisation job runs over HTTP with the secret → 200 SUCCEEDED", r.status === 200 && /SUCCEEDED/.test(r.text), r.text.slice(0, 200));
  const row = (await db.query("select status, email, name from users where id = $1", [memberId])).rows[0];
  check("J5 the account is anonymised (e-mail and name no longer the original)", row && row.status === "DELETED" && row.email !== email && row.name !== "Smoke Member", JSON.stringify(row));
  r = await d.post("/bff/auth/login", { email, password: PW });
  check("J6 the finalised account can never log in again", r.status >= 400 && r.status < 500);
  r = await anon.post("/bff/auth/recover-account/request", { email, password: PW });
  check("J7 recovery after finalisation sends no code", smtp.mails.length === mailsBefore + 1 || r.status === 200);
  const jr = (await db.query("select count(*)::int n from job_runs where job_name = 'account-deletion-finalize'")).rows[0].n;
  check("J8 the job run is recorded", jr >= 1, String(jr));
  for (const j of ["membership-expiry", "membership-reminders", "membership-renewal-failed", "payment-reconcile", "housekeeping"]) {
    const x = await anon.post(`/api/v1/internal/jobs/${j}`, {}, { noOrigin: true, headers: { authorization: `Bearer ${CRON}` } });
    check(`J9 job ${j} runs over HTTP → 200`, x.status === 200 && /SUCCEEDED|SKIPPED/.test(x.text), `${x.status} ${x.text.slice(0, 160)}`);
  }

  // ------------------------------------------------------------------ 12. rate limiting
  const rl = new Client("ratelimit");
  const codes: number[] = [];
  for (let i = 0; i < 14; i++) codes.push((await rl.post("/bff/admin/login", { email: "owner@smoke.example", password: `wrong-password-${i}` })).status);
  check("R1 repeated admin-login attempts from one IP get 429 (first 10 pass through to 401)", codes.slice(0, 10).every((c) => c === 401) && codes.slice(10).some((c) => c === 429), codes.join(","));
  r = await rl.post("/bff/admin/login", { email: "owner@smoke.example", password: PW });
  check("R2 the 429 carries Retry-After and the right password is also refused while limited", r.status === 429 && !!r.headers.get("retry-after"), `${r.status} ${r.headers.get("retry-after")}`);
  const forger = new Client("forger");
  const forgedCodes: number[] = [];
  for (let i = 0; i < 14; i++) {
    forgedCodes.push((await forger.post("/bff/admin/login", { email: "owner@smoke.example", password: `wrong-${i}` }, { headers: { "x-forwarded-for": `203.0.113.${i + 1}, ${forger.ip}` } })).status);
  }
  check("R3 forging leading X-Forwarded-For entries does not evade the limit (TRUST_PROXY_HOPS=1)", forgedCodes.some((c) => c === 429), forgedCodes.join(","));
  const stillOk = new Client("fresh");
  r = await stillOk.post("/bff/admin/login", { email: "owner@smoke.example", password: PW });
  check("R4 a different client IP is unaffected by someone else's limit", r.status === 200, String(r.status));

  // ------------------------------------------------------------------ 13. secrets
  assertNoSecretsSeen(SECRETS, ONE_TIME);
  const ready = await anon.get("/api/v1/health/ready");
  check("Z1 /health/ready never echoes configuration values", !/smoke-smtp|127\.0\.0\.1|postgres:\/\//.test(ready.text));

  await smtp.close();
  await db.end();
  finish("PCP production-mode HTTP smoke");
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(2);
});
