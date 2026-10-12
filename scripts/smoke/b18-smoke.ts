#!/usr/bin/env -S npx tsx
/**
 * B18 real-HTTP smoke test against a RUNNING PRODUCTION-MODE server (NODE_ENV=production, `next start`),
 * orchestrated by `scripts/smoke/run-smoke.sh b18`. Everything goes over TCP through the real middleware,
 * BFF proxy, route handlers and PostgreSQL; the only fake is the SMTP relay that receives the OTP e-mails.
 *
 * Covers, for the three roles (Member / Super Admin / Staff Admin):
 *   - the OTP-required AND the OTP-not-required configurations (new-device login + sign-up), incl. what must
 *     NOT change (password check, account status, password reset, admin login)
 *   - unauthorized direct calls to every new admin / member-settings API
 *   - Staff Admin permission enforcement and immediate revocation
 *   - plans, communities, platform settings (search + sign-up switch), security events, reconcile
 *   - member privacy / notification / session controls, profile-ID search and the advanced-search gate
 *   - no secret value in any response
 */
import { spawnSync } from "node:child_process";
import pg from "pg";
import { deflateSync } from "node:zlib";
import { startMockSmtp, codeFromMail } from "../../tests/helpers/mock-otp";
import { BASE, Client, assertNoSecretsSeen, check, finish, sleep } from "./lib";

const env = process.env;
const PW = "Smoke#Pass-12345";
const SECRETS = (env.SMOKE_SECRETS ?? "").split(",").filter(Boolean);
const ONE_TIME: string[] = []; // temporary passwords the API hands out exactly once

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

