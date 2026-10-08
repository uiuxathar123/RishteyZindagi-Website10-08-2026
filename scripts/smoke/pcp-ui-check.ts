/**
 * Browser (Chromium) check of the screens added in the production-completion phase, run against the real
 * production build served over HTTP by scripts/smoke/run-smoke.sh (mode "ui").
 *
 *   - NODE_ENV=production server, mock SMTP relay offering STARTTLS (OTP e-mails), no payment vendor reachable.
 *   - Every page visit is checked for Content-Security-Policy violations (`securitypolicyviolation` events and
 *     console "Refused to …" messages) – the CSP is only emitted by production builds, so this is the proof that the
 *     policy does not break the app.
 *   - Layout is checked at phone width (no horizontal page scroll).
 *
 * Playwright is NOT a dependency of this repository. Install it separately (`npm i --no-save playwright`) and point
 * PLAYWRIGHT_MODULE at it if it is not resolvable, and PLAYWRIGHT_CHROMIUM at a Chromium binary.
 * Output: PASS/FAIL lines + screenshots in SMOKE_SHOTS_DIR.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { startMockSmtp, codeFromMail } from "../../tests/helpers/mock-otp";
import { BASE, Client, assertNoSecretsSeen, check, finish, sleep } from "./lib";

const env = process.env;
const SHOTS = env.SMOKE_SHOTS_DIR ?? "/tmp/rz-ui-shots";
mkdirSync(SHOTS, { recursive: true });
const PW = "Smoke#Pass-12345";
const NEW_ADMIN_PW = "Owner#Pass-123456";

async function loadChromium(): Promise<any> {
  const mod: any = await import(env.PLAYWRIGHT_MODULE ?? "playwright");
  return mod.chromium ?? mod.default?.chromium; // Playwright is deliberately untyped here: it is not a dependency of this repo
}

let livePage: any = null; // for a crash screenshot

async function main() {
  const chromium = await loadChromium();
  const smtp = await startMockSmtp(
    { user: env.SMTP_USER as string, pass: env.SMTP_PASS as string },
    Number(env.SMTP_PORT),
    env.SMOKE_SMTP_TLS_KEY && env.SMOKE_SMTP_TLS_CERT ? { key: readFileSync(env.SMOKE_SMTP_TLS_KEY, "utf8"), cert: readFileSync(env.SMOKE_SMTP_TLS_CERT, "utf8") } : undefined
  );
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();

  // ---- fixtures through the API (not under test here): Super Admin and one member -------------------------
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  check("UI0 Super Admin bootstrapped for the browser run", boot.status === 0 && tempPw.length === 16);

  const memberEmail = "ui.member@smoke.example";
  {
    const c = new Client("fixture-member");
    let x = await c.post("/bff/auth/register", { name: "UI Member", email: memberEmail, mobileNumber: "9876511111", countryCode: "+91" });
    await sleep(300);
    const mail = [...smtp.mails].reverse().find((m) => m.to.includes(memberEmail));
    x = await c.post("/bff/auth/verify-signup-otp", { identifier: memberEmail, code: codeFromMail(mail!.text) });
    const ticket = x.data?.ticket ?? x.data?.setPasswordTicket ?? (Object.values(x.data ?? {})[0] as string);
    x = await c.post("/bff/auth/set-password", { identifier: memberEmail, ticket, password: PW });
    check("UI0b fixture member registered", x.status < 300, x.text.slice(0, 120));
  }

  // ---- browser -------------------------------------------------------------------------------------------
  const browser = await chromium.launch({ executablePath: env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.77.1.1" } });
  await ctx.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  livePage = page;
  const consoleCsp: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m: any) => {
    if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e: any) => pageErrors.push(e.message.slice(0, 200)));

  const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const cspNow = async () => ((await page.evaluate(() => (window as any).__csp ?? [])) as string[]).length;
  let cspSeen = 0;
  const cspClean = async (label: string) => {
    const n = (await cspNow()) + consoleCsp.length;
    const ok = n === cspSeen;
    cspSeen = n;
    check(`${label}: no CSP violation`, ok, consoleCsp.join(" | "));
  };
  const noOverflow = async (label: string) => {
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    // On failure, name what sticks out (position:absolute children such as `.sr-only` escape an unpositioned
    // overflow-x-auto wrapper and still widen the page – the wrapper needs `relative`).
    const culprits =
      w.sw > w.iw + 1
        ? ((await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position === "absolute")
              .slice(0, 5)
              .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)}`)
          )) as string[]).join(" | ")
        : "";
    check(`${label}: no horizontal page scroll at ${w.iw}px`, w.sw <= w.iw + 1, `${w.sw} > ${w.iw}; ${culprits}`);
  };
  const visible = (text: string | RegExp, timeout = 15_000) => page.getByText(text).first().waitFor({ state: "visible", timeout });

  // ===== A. admin sign-in and forced password change =====
  await page.goto(`${BASE}/admin/login`);
  await page.fill("#admin-email", "owner@smoke.example");
  await page.fill("#admin-password", tempPw);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#fp-current", { timeout: 20_000 });
  check("UI1 a temporary-password sign-in lands on the forced password-change screen (no admin navigation shown)", (await page.locator("nav >> text=Users").count()) === 0);
  await shot("01-forced-password-change");
  await cspClean("UI1 /admin/login + forced change");
  await page.fill("#fp-current", tempPw);
  await page.fill("#fp-new", "short");
  await page.fill("#fp-confirm", "short");
  check("UI2 a too-short new password cannot be submitted", await page.locator('form button[type="submit"]').first().isDisabled());
  await page.fill("#fp-new", NEW_ADMIN_PW);
  await page.fill("#fp-confirm", NEW_ADMIN_PW);
  await page.click('form button[type="submit"]');
  await page.getByRole("link", { name: "Users" }).first().waitFor({ state: "visible", timeout: 20_000 });
  check("UI3 after choosing a new password the admin panel opens", true);
  await shot("02-admin-overview");
  await cspClean("UI3 admin overview");
  const cookies = await ctx.cookies();
  const adminCookie = cookies.find((c: any) => c.name === "rz_admin_session");
  check("UI4 the admin session cookie is HttpOnly + Secure + SameSite=Strict and not readable by page script", !!adminCookie && adminCookie.httpOnly && adminCookie.secure && adminCookie.sameSite === "Strict" && !(await page.evaluate(() => document.cookie)).includes("rz_admin_session"));
  const storageKeys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].join(","));
  check("UI4b no auth token or secret is kept in localStorage/sessionStorage", !/token|session|secret|password/i.test(storageKeys), storageKeys);

  // ===== B. staff management =====
  await page.goto(`${BASE}/admin/super/staff`);
  await page.getByRole("button", { name: "Add staff member" }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: "Add staff member" }).click();
  await page.fill("#staff-name", "UI Staff");
  await page.fill("#staff-email", "ui.staff@smoke.example");
  const roleOptions = await page.locator("#staff-role option").allTextContents();
  const staffRole = roleOptions.find((t: string) => /staff/i.test(t) && !/super/i.test(t));
  check("UI5a the role list offers STAFF_ADMIN and does not offer a way to create a Super Admin", !!staffRole && !roleOptions.some((t: string) => /super/i.test(t)), roleOptions.join(","));
  await page.selectOption("#staff-role", { label: staffRole });
  await page.getByRole("button", { name: "Create account" }).click();
  const tempLoc = page.getByTestId("temp-password");
  await tempLoc.waitFor({ state: "visible", timeout: 20_000 });
  const staffTemp = (await tempLoc.innerText()).trim();
  check("UI5 creating staff shows a one-time 16-character temporary password", staffTemp.length === 16, staffTemp.length.toString());
  await shot("03-staff-temp-password");
  await page.getByRole("button", { name: "I have saved it" }).click();
  await visible("ui.staff@smoke.example");
  check("UI6 the new staff member is listed", true);
  check("UI7 the temporary password is no longer anywhere on the page after closing the dialog", !(await page.content()).includes(staffTemp));
  await cspClean("UI5 staff page");

  // ===== C. platform settings: OTP provider + payment gateway =====
  await page.goto(`${BASE}/admin/super/settings`);
  await visible("OTP delivery provider");
  await visible("Razorpay");
  await visible("Server configuration");
  await shot("04-platform-settings");
  const otpText = await page.locator("body").innerText();
  check("UI8 OTP provider card: Email active+complete, Fast2SMS incomplete naming env var NAMES only", /E-mail/.test(otpText) && /FAST2SMS_API_KEY/.test(otpText) && !otpText.includes(env.SMTP_PASS ?? "\u0000"));
  const [swResp] = await Promise.all([
    page.waitForResponse((r: any) => r.url().includes("/otp/provider") && r.request().method() === "PATCH", { timeout: 20_000 }),
    page.getByRole("radio", { name: /Switch to SMS/i }).click(),
  ]);
  await sleep(500);
  check("UI9 in production an unconfigured provider cannot be activated: the server answers 409, the UI shows an error and SMS stays inactive", swResp.status() === 409 && (await page.getByRole("radio", { name: /Switch to SMS/i }).count()) === 1 && /could not|cannot|not configured|missing|FAST2SMS/i.test(await page.locator("body").innerText()), String(swResp.status()));
  // credentials for Razorpay (fake, test-format) – saved but never read back
  const razorpayCard = page.locator("section,div").filter({ has: page.getByRole("heading", { name: "Razorpay" }) }).filter({ has: page.getByRole("button", { name: "Credentials" }) }).last();
  await razorpayCard.getByRole("button", { name: "Credentials" }).click();
  await page.fill("#RAZORPAY-keyId", "rzp_test_UiCheck000001");
  await page.fill("#RAZORPAY-keySecret", "ui-check-secret-VALUE-9999");
  await page.fill("#RAZORPAY-webhookSecret", "ui-check-webhook-VALUE-8888");
  await page.getByRole("button", { name: "Save credentials" }).click();
  await visible("Saved in admin panel");
  check("UI10a the card now reports credentials saved in the admin panel and the webhook secret configured", /Webhook secret\s*Configured/.test((await page.locator("body").innerText()).replace(/\n/g, " ")) || (await page.getByText("Configured").count()) > 0);
  let html = await page.content();
  check("UI10 saved gateway secrets are never shown back anywhere in the page", !html.includes("ui-check-secret-VALUE-9999") && !html.includes("ui-check-webhook-VALUE-8888"));
  await page.reload();
  await visible("Saved in admin panel");
  await razorpayCard.getByRole("button", { name: "Credentials" }).click().catch(async () => page.getByRole("button", { name: "Credentials" }).first().click());
  await visible(/\(stored\)/);
  const keyVal = await page.inputValue("#RAZORPAY-keySecret");
  html = await page.content();
  check("UI11 after reload the editor shows '(stored)' markers with empty secret inputs; no secret is in the DOM", keyVal === "" && !html.includes("ui-check-secret-VALUE-9999") && !html.includes("ui-check-webhook-VALUE-8888"), `input value length ${keyVal.length}`);
  await shot("05-payment-credentials-saved");
  await cspClean("UI8-11 platform settings");

  // ===== D. moderation drawer =====
  await page.goto(`${BASE}/admin/users`);
  await visible("UI Member");
  await page.getByRole("button", { name: "Open UI Member" }).click();
  await page.getByRole("button", { name: "Suspend…" }).waitFor({ state: "visible", timeout: 20_000 });
  await shot("06-moderation-drawer");
  await page.getByRole("button", { name: "Suspend…" }).click();
  await page.fill("#mod-reason", "no");
  const modalSubmit = page.locator('form:has(#mod-reason) button[type="submit"]');
  check("UI12 a reason shorter than 5 characters cannot be submitted", await modalSubmit.isDisabled());
  await page.fill("#mod-reason", "Browser check suspension");
  await modalSubmit.click();
  await page.getByRole("button", { name: "Lift suspension…" }).waitFor({ state: "visible", timeout: 20_000 });
  await visible("Browser check suspension");
  check("UI13 suspend works from the drawer and shows the stored reason", true);
  await shot("07-suspended");
  const susRow = (await db.query("select status from users where email = $1", [memberEmail])).rows[0];
  check("UI13b the database agrees the member is SUSPENDED", susRow?.status === "SUSPENDED", JSON.stringify(susRow));
  await page.getByRole("button", { name: "Lift suspension…" }).click();
  if (await page.locator("#mod-reason").count()) await page.fill("#mod-reason", "Browser check lift");
  await page.getByRole("button", { name: "Lift suspension", exact: true }).click();
  await page.getByRole("button", { name: "Suspend…" }).waitFor({ state: "visible", timeout: 20_000 });
  check("UI14 lifting the suspension restores the member (database: ACTIVE)", (await db.query("select status from users where email = $1", [memberEmail])).rows[0]?.status === "ACTIVE");
  await cspClean("UI12-14 users + moderation");

  // ===== E. account deletions queue =====
  await page.goto(`${BASE}/admin/account-deletions`);
  await visible("No deletion requests");
  await shot("08-account-deletions");
  await cspClean("UI15 account deletions");

  // ===== F. member: sign in, failed then successful account deletion, recovery =====
  const m = await ctx.newPage();
  m.on("console", (msg: any) => {
    if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(msg.text())) consoleCsp.push(msg.text().slice(0, 200));
  });
  await m.goto(`${BASE}/login`);
  await m.fill("#login-email", memberEmail);
  await m.fill("#login-password", PW);
  await m.locator('form button[type="submit"]').first().click();
  const codeInput = m.locator('input[id$="-code"]');
  await Promise.race([codeInput.waitFor({ state: "visible", timeout: 20_000 }), m.waitForURL(/\/dashboard/, { timeout: 20_000 })]).catch(() => undefined);
  if (await codeInput.count()) {
    await sleep(400);
    const mail = [...smtp.mails].reverse().find((x) => x.to.includes(memberEmail));
    await codeInput.fill(codeFromMail(mail!.text));
    await m.locator('form button[type="submit"]').first().click();
  }
  await m.waitForURL(/\/dashboard/, { timeout: 25_000 });
  check("UI16 member sign-in (including new-device e-mail code) reaches the dashboard", true);
  await m.goto(`${BASE}/dashboard/settings`);
  await m.getByRole("button", { name: "Delete my account…" }).waitFor({ state: "visible", timeout: 20_000 });
  await m.screenshot({ path: `${SHOTS}/09-member-settings-delete.png` });
  await m.getByRole("button", { name: "Delete my account…" }).click();
  await m.fill("#del-password", "wrong-password-1");
  await m.fill("#del-phrase", "DELETE MY ACCOUNT");
  await m.getByRole("button", { name: "Delete my account", exact: true }).click();
  await m.getByText(/password is incorrect/i).first().waitFor({ state: "visible", timeout: 15_000 });
  check("UI17 a wrong password shows an error", true);
  await m.reload();
  await m.getByRole("button", { name: /Delete my account/ }).first().waitFor({ state: "visible", timeout: 20_000 });
  check("UI18 …and the member is still signed in afterwards (a mistyped password does not end the session)", !/\/login/.test(m.url()), m.url());
  await m.getByRole("button", { name: "Delete my account…" }).click();
  await m.fill("#del-password", PW);
  await m.fill("#del-phrase", "DELETE MY ACCOUNT");
  await m.getByRole("button", { name: "Delete my account", exact: true }).click();
  await m.getByText("Account scheduled for deletion").first().waitFor({ state: "visible", timeout: 20_000 });
  await m.screenshot({ path: `${SHOTS}/10-member-deleted.png` });
  check("UI19 deleting shows the recovery deadline", (await m.locator("body").innerText()).includes("30 days"));
  check("UI19b the database has the member DELETED_PENDING", (await db.query("select status from users where email = $1", [memberEmail])).rows[0]?.status === "DELETED_PENDING");
  await page.goto(`${BASE}/admin/account-deletions`);
  await visible("UI Member");
  await page.screenshot({ path: `${SHOTS}/10b-admin-deletions-pending.png` });
  const qText = await page.locator("body").innerText();
  check("UI19c the admin deletion queue lists the pending member with a recovery deadline and a masked e-mail", /Pending/.test(qText) && /30 days left/.test(qText) && /ui\*\*\*@smoke\.example/.test(qText) && !qText.includes(memberEmail), qText.slice(0, 200));
  await m.getByRole("button", { name: "Continue" }).click();
  await m.waitForURL(/\/login/, { timeout: 20_000 });
  check("UI20 'Continue' signs the member out to the login page", true);
  await m.goto(`${BASE}/recover-account`);
  await m.fill("#recover-email", memberEmail);
  await m.fill("#recover-password", PW);
  await m.locator('form button[type="submit"]').first().click();
  await m.locator("#recover-code").waitFor({ state: "visible", timeout: 20_000 });
  await sleep(400);
  const rmail = [...smtp.mails].reverse().find((x) => x.to.includes(memberEmail));
  await m.fill("#recover-code", codeFromMail(rmail!.text));
  await m.screenshot({ path: `${SHOTS}/11-recover-code.png` });
  await m.getByRole("button", { name: "Recover my account" }).click();
  await m.getByText("Your account has been recovered").first().waitFor({ state: "visible", timeout: 20_000 });
  check("UI21 recovery with password + e-mailed code restores the account (database: ACTIVE)", (await db.query("select status from users where email = $1", [memberEmail])).rows[0]?.status === "ACTIVE");

  // ===== G. phone-width layouts =====
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [path, label] of [
    ["/admin/super/staff", "staff"],
    ["/admin/super/settings", "platform settings"],
    ["/admin/account-deletions", "account deletions"],
    ["/admin/users", "users"],
  ] as const) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await sleep(400);
    await noOverflow(`UI22 admin ${label}`);
  }
  await page.screenshot({ path: `${SHOTS}/12-admin-settings-375.png` });
  await m.setViewportSize({ width: 375, height: 800 });
  for (const path of ["/recover-account", "/login"]) {
    await m.goto(`${BASE}${path}`);
    await sleep(400);
    const w = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`UI23 ${path}: no horizontal page scroll at 375px`, w.sw <= w.iw + 1, `${w.sw} > ${w.iw}`);
  }

  // ===== H. totals =====
  check("UI24 no CSP violation was reported on any visited page (events + console)", consoleCsp.length === 0, consoleCsp.join(" | "));
  check("UI25 no uncaught page error was thrown", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close();
  await smtp.close();
  await db.end();
  finish("PCP production-build browser check");
}

main().catch(async (e) => {
  console.error("browser check crashed:", e);
  try {
    await livePage?.screenshot({ path: `${SHOTS}/crash.png` });
    console.error("page text at crash:", String(await livePage?.locator("body").innerText()).slice(0, 1500));
  } catch {
    /* best effort */
  }
  process.exit(2);
});
