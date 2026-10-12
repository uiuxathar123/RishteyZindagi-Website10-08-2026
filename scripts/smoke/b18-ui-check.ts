/**
 * B18 browser (Chromium) check against the real production build (run-smoke.sh mode "b18-ui").
 * Drives the three roles through the real screens, in BOTH OTP configurations:
 *   Super Admin  – OTP policy panel (confirm dialog, reason required), plans / communities / security-events screens
 *   Staff Admin  – page-level "needs permission" and "Super Admin only" screens, no nav entries for what they lack
 *   Member       – sign-up and new-device login with and without a code, Settings: privacy, notifications, devices
 * Every page is checked for CSP violations and for horizontal overflow at phone width. Screenshots go to SMOKE_SHOTS_DIR.
 * Playwright is NOT a repository dependency (see pcp-ui-check.ts for how to point PLAYWRIGHT_MODULE at it).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { deflateSync } from "node:zlib";
import { startMockSmtp, codeFromMail } from "../../tests/helpers/mock-otp";
import { BASE, Client, assertNoSecretsSeen, check, finish, sleep } from "./lib";

const env = process.env;
const SHOTS = env.SMOKE_SHOTS_DIR ?? "/tmp/rz-ui-shots";
mkdirSync(SHOTS, { recursive: true });
const PW = "Smoke#Pass-12345";
const ADMIN_PW = "Owner#Pass-123456";
const ONE_TIME: string[] = [];

function makePng(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9a)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  const mod: any = await import(env.PLAYWRIGHT_MODULE ?? "playwright");
  const chromium = mod.chromium ?? mod.default?.chromium;
  const fs = await import("node:fs");
  const smtp = await startMockSmtp(
    { user: env.SMTP_USER as string, pass: env.SMTP_PASS as string },
    Number(env.SMTP_PORT),
    env.SMOKE_SMTP_TLS_KEY && env.SMOKE_SMTP_TLS_CERT ? { key: readFileSync(env.SMOKE_SMTP_TLS_KEY, "utf8"), cert: readFileSync(env.SMOKE_SMTP_TLS_CERT, "utf8") } : undefined
  );
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const lastCode = (to: string) => { const m = [...smtp.mails].reverse().find((x) => x.to.includes(to)); return m ? codeFromMail(m.text) : ""; };

  // ---- fixtures through the API -----------------------------------------------------------------------------
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  const owner = new Client("owner");
  await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  let x = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: ADMIN_PW });
  check("B0 Super Admin bootstrapped", boot.status === 0 && x.status === 200);

  const memberEmail = "ui.member@smoke.example";
  const mc = new Client("fixture-member");
  await mc.post("/bff/auth/register", { name: "UI Member", email: memberEmail, mobileNumber: "9876522222", countryCode: "+91" });
  await sleep(300);
  x = await mc.post("/bff/auth/verify-signup-otp", { identifier: memberEmail, code: lastCode(memberEmail) });
  x = await mc.post("/bff/auth/set-password", { identifier: memberEmail, ticket: x.data?.ticket, password: PW });
  const ref = async (sql: string) => (await db.query(sql)).rows[0].id as string;
  const religionId = await ref("select id from religions order by name limit 1");
  const countryId = await ref("select id from countries order by name limit 1");
  const cityId = (await db.query("insert into cities(id,name,country_id) values (gen_random_uuid(),'Uitown',$1) returning id", [countryId])).rows[0].id;
  const communityId = (await db.query("insert into communities(id,name,religion_id) values (gen_random_uuid(),'UI Community',$1) returning id", [religionId])).rows[0].id;
  await mc.post("/bff/profiles/me", { gender: "FEMALE", dateOfBirth: "1996-04-12" });
  await mc.patch("/bff/profiles/me", { religionId, communityId, countryId, cityId, motherTongueId: await ref("select id from mother_tongues limit 1"), educationId: await ref("select id from educations limit 1"), professionId: await ref("select id from professions limit 1"), maritalStatusId: await ref("select id from marital_statuses limit 1"), incomeRange: "10-15 LPA", incomeCurrency: "INR", heightCm: 165 });
  const fd = new FormData();
  fd.set("photo", new Blob([new Uint8Array(makePng(300, 300))], { type: "image/png" }), "p.png");
  await fetch(BASE + "/bff/profiles/me/photos", { method: "POST", headers: { cookie: mc.cookieHeader(), Origin: BASE, "x-forwarded-for": mc.ip }, body: fd });
  check("B0b fixture member has a ready profile", (await db.query("select profile_status from profiles limit 1")).rows[0]?.profile_status === "READY_FOR_VISIBILITY");

  // a staff role that holds only audit.view, plus its account
  x = await owner.post("/bff/admin/roles", { name: "UI_AUDITOR", description: "ui check", permissions: ["audit.view"] });
  x = await owner.post("/bff/admin/staff", { name: "UI Auditor", email: "auditor@smoke.example", roleName: "UI_AUDITOR" });
  const audTemp = x.data?.temporaryPassword as string; ONE_TIME.push(audTemp);
  const sc = new Client("auditor");
  await sc.post("/bff/admin/login", { email: "auditor@smoke.example", password: audTemp });
  await sc.post("/bff/admin/me/password", { currentPassword: audTemp, newPassword: "Auditor#Pass-1234" });

  // ---- browser plumbing ---------------------------------------------------------------------------------------
  const browser = await chromium.launch({ executablePath: env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium", headless: true });
  let ipSeq = 1;
  const newSession = async (viewport = { width: 1280, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { "x-forwarded-for": `10.78.1.${++ipSeq}` } });
    await ctx.addInitScript(() => { (window as any).__csp = []; document.addEventListener("securitypolicyviolation", (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    const page = await ctx.newPage();
    const csp: string[] = [];
    const errs: string[] = [];
    page.on("console", (m: any) => { if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
    page.on("pageerror", (e: any) => errs.push(e.message.slice(0, 160)));
    return { ctx, page, csp, errs };
  };
  const shot = (page: any, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  const clean = async (s: any, label: string) => {
    const n = ((await s.page.evaluate(() => (window as any).__csp ?? [])) as string[]).length + s.csp.length;
    check(`${label}: no CSP violation and no uncaught page error`, n === 0 && s.errs.length === 0, `${s.csp.join("|")} ${s.errs.join("|")}`);
  };
  const noOverflow = async (page: any, label: string) => {
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`${label}: no horizontal page scroll at ${w.iw}px`, w.sw <= w.iw + 1, `${w.sw} > ${w.iw}`);
  };
  const see = (page: any, t: string | RegExp, timeout = 15_000) => page.getByText(t).first().waitFor({ state: "visible", timeout });
  const memberLogin = async (page: any, email: string, pw = PW) => {
    await page.goto(`${BASE}/login`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", pw);
    await page.locator('form button[type="submit"]').first().click();
  };

  // ===== 1. Super Admin: OTP policy =============================================================================
  const A = await newSession();
  await A.page.goto(`${BASE}/admin/login`);
  await A.page.fill("#admin-email", "owner@smoke.example");
  await A.page.fill("#admin-password", ADMIN_PW);
  await A.page.click('button[type="submit"]');
  await A.page.getByRole("link", { name: "Users" }).first().waitFor({ state: "visible", timeout: 20_000 });
  await A.page.goto(`${BASE}/admin/super/settings`);
  await see(A.page, "Using the safe default");
  const nd = A.page.getByTestId("otp-policy-NEW_DEVICE_LOGIN");
  const su = A.page.getByTestId("otp-policy-SIGNUP_VERIFICATION");
  check("O1 both configurable workflows start as 'OTP required' (safe default)", (await nd.innerText()).includes("OTP required") && (await su.innerText()).includes("OTP required"));
  await shot(A.page, "b18-01-otp-policy-default");
  await nd.getByRole("button", { name: /Stop requiring a code/ }).click();
  const confirm = A.page.getByRole("button", { name: "Yes, stop requiring a code" });
  check("O2 the confirm dialog cannot be submitted without a reason", await confirm.isDisabled());
  await A.page.fill("#otp-policy-reason", "ok");
  check("O2b …nor with a 2-character reason", await confirm.isDisabled());
  await A.page.fill("#otp-policy-reason", "Browser check: trusted pilot group");
  await Promise.all([A.page.waitForResponse((r: any) => r.url().includes("/otp/policy") && r.request().method() === "PATCH", { timeout: 20_000 }), confirm.click()]);
  await see(A.page, /no longer required/);
  check("O3 'New-device login verification' now shows 'OTP not required' with a warning, sign-up still 'OTP required'", (await nd.innerText()).includes("OTP not required") && (await su.innerText()).includes("OTP required"));
  await shot(A.page, "b18-02-otp-policy-not-required");
  await clean(A, "O1-3 platform settings");
  await noOverflow(A.page, "O platform settings");

  // ===== 2. Member: new-device login WITHOUT a code ===============================================================
  const M1 = await newSession();
  const mailsBefore = smtp.mails.length;
  await memberLogin(M1.page, memberEmail);
  await M1.page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  check("L1 [new-device OTP not required] correct password on a brand-new browser goes straight to the dashboard", true);
  check("L2 …and no code was e-mailed", smtp.mails.length === mailsBefore);
  const bad = await newSession();
  await memberLogin(bad.page, memberEmail, "Wrong#Pass-00000");
  await see(bad.page, /invalid|incorrect|wrong/i);
  check("L3 a wrong password is still refused in the browser (stays on /login)", /\/login/.test(bad.page.url()));
  await bad.ctx.close();

  // ===== 3. Member Settings: privacy, notifications, devices ======================================================
  await M1.page.goto(`${BASE}/dashboard/settings`);
  await see(M1.page, "Hide my profile");
  await see(M1.page, "This device");
  await shot(M1.page, "b18-03-member-settings");
  const hide = M1.page.getByRole("switch", { name: "Hide my profile" });
  check("S1 'Hide my profile' starts off", (await hide.getAttribute("aria-checked")) === "false");
  const [pv] = await Promise.all([M1.page.waitForResponse((r: any) => r.url().includes("/users/me/privacy") && r.request().method() === "PATCH", { timeout: 20_000 }), hide.click()]);
  await sleep(300);
  check("S2 toggling saves through the API (200) and the switch reflects it", pv.status() === 200 && (await hide.getAttribute("aria-checked")) === "true");
  await M1.page.reload();
  await see(M1.page, "Hide my profile");
  check("S3 the choice survives a reload", (await M1.page.getByRole("switch", { name: "Hide my profile" }).getAttribute("aria-checked")) === "true");
  const [pv2] = await Promise.all([M1.page.waitForResponse((r: any) => r.url().includes("/users/me/privacy") && r.request().method() === "PATCH", { timeout: 20_000 }), M1.page.selectOption("#photo-visibility", "ACCEPTED_ONLY")]);
  check("S4 photo visibility saves (200)", pv2.status() === 200);
  const email = M1.page.getByRole("switch", { name: "E-mail" });
  const [pv3] = await Promise.all([M1.page.waitForResponse((r: any) => r.url().includes("/notification-preferences") && r.request().method() === "PATCH", { timeout: 20_000 }), email.click()]);
  check("S5 notification preference saves (200) and persists in the database", pv3.status() === 200 && (await db.query("select notification_preferences p from users where email=$1", [memberEmail])).rows[0].p.EMAIL === false);
  const vis = (await db.query("select profile_visibility v, photo_visibility p from profiles limit 1")).rows[0];
  check("S6 the database holds the chosen privacy values", vis.v === "HIDDEN" && vis.p === "ACCEPTED_ONLY", JSON.stringify(vis));
  check("S7 the settings page no longer lists privacy / notifications as 'not available'", !/Privacy controls\s*—/.test(await M1.page.locator("body").innerText()) && (await M1.page.getByRole("button", { name: /^Change (e-?mail|mobile)/i }).count()) === 2); // B19 replaced the old "not available" note with a real change flow
  await clean(M1, "S settings");
  await M1.page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(M1.page, "S member settings");
  await shot(M1.page, "b18-04-member-settings-phone");
  // restore for later steps
  await M1.page.setViewportSize({ width: 1280, height: 900 });
  await db.query("update profiles set profile_visibility='VISIBLE', photo_visibility='MEMBERS'");

  // second browser as the same member = a second device appears in the list and can be signed out from the first
  const M2 = await newSession();
  await memberLogin(M2.page, memberEmail);
  await M2.page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  await M1.page.reload();
  await see(M1.page, "Sign out this device");
  const [rv] = await Promise.all([M1.page.waitForResponse((r: any) => /users\/me\/sessions\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === "DELETE", { timeout: 20_000 }), M1.page.getByRole("button", { name: "Sign out this device" }).first().click()]);
  check("D1 signing out the other device from Settings returns 200", rv.status() === 200);
  await M2.page.goto(`${BASE}/dashboard/settings`);
  await M2.page.waitForURL(/\/login/, { timeout: 20_000 }).catch(() => undefined);
  check("D2 the other browser is signed out at once (redirected to /login)", /\/login/.test(M2.page.url()), M2.page.url());
  await M2.ctx.close();

  // ===== 4. Switch back: OTP required for new devices ==============================================================
  await A.page.reload();
  await see(A.page, "OTP not required");
  await Promise.all([A.page.waitForResponse((r: any) => r.url().includes("/otp/policy") && r.request().method() === "PATCH"), A.page.getByTestId("otp-policy-NEW_DEVICE_LOGIN").getByRole("button", { name: "Require a code again" }).click()]);
  await see(A.page, /a code is now required/);
  const M3 = await newSession();
  const mails3 = smtp.mails.length;
  await memberLogin(M3.page, memberEmail);
  await M3.page.locator('input[id$="-code"]').first().waitFor({ state: "visible", timeout: 20_000 });
  await sleep(500);
  check("L4 [new-device OTP required] a new browser is asked for a code, not sent to the dashboard, and a code is e-mailed", !/\/dashboard/.test(M3.page.url()) && smtp.mails.length === mails3 + 1, M3.page.url());
  await shot(M3.page, "b18-05-new-device-code-step");
  await M3.ctx.close();

  // ===== 5. Sign-up in the browser: with a code, then without ======================================================
  const fillSignup = async (page: any, name: string, mail: string, mobile: string) => {
    await page.goto(`${BASE}/signup`);
    await page.fill("#su-name", name);
    await page.selectOption("#su-gender", "MALE");
    await page.fill("#su-dob", "1992-07-01");
    await page.fill("#su-mobile", mobile);
    await page.fill("#su-email", mail);
    await page.locator('form button[type="submit"]').first().click();
  };
  const SU1 = await newSession();
  await fillSignup(SU1.page, "Code Signup", "code.signup@smoke.example", "9876533331");
  await see(SU1.page, /Verify your/);
  await sleep(400);
  check("G1 [sign-up OTP required] the browser shows the verification step and a code was e-mailed", smtp.mails.some((m) => m.to.includes("code.signup@smoke.example")));
  await shot(SU1.page, "b18-06-signup-code-step");
  await SU1.ctx.close();

  x = await owner.patch("/bff/admin/otp/policy", { workflow: "SIGNUP_VERIFICATION", requirement: "OTP_NOT_REQUIRED", reason: "Browser check sign-up" });
  check("G2 Super Admin turns the sign-up code off (API)", x.status === 200);
  const SU2 = await newSession();
  const mails4 = smtp.mails.length;
  await fillSignup(SU2.page, "Nocode Signup", "nocode.signup@smoke.example", "9876533332");
  await see(SU2.page, "Set a password");
  check("G3 [sign-up OTP not required] the browser skips the code step straight to 'Set a password' and e-mails nothing", smtp.mails.length === mails4);
  await SU2.page.fill("#su-password", PW);
  await SU2.page.fill("#su-password-confirm", PW);
  await SU2.page.locator('form button[type="submit"]').first().click();
  await see(SU2.page, "Your account is ready!");
  const u = (await db.query("select email_verified_at v from users where email='nocode.signup@smoke.example'")).rows[0];
  check("G4 the account exists and its e-mail is recorded as NOT verified", !!u && u.v === null);
  await shot(SU2.page, "b18-07-signup-no-code-done");
  await clean(SU2, "G sign-up");
  await SU2.ctx.close();
  await owner.patch("/bff/admin/otp/policy", { workflow: "SIGNUP_VERIFICATION", requirement: "OTP_REQUIRED" });

  // ===== 6. Super Admin screens ====================================================================================
  await A.page.goto(`${BASE}/admin/super/membership-plans`);
  await see(A.page, "Membership Plans");
  await A.page.getByRole("button", { name: /Add plan|New plan/i }).first().waitFor({ state: "visible", timeout: 15_000 });
  const rows = await A.page.locator("table tbody tr").count();
  check("P1 the plans screen lists the seeded plans from the API", rows >= 1, String(rows));
  await shot(A.page, "b18-08-plans");
  await clean(A, "P plans");
  await A.page.goto(`${BASE}/admin/super/communities`);
  await see(A.page, "Add community");
  await A.page.getByRole("button", { name: "Add community" }).first().click();
  await A.page.selectOption("#community-religion", religionId);
  await A.page.fill("#community-name", "Browser Added Community");
  const [cr] = await Promise.all([A.page.waitForResponse((r: any) => /admin\/communities$/.test(r.url()) && r.request().method() === "POST", { timeout: 20_000 }), A.page.getByRole("button", { name: "Add", exact: true }).click()]);
  check("P2 adding a community from the screen works (2xx) and it is stored", cr.status() < 300 && (await db.query("select 1 from communities where name='Browser Added Community'")).rowCount === 1);
  await A.page.fill("#comm-search", "Browser Added");
  await see(A.page, "Browser Added Community");
  await shot(A.page, "b18-09-communities");
  await A.page.goto(`${BASE}/admin/super/security-events`);
  await see(A.page, "Security Events");
  await A.page.selectOption("#se-type", "CHANGES");
  await sleep(800);
  check("P3 the security-events screen shows recent security-relevant changes (the OTP policy edits)", /otp|policy/i.test(await A.page.locator("body").innerText()));
  await shot(A.page, "b18-10-security-events");
  await clean(A, "P super screens");
  await A.page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(A.page, "P security events");

  // ===== 7. Staff Admin with only audit.view =======================================================================
  const S = await newSession();
  await S.page.goto(`${BASE}/admin/login`);
  await S.page.fill("#admin-email", "auditor@smoke.example");
  await S.page.fill("#admin-password", "Auditor#Pass-1234");
  await S.page.click('button[type="submit"]');
  await S.page.waitForURL((u: URL) => /\/admin/.test(u.pathname) && !/\/admin\/login/.test(u.pathname), { timeout: 20_000 });
  await sleep(800);
  check("T0 a Staff Admin on a CUSTOM role lands inside the panel after sign-in (not bounced back to the login page)", !/\/admin\/login/.test(S.page.url()), S.page.url());
  check("T1 the navigation hides Users / Reports for a role without those permissions", (await S.page.getByRole("link", { name: "Users" }).count()) === 0 && (await S.page.getByRole("link", { name: "Reports" }).count()) === 0);
  await S.page.goto(`${BASE}/admin/users`);
  await see(S.page, "You need permission for this page").catch(async (e: any) => { await shot(S.page, "b18-debug-staff-users"); console.log("DEBUG body:", (await S.page.locator("body").innerText()).slice(0, 400)); throw e; });
  check("T2 typing /admin/users shows a clear 'needs permission' screen naming the permission, not a wall of errors", /users\.view/.test(await S.page.locator("body").innerText()));
  await shot(S.page, "b18-11-staff-needs-permission");
  await S.page.goto(`${BASE}/admin/reports`);
  await see(S.page, "You need permission for this page");
  await S.page.goto(`${BASE}/admin/super/membership-plans`);
  await see(S.page, "Super Admin only");
  check("T3 Super Admin pages show 'Super Admin only'", true);
  await S.page.goto(`${BASE}/admin/super/settings`);
  await see(S.page, "Super Admin only");
  await clean(S, "T staff");
  // revocation: Super Admin removes audit.view; the next API call by the staff member is refused
  const roleId = (await db.query("select id from admin_roles where name='UI_AUDITOR'")).rows[0].id;
  const before = await sc.get("/bff/admin/audit-logs");
  await owner.put(`/bff/admin/roles/${roleId}/permissions`, { permissions: [] });
  const after = await sc.get("/bff/admin/audit-logs");
  check("T4 removing a permission takes effect on the staff member's next request (200 → 403)", before.status === 200 && after.status === 403, `${before.status}→${after.status}`);
  await shot(S.page, "b18-12-staff-super-only");

  assertNoSecretsSeen((env.SMOKE_SECRETS ?? "").split(",").filter(Boolean), ONE_TIME);
  await browser.close();
  await db.end();
  await smtp.close();
  finish("B18 browser check");
}

main().catch((e) => { console.error("ui check crashed:", e); process.exit(2); });