async function main() {
  const fs = await import("node:fs");
  const tls = env.SMOKE_SMTP_TLS_KEY && env.SMOKE_SMTP_TLS_CERT ? { key: fs.readFileSync(env.SMOKE_SMTP_TLS_KEY, "utf8"), cert: fs.readFileSync(env.SMOKE_SMTP_TLS_CERT, "utf8") } : undefined;
  const smtp = await startMockSmtp({ user: env.SMTP_USER as string, pass: env.SMTP_PASS as string }, Number(env.SMTP_PORT), tls);
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const anon = new Client("anon");
  const lastCode = (to: string) => { const m = [...smtp.mails].reverse().find((x) => x.to.includes(to)); return m ? codeFromMail(m.text) : ""; };

  // ------------------------------------------------------------------ 0. bootstrap Super Admin
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  SECRETS.push(tempPw);
  const owner = new Client("owner");
  let r = await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  r = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: PW });
  check("00 Super Admin bootstrapped and signed in", r.status === 200, r.text.slice(0, 120));

  // ------------------------------------------------------------------ 1. unauthorized direct calls (anonymous)
  const ADMIN_B18: Array<[string, string, unknown?]> = [
    ["GET", "/bff/admin/otp/policy"], ["PATCH", "/bff/admin/otp/policy", { workflow: "NEW_DEVICE_LOGIN", requirement: "OTP_NOT_REQUIRED" }],
    ["GET", "/bff/admin/platform-settings"], ["PATCH", "/bff/admin/platform-settings", { signup: { open: false } }],
    ["GET", "/bff/admin/membership-plans"], ["POST", "/bff/admin/membership-plans", { code: "EVIL", name: "Evil", currency: "INR", priceInSmallestUnit: 100, durationDays: 30 }],
    ["GET", "/bff/admin/communities"], ["POST", "/bff/admin/communities", { name: "Evil", religionId: "00000000-0000-4000-8000-000000000000" }],
    ["GET", "/bff/admin/security-events"], ["GET", "/bff/admin/payments/reconcile"], ["POST", "/bff/admin/payments/reconcile", {}],
  ];
  for (const [m, p, b] of ADMIN_B18) {
    const x = await anon.req(m, p, b);
    check(`U1 anonymous ${m} ${p.replace("/bff/admin", "")} → 401`, x.status === 401, String(x.status));
  }
  for (const p of ["/bff/users/me/privacy", "/bff/users/me/notification-preferences", "/bff/users/me/sessions"]) {
    const x = await new Client("anon2").get(p);
    check(`U2 anonymous GET ${p.replace("/bff", "")} → 401`, x.status === 401, String(x.status));
  }
  r = await anon.get("/bff/search/access");
  check("U3 GET /search/access works signed-out (never 401) and says advanced search is locked", r.status === 200 && r.data?.audience === "visitor" && r.data?.advancedSearch === false, r.text.slice(0, 160));

  // ------------------------------------------------------------------ 2. OTP-REQUIRED configuration (the default)
  r = await owner.get("/bff/admin/otp/policy");
  const pol = (w: string) => r.data?.policy?.[w];
  check("P1 default policy is OTP_REQUIRED for both configurable workflows", r.status === 200 && pol("NEW_DEVICE_LOGIN") === "OTP_REQUIRED" && pol("SIGNUP_VERIFICATION") === "OTP_REQUIRED", r.text.slice(0, 300));

  const m1 = new Client("member1");
  const email1 = "member1@smoke.example";
  r = await m1.post("/bff/auth/register", { name: "Smoke Member One", email: email1, mobileNumber: "9876500011", countryCode: "+91" });
  await sleep(300);
  check("P2 [OTP required] sign-up sends a code through SMTP and does not hand out a ticket", r.status < 300 && r.data?.otpRequired !== false && !r.data?.ticket && smtp.mails.some((x) => x.to.includes(email1)), r.text.slice(0, 200));
  r = await m1.post("/bff/auth/set-password", { identifier: email1, ticket: "forged-ticket-value", password: PW });
  check("P3 [OTP required] set-password with a forged ticket is refused (4xx)", r.status >= 400 && r.status < 500, String(r.status));
  r = await m1.post("/bff/auth/verify-signup-otp", { identifier: email1, code: lastCode(email1) });
  r = await m1.post("/bff/auth/set-password", { identifier: email1, ticket: r.data?.ticket, password: PW });
  check("P4 [OTP required] member 1 signs up through the e-mailed code and holds a session", r.status < 300 && !!m1.jar["rz_session"], r.text.slice(0, 160));
  const m1Id = (await m1.get("/bff/users/me")).data?.user?.id as string;
  const emailVerified1 = (await db.query("select email_verified_at is not null v from users where id=$1", [m1Id])).rows[0]?.v;
  check("P5 [OTP required] the contact is recorded as verified", emailVerified1 === true);

  const dev2 = new Client("member1-newdevice");
  const mailsBefore = smtp.mails.length;
  r = await dev2.post("/bff/auth/login", { email: email1, password: PW });
  await sleep(300);
  check("P6 [OTP required] login from a NEW device answers deviceVerificationRequired, sets no session cookie and e-mails a code", r.status === 200 && r.data?.deviceVerificationRequired === true && !dev2.jar["rz_session"] && smtp.mails.length === mailsBefore + 1, `${r.status} ${r.text.slice(0, 160)}`);
  r = await dev2.post("/bff/auth/verify-device", { identifier: email1, code: "000000" });
  check("P7 [OTP required] a wrong device code is refused", r.status >= 400 && r.status < 500 && !dev2.jar["rz_session"], String(r.status));
  r = await dev2.post("/bff/auth/verify-device", { identifier: email1, code: lastCode(email1) });
  check("P8 [OTP required] the right code completes the login", r.status === 200 && !!dev2.jar["rz_session"], r.text.slice(0, 160));

  // staff + member cannot touch the policy
  r = await owner.post("/bff/admin/staff", { name: "Smoke Staff", email: "staff@smoke.example", roleName: "STAFF_ADMIN" });
  const staffTemp = r.data?.temporaryPassword as string; ONE_TIME.push(staffTemp);
  const staff = new Client("staff");
  await staff.post("/bff/admin/login", { email: "staff@smoke.example", password: staffTemp });
  await staff.post("/bff/admin/me/password", { currentPassword: staffTemp, newPassword: "Staff#Pass-123456" });
  const policyBody = { workflow: "NEW_DEVICE_LOGIN", requirement: "OTP_NOT_REQUIRED", reason: "smoke" };
  r = await staff.patch("/bff/admin/otp/policy", policyBody);
  check("P9 Staff Admin cannot change the OTP policy (403)", r.status === 403, String(r.status));
  r = await staff.get("/bff/admin/otp/policy");
  check("P10 Staff Admin cannot even read the OTP policy (403)", r.status === 403, String(r.status));
  r = await m1.patch("/bff/admin/otp/policy", policyBody);
  check("P11 a member session cannot change the OTP policy (401/403)", r.status === 401 || r.status === 403, String(r.status));
  for (const [m, p, b] of ADMIN_B18) {
    const x = await m1.req(m, p, b);
    check(`P12 member session ${m} ${p.replace("/bff/admin", "")} → 401/403`, x.status === 401 || x.status === 403, String(x.status));
  }
  // member1 session may have been cleared by the BFF on 401; sign in again for later sections
  if (!m1.jar["rz_session"]) { r = await m1.post("/bff/auth/login", { email: email1, password: PW }); }
  const policyBefore = (await db.query("select value from platform_settings where key='otp.policy'")).rows[0];
  check("P13 nothing was written to the policy by the refused attempts", !policyBefore || JSON.stringify(policyBefore.value).indexOf("OTP_NOT_REQUIRED") === -1, JSON.stringify(policyBefore));

  // ------------------------------------------------------------------ 3. OTP-NOT-REQUIRED configuration
  r = await owner.patch("/bff/admin/otp/policy", { workflow: "PASSWORD_RESET", requirement: "OTP_NOT_REQUIRED" });
  check("N1 password reset can NOT be made OTP-less (4xx)", r.status >= 400 && r.status < 500, `${r.status} ${r.text.slice(0, 120)}`);
  for (const w of ["ACCOUNT_RECOVERY", "ADMIN_LOGIN", "PAYMENT"]) {
    const x = await owner.patch("/bff/admin/otp/policy", { workflow: w, requirement: "OTP_NOT_REQUIRED" });
    check(`N2 ${w} can NOT be made OTP-less (4xx)`, x.status >= 400 && x.status < 500, String(x.status));
  }
  r = await owner.patch("/bff/admin/otp/policy", { workflow: "NEW_DEVICE_LOGIN", requirement: "MAYBE" });
  check("N3 an invalid requirement value is rejected (400)", r.status === 400, String(r.status));
  r = await owner.patch("/bff/admin/otp/policy", policyBody);
  check("N4 Super Admin sets NEW_DEVICE_LOGIN → OTP_NOT_REQUIRED", r.status === 200, r.text.slice(0, 200));
  r = await owner.patch("/bff/admin/otp/policy", { workflow: "SIGNUP_VERIFICATION", requirement: "OTP_NOT_REQUIRED", reason: "smoke" });
  check("N5 Super Admin sets SIGNUP_VERIFICATION → OTP_NOT_REQUIRED", r.status === 200, r.text.slice(0, 200));
  r = await owner.get("/bff/admin/otp/policy");
  check("N6 the view reports who changed it and when", r.status === 200 && /OTP_NOT_REQUIRED/.test(r.text) && /updatedAt|changedAt|updatedBy/.test(r.text), r.text.slice(0, 400));
  const aud = (await db.query("select actor_type, metadata from audit_logs where metadata->>'setting'='otp.policy' order by created_at")).rows;
  check("N7 each policy change is audited with previous and new value", aud.length >= 2 && aud.every((a) => a.actor_type === "ADMIN") && JSON.stringify(aud[aud.length - 1].metadata).includes("OTP_NOT_REQUIRED"), JSON.stringify(aud.map((a) => a.metadata)).slice(0, 300));

  // new-device login, wrong password still fails; right password gets a session with no mail
  const dev3 = new Client("member1-device3");
  const mailsN = smtp.mails.length;
  r = await dev3.post("/bff/auth/login", { email: email1, password: "Wrong#Pass-00000" });
  check("N8 [OTP not required] a WRONG password is still refused on a new device (401)", r.status === 401 && !dev3.jar["rz_session"], String(r.status));
  r = await dev3.post("/bff/auth/login", { email: email1, password: PW });
  check("N9 [OTP not required] correct password on a new device → session, no code e-mailed", r.status === 200 && !!dev3.jar["rz_session"] && r.data?.deviceVerificationRequired !== true && smtp.mails.length === mailsN, `${r.status} ${r.text.slice(0, 160)}`);
  check("N10 [OTP not required] the session token is still never in the response body", !/sessionToken/.test(r.text));
  r = await owner.post(`/bff/admin/users/${m1Id}/suspend`, { reason: "Smoke test suspension" });
  const dev4 = new Client("member1-device4");
  r = await dev4.post("/bff/auth/login", { email: email1, password: PW });
  check("N11 [OTP not required] a SUSPENDED account is still refused (4xx)", r.status >= 400 && r.status < 500 && !dev4.jar["rz_session"], String(r.status));
  r = await owner.post(`/bff/admin/users/${m1Id}/lift-suspension`, {});
  check("N12 suspension lifted", r.status === 200, r.text.slice(0, 100));
  r = await dev3.post("/bff/auth/login", { email: email1, password: PW }); // suspension revoked every session; same (known) browser signs in again

  // sign-up without OTP
  const m2 = new Client("member2");
  const email2 = "member2@smoke.example";
  const mailsS = smtp.mails.length;
  r = await m2.post("/bff/auth/register", { name: "Smoke Member Two", email: email2, mobileNumber: "9876500012", countryCode: "+91" });
  await sleep(300);
  check("N13 [OTP not required] sign-up returns otpRequired:false with a server ticket and sends NO e-mail", r.status < 300 && r.data?.otpRequired === false && !!r.data?.ticket && smtp.mails.length === mailsS, `${r.status} ${r.text.slice(0, 200)}`);
  const t2 = r.data?.ticket;
  r = await m2.post("/bff/auth/set-password", { identifier: email2, ticket: "forged-ticket-value", password: PW });
  check("N14 [OTP not required] a forged ticket is still refused", r.status >= 400 && r.status < 500, String(r.status));
  r = await m2.post("/bff/auth/set-password", { identifier: email2, ticket: t2, password: "short" });
  check("N15 [OTP not required] the password rules still apply (400)", r.status === 400, String(r.status));
  r = await m2.post("/bff/auth/set-password", { identifier: email2, ticket: t2, password: PW });
  check("N16 [OTP not required] member 2 completes sign-up and holds a session", r.status < 300 && !!m2.jar["rz_session"], r.text.slice(0, 160));
  const v2 = (await db.query("select email_verified_at, mobile_verified_at from users where email=$1", [email2])).rows[0];
  check("N17 [OTP not required] the contact is honestly recorded as NOT verified", v2 && v2.email_verified_at === null && v2.mobile_verified_at === null, JSON.stringify(v2));
  const mailsP = smtp.mails.length;
  r = await new Client("reset").post("/bff/auth/forgot-password", { email: email1 });
  await sleep(400);
  check("N18 [OTP not required] password RESET still e-mails a code (never configurable)", smtp.mails.length === mailsP + 1, `${r.status} mails ${smtp.mails.length - mailsP}`);
  r = await new Client("adm").post("/bff/admin/login", { email: "owner@smoke.example", password: "Wrong#Pass-00000" });
  check("N19 [OTP not required] admin login is unaffected: wrong password → 401", r.status === 401, String(r.status));

  // ------------------------------------------------------------------ 4. platform settings: sign-up switch + search settings
  r = await owner.patch("/bff/admin/platform-settings", { signup: { open: false, closedMessage: "Closed for smoke test" } });
  check("S1 Super Admin closes sign-up", r.status === 200, r.text.slice(0, 160));
  r = await new Client("late").post("/bff/auth/register", { name: "Late Member", email: "late@smoke.example", mobileNumber: "9876500013", countryCode: "+91" });
  check("S2 a closed sign-up refuses new registrations (503) with the configured message", r.status === 503 && /Closed for smoke test/.test(r.text), `${r.status} ${r.text.slice(0, 160)}`);
  r = await dev3.get("/bff/users/me");
  check("S3 existing members are unaffected by closed sign-up", r.status === 200);
  r = await owner.patch("/bff/admin/platform-settings", { signup: { open: true } });
  check("S4 sign-up re-opened", r.status === 200);
  r = await owner.patch("/bff/admin/platform-settings", { search: { defaultPageSize: 3, maxPageSize: 5 } });
  check("S5 search page-size settings below the allowed range are refused (400)", r.status === 400, String(r.status));
  r = await owner.patch("/bff/admin/platform-settings", { search: { defaultPageSize: 10, maxPageSize: 30 } });
  check("S6 valid search page-size settings accepted", r.status === 200, r.text.slice(0, 200));
  r = await staff.patch("/bff/admin/platform-settings", { signup: { open: false } });
  check("S7 default Staff Admin cannot change platform settings (403)", r.status === 403, String(r.status));

  // ------------------------------------------------------------------ 5. plans, communities, role-based Staff Admin
  r = await owner.get("/bff/admin/membership-plans");
  check("R1 Super Admin lists plans", r.status === 200 && (r.data?.plans ?? r.data?.items ?? []).length >= 1, r.text.slice(0, 160));
  r = await owner.post("/bff/admin/membership-plans", { code: "SMOKE_PLAN", name: "Smoke Plan", currency: "INR", priceInSmallestUnit: 99900, durationDays: 90, advancedSearch: true });
  const planId = r.data?.plan?.id ?? r.data?.id;
  check("R2 create plan", r.status < 300 && !!planId, r.text.slice(0, 200));
  r = await owner.post("/bff/admin/membership-plans", { code: "SMOKE_PLAN", name: "Dup", currency: "INR", priceInSmallestUnit: 99900, durationDays: 90 });
  check("R3 duplicate plan code → 409", r.status === 409, String(r.status));
  r = await owner.post("/bff/admin/membership-plans", { code: "BAD", name: "Bad", currency: "INR", priceInSmallestUnit: 5, durationDays: 90 });
  check("R4 price below minimum → 400", r.status === 400, String(r.status));
  r = await owner.patch(`/bff/admin/membership-plans/${planId}`, { priceInSmallestUnit: 109900, isActive: false });
  check("R5 edit price + deactivate", r.status === 200, r.text.slice(0, 160));
  r = await m2.get("/bff/membership-plans");
  check("R6 a deactivated plan disappears from the public plan list", r.status === 200 && !/SMOKE_PLAN/.test(r.text) && /code|name/.test(r.text), r.text.slice(0, 120));

  const ref = async (sql: string) => (await db.query(sql)).rows[0].id as string;
  const religionId = await ref("select id from religions order by name limit 1");
  r = await owner.post("/bff/admin/communities", { name: "Smoke Community", religionId });
  const commId = r.data?.community?.id ?? r.data?.id;
  check("R7 create community", r.status < 300 && !!commId, r.text.slice(0, 160));
  r = await owner.post("/bff/admin/communities", { name: "smoke community", religionId });
  check("R8 duplicate (case-insensitive) community → 409", r.status === 409, String(r.status));
  r = await owner.patch(`/bff/admin/communities/${commId}`, { isActive: false });
  check("R9 retire community", r.status === 200, r.text.slice(0, 160));
  r = await anon.get(`/bff/reference/profile-options?religionId=${religionId}`);
  check("R10 a retired community leaves the pick-list", r.status === 200 && !/Smoke Community/.test(r.text), r.text.slice(0, 100));

  // custom role: plans.manage only
  r = await owner.post("/bff/admin/roles", { name: "SMOKE_PLANNER", description: "smoke", permissions: ["plans.manage"] });
  const roleId = r.data?.roleId;
  check("R11 Super Admin creates a custom role with plans.manage only", r.status === 201 && !!roleId, r.text.slice(0, 160));
  r = await owner.post("/bff/admin/staff", { name: "Smoke Planner", email: "planner@smoke.example", roleName: "SMOKE_PLANNER" });
  const plTemp = r.data?.temporaryPassword as string; ONE_TIME.push(plTemp);
  const planner = new Client("planner");
  await planner.post("/bff/admin/login", { email: "planner@smoke.example", password: plTemp });
  await planner.post("/bff/admin/me/password", { currentPassword: plTemp, newPassword: "Planner#Pass-1234" });
  r = await planner.get("/bff/admin/membership-plans");
  check("R12 [role with plans.manage] can list plans", r.status === 200, String(r.status));
  r = await planner.get("/bff/admin/communities");
  check("R13 [role with plans.manage] cannot manage communities (403)", r.status === 403, String(r.status));
  r = await planner.get("/bff/admin/otp/policy");
  check("R14 [role with plans.manage] cannot read the OTP policy (403)", r.status === 403, String(r.status));
  r = await planner.put(`/bff/admin/roles/${roleId}/permissions`, { permissions: ["plans.manage", "staff.manage"] });
  check("R15 [role with plans.manage] cannot edit role permissions / escalate (403)", r.status === 403, String(r.status));
  r = await owner.put(`/bff/admin/roles/${roleId}/permissions`, { permissions: ["audit.view"] });
  check("R16 Super Admin removes plans.manage from the role", r.status === 200, r.text.slice(0, 160));
  r = await planner.get("/bff/admin/membership-plans");
  check("R17 revocation is effective on the very next request (403), no re-login", r.status === 403, String(r.status));
  r = await planner.get("/bff/admin/security-events");
  check("R18 …and the newly granted audit.view works at once (200)", r.status === 200, String(r.status));

  r = await owner.get("/bff/admin/security-events?type=LOGIN_FAILED");
  check("R19 security events list failed logins with the identifier masked", r.status === 200 && (r.data?.items ?? []).length > 0 && !/member1@smoke\.example/.test(r.text), r.text.slice(0, 240));
  r = await owner.get("/bff/admin/payments/reconcile");
  check("R20 reconcile history readable by Super Admin", r.status === 200, r.text.slice(0, 120));

  // ------------------------------------------------------------------ 6. member features: profiles, search, privacy, sessions, notifications
  const ids = {
    motherTongueId: await ref("select id from mother_tongues order by name limit 1"),
    educationId: await ref("select id from educations order by name limit 1"),
    professionId: await ref("select id from professions order by name limit 1"),
    maritalStatusId: await ref("select id from marital_statuses order by name limit 1"),
    countryId: await ref("select id from countries order by name limit 1"),
  };
  const cityId = (await db.query("insert into cities(id,name,country_id) values (gen_random_uuid(),'Smoketown',$1) returning id", [ids.countryId])).rows[0].id;
  const communityId = (await db.query("insert into communities(id,name,religion_id) values (gen_random_uuid(),'Smoke Active Community',$1) returning id", [religionId])).rows[0].id;
  const ready = async (c: Client, gender: string, dob: string) => {
    await c.post("/bff/profiles/me", { gender, dateOfBirth: dob });
    const p = await c.patch("/bff/profiles/me", { religionId, communityId, ...ids, cityId, incomeRange: "10-15 LPA", incomeCurrency: "INR", heightCm: 168 });
    const fd = new FormData();
    fd.set("photo", new Blob([new Uint8Array(makePng(300, 300))], { type: "image/png" }), "p.png");
    const res = await fetch(BASE + "/bff/profiles/me/photos", { method: "POST", headers: { cookie: c.cookieHeader(), Origin: BASE, "x-forwarded-for": c.ip }, body: fd });
    return { patch: p.status, photo: res.status };
  };
  const a = await ready(dev3, "FEMALE", "1996-04-12");
  const b = await ready(m2, "MALE", "1993-02-20");
  check("M1 both members completed a profile with a photo", a.patch === 200 && a.photo === 201 && b.patch === 200 && b.photo === 201, JSON.stringify({ a, b }));
  const f = (await db.query("select id, public_id from profiles where user_id=$1", [m1Id])).rows[0];
  check("M2 every profile has a unique RZ+8-digit ID", /^RZ\d{8}$/.test(f.public_id), f.public_id);

  r = await m2.get("/bff/search/profiles?gender=FEMALE");
  check("M3 member 2 finds member 1 in search (visible by default); the card carries no contact data", r.status === 200 && r.data.items.some((i: any) => i.profile.userId === m1Id) && !/member1@smoke|9876500011/.test(r.text), `${r.status} ${r.text.slice(0, 160)}`);
  r = await m2.get(`/bff/search/profiles?profileId=${f.public_id}`);
  check("M4 profile-ID search is an advanced filter: refused (403) without an advanced-search plan", r.status === 403 && /advancedSearch/.test(r.text), `${r.status} ${r.text.slice(0, 200)}`);
  r = await m2.get("/bff/search/profiles?profileId=abc");
  check("M5 a malformed profile ID is a validation error (400)", r.status === 400, String(r.status));
  r = await owner.patch("/bff/admin/platform-settings", { search: { enforceAdvancedSearchEntitlement: false } });
  r = await m2.get(`/bff/search/profiles?profileId=${f.public_id.toLowerCase()}`);
  check("M6 with enforcement switched off by the Super Admin the same search works (case-insensitive) and returns exactly that member", r.status === 200 && r.data.total === 1 && r.data.items[0].profile.userId === m1Id, `${r.status} ${r.text.slice(0, 200)}`);
  r = await owner.patch("/bff/admin/platform-settings", { search: { enforceAdvancedSearchEntitlement: true } });

  r = await dev3.patch("/bff/users/me/privacy", {});
  check("M7 empty privacy update → 400", r.status === 400, String(r.status));
  r = await dev3.patch("/bff/users/me/privacy", { profileVisibility: "HIDDEN" });
  check("M8 member 1 hides her profile", r.status === 200 && r.data?.privacy?.profileVisibility === "HIDDEN", r.text.slice(0, 160));
  r = await m2.get("/bff/search/profiles?gender=FEMALE");
  check("M9 a hidden profile is absent from search", r.status === 200 && !r.data.items.some((i: any) => i.profile.userId === m1Id));
  const profId = f.id;
  r = await m2.get(`/bff/profiles/${profId}`);
  check("M10 …and its page answers 404 to other members", r.status === 404, String(r.status));
  r = await new Client("visitor").get(`/bff/profiles/${profId}`);
  check("M11 …and to visitors", r.status === 404, String(r.status));
  r = await dev3.get(`/bff/profiles/${profId}`);
  check("M12 …but the owner still sees her own profile", r.status === 200, String(r.status));
  r = await dev3.patch("/bff/users/me/privacy", { profileVisibility: "VISIBLE", photoVisibility: "ACCEPTED_ONLY", showLastActive: false });
  r = await m2.get(`/bff/profiles/${profId}`);
  check("M13 photos limited to accepted connections: the page shows photosRestricted and no photos; no lastActive", r.status === 200 && r.data.profile.photosRestricted === true && r.data.profile.photos.length === 0 && r.data.profile.lastActive === null, r.text.slice(0, 240));
  const photoId = (await db.query("select id from profile_photos where profile_id=$1 limit 1", [profId])).rows[0]?.id;
  r = await m2.get(`/bff/profiles/photos/${photoId}/file`);
  check("M14 the photo file itself is not served to a non-connection (404)", r.status === 404, String(r.status));
  await dev3.patch("/bff/users/me/privacy", { photoVisibility: "MEMBERS" });

  const extra = new Client("member1-extra-device"); // OTP-less mode is still on, so a second device can sign in directly
  const extra2 = new Client("member1-extra-device-2");
  await extra.post("/bff/auth/login", { email: email1, password: PW });
  await extra2.post("/bff/auth/login", { email: email1, password: PW });
  r = await dev3.get("/bff/users/me/sessions");
  const sess = r.data?.sessions ?? [];
  check("M15 session list shows this device flagged current, no token material", r.status === 200 && sess.filter((s: any) => s.current).length === 1 && !/tokenHash|token_hash/.test(r.text), r.text.slice(0, 200));
  const other = sess.find((s: any) => !s.current);
  check("M16 member 1 has at least one other signed-in device (login from earlier devices)", !!other, JSON.stringify(sess.length));
  r = await dev3.req("DELETE", `/bff/users/me/sessions/${other.id}`);
  check("M17 sign out another device → 200", r.status === 200, r.text.slice(0, 120));
  const alive = [await extra.get("/bff/users/me"), await extra2.get("/bff/users/me")];
  check("M18 …exactly one of the two other devices is signed out at once (401), the other still works", alive.filter((x) => x.status === 401).length === 1 && alive.filter((x) => x.status === 200).length === 1, alive.map((x) => x.status).join(","));
  r = await dev3.req("DELETE", "/bff/users/me/sessions");
  check("M19 sign out all other devices → 200", r.status === 200, r.text.slice(0, 120));
  check("M19b …and now neither extra device works", (await extra.get("/bff/users/me")).status === 401 && (await extra2.get("/bff/users/me")).status === 401);
  r = await dev3.get("/bff/users/me");
  check("M20 the current device stays signed in", r.status === 200);
  r = await dev3.req("DELETE", `/bff/users/me/sessions/${sess.find((s: any) => s.current).id}`);
  check("M21 a member cannot 'revoke' the session they are using (409)", r.status === 409, String(r.status));

  r = await dev3.patch("/bff/users/me/notification-preferences", { SMS: false });
  check("M22 unknown channel → 400", r.status === 400, String(r.status));
  r = await dev3.patch("/bff/users/me/notification-preferences", { EMAIL: false });
  check("M23 opt out of e-mail → saved", r.status === 200 && r.data?.preferences?.EMAIL === false && r.data?.preferences?.PUSH === true, r.text.slice(0, 160));
  r = await dev3.get("/bff/users/me/notification-preferences");
  check("M24 preference persists", r.data?.preferences?.EMAIL === false);

  // ------------------------------------------------------------------ 7. nothing leaked
  assertNoSecretsSeen(SECRETS, ONE_TIME);
  await db.end();
  await smtp.close();
  finish("B18 smoke");
}

main().catch((e) => { console.error("smoke crashed:", e); process.exit(2); });
