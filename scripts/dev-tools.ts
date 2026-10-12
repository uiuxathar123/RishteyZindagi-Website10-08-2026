#!/usr/bin/env -S npx tsx
/**
 * LOCAL DEVELOPMENT HELPERS — never for production.
 *
 *   npm run dev:doctor                  read-only health report (DB, admin, OTP, mail, search eligibility)
 *   npm run dev:setup                   (re)create the dev Super Admin + test members with searchable profiles
 *   npm run dev:setup -- --no-otp       same, and also switch the REGISTRATION OTP check OFF
 *   npm run dev:otp -- off|on           switch the registration OTP check off / back on
 *   npm run dev:otp -- off --all        also switch the new-device login check (never password reset, admin MFA, etc.)
 *
 * These write the SAME persistent setting as the Super Admin screen (Platform Settings -> Registration OTP
 * verification, key `otp.policy`), so the screen and these commands always agree and the value survives restarts.
 *
 * Guard rails (all enforced in code, not by convention):
 *  - refuses to run when NODE_ENV=production;
 *  - refuses to run unless DATABASE_URL points at this machine (localhost / 127.0.0.1 / ::1);
 *  - the Super Admin password is read from SEED_DEV_SUPER_ADMIN_PASSWORD in your local .env and is never printed;
 *  - the test members use fixed, obviously fake @example.com addresses and a documented dev-only password;
 *  - everything it changes is written to the audit log with actor SYSTEM.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { adminRoles, adminUsers, deviceSessions, memberships, membershipPlans, profilePhotos, profiles, users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/lib/password";
import { generateSessionToken, hashSessionToken, sessionExpiryDate } from "../src/server/lib/session";
import { record } from "../src/server/modules/audit/audit.service";
import * as platformSettings from "../src/server/modules/platform-settings/platform-settings.service";
import * as settingsRepo from "../src/server/modules/platform-settings/platform-settings.repository";
import { adminLogin } from "../src/server/modules/admin/admin.service";
import { searchProfiles } from "../src/server/modules/search/search.service";
import { isMailerConfigured, missingMailerSettings } from "../src/server/lib/mailer";
import * as otpConfigRepo from "../src/server/modules/otp/otp-config.repository";
import { NextRequest } from "next/server";
import { POST as createProfileRoute, PATCH as updateProfileRoute } from "../src/app/api/v1/profiles/me/route";
import { POST as uploadPhotoRoute } from "../src/app/api/v1/profiles/me/photos/route";
import { resolveReferenceIds, tinyPngBuffer, makePhotoFormData } from "../tests/helpers/profile-fixtures";

/** Documented, dev-only password shared by the fixed test members below. */
const TEST_MEMBER_PASSWORD = "TestPass@12345";

const TEST_MEMBERS = [
  { name: "Test Priya", email: "test.priya@example.com", mobile: "9000000001", gender: "FEMALE" as const, dob: "1995-04-12", height: 160 },
  { name: "Test Aisha", email: "test.aisha@example.com", mobile: "9000000002", gender: "FEMALE" as const, dob: "1993-09-30", height: 165 },
  { name: "Test Rahul", email: "test.rahul@example.com", mobile: "9000000003", gender: "MALE" as const, dob: "1992-01-20", height: 176 },
  { name: "Test Imran", email: "test.imran@example.com", mobile: "9000000004", gender: "MALE" as const, dob: "1990-11-05", height: 180 },
];

// The profile route handlers write one JSON request-log line each; keep this tool's output readable.
const rawLog = console.log.bind(console);
console.log = (...a: unknown[]) => {
  if (typeof a[0] === "string" && a[0].startsWith('{"timestamp"')) return;
  rawLog(...a);
};
const log = (s = "") => rawLog(s);
const ok = (s: string) => rawLog(`  [ OK ] ${s}`);
const warn = (s: string) => rawLog(`  [WARN] ${s}`);
const bad = (s: string) => rawLog(`  [FAIL] ${s}`);


/** Drizzle wraps Postgres errors ("Failed query: ..."); the useful part is on `.cause`. */
function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: { message?: string; code?: string } }).cause;
  const detail = cause?.message ? `${cause.message}${cause.code ? ` [${cause.code}]` : ""}` : "";
  const base = e.message.split("\n")[0].slice(0, 160);
  return detail ? `${detail}  (${base})` : e.message;
}

/** How many migration files the code ships vs how many this database has applied. */
async function migrationStatus(): Promise<{ shipped: number; applied: number }> {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
  let applied = 0;
  try {
    applied = ((await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0] as { n: number }).n;
  } catch {
    applied = 0; // table missing: migrations were never run through the migrator
  }
  return { shipped: journal.entries.length, applied };
}

function runMigrations(): void {
  log("Running migrations (npm run db:migrate)...");
  const m = spawnSync("npm", ["run", "db:migrate"], { stdio: "inherit", shell: true });
  if (m.status !== 0) throw new Error("db:migrate failed — fix the error above and re-run.");
}

function guard() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refused: NODE_ENV=production. These helpers are for local development only.");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? "";
  const host = /@(\[[^\]]+\]|[^:/?]+)/.exec(url)?.[1]?.replace(/^\[|\]$/g, "") ?? "";
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`Refused: DATABASE_URL host is "${host || "unknown"}", not this machine. These helpers only run against a local database.`);
    process.exit(1);
  }
}

async function tableExists(name: string): Promise<boolean> {
  const r = await db.execute(sql`select to_regclass(${"public." + name}) as t`);
  return !!(r.rows[0] as { t: string | null }).t;
}

async function ensureSchemaAndSeed(): Promise<void> {
  const st = await migrationStatus();
  if (st.applied < st.shipped || !(await tableExists("admin_users"))) {
    log(`Database schema is behind the code (${st.applied} of ${st.shipped} migrations applied).`);
    runMigrations();
  }
  // The seed is idempotent (safe to repeat). Re-running it after a schema upgrade also grants any NEW permissions
  // (added by later phases) to the Super Admin role — without that, new admin screens answer "not allowed".
  log("Seeding roles, permissions and reference data (npm run db:seed — safe to repeat)...");
  const s = spawnSync("npm", ["run", "db:seed"], { stdio: ["ignore", "ignore", "inherit"], shell: true });
  if (s.status !== 0) throw new Error("db:seed failed — fix the error above and re-run.");
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
async function doctor(): Promise<void> {
  log("RishteyZindagi — local doctor (read-only)\n");
  try {
    await db.execute(sql`select 1`);
    ok("Database reachable");
  } catch (e) {
    bad(`Database NOT reachable: ${describe(e)}`);
    log("      Start PostgreSQL and check DATABASE_URL in .env.");
    return;
  }
  const st = await migrationStatus();
  if (st.applied < st.shipped) {
    bad(`Database schema is OUT OF DATE: ${st.applied} of ${st.shipped} migrations applied.`);
    log("      This breaks sign-in, search and settings (missing columns/tables).  Fix:  npm run db:migrate   (or just: npm run dev:setup)");
    return;
  }
  ok(`Database schema is up to date (${st.applied} of ${st.shipped} migrations)`);

  log("\nSuper Admin");
  const admins = await db
    .select({ email: adminUsers.email, status: adminUsers.status, role: adminRoles.name, mustChange: adminUsers.mustChangePassword })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id));
  if (admins.length === 0) bad("No admin accounts exist. Run: npm run dev:setup");
  for (const a of admins) {
    const flags = [a.status !== "ACTIVE" ? `status=${a.status}` : "", a.mustChange ? "must change password at first sign-in" : ""].filter(Boolean);
    (a.status === "ACTIVE" ? ok : bad)(`${a.role}: ${a.email}${flags.length ? "  (" + flags.join(", ") + ")" : ""}`);
  }
  const mfa = (await settingsRepo.get("admin.security"))?.value as { mfaRequired?: boolean } | undefined;
  if (mfa?.mfaRequired) warn("Admin MFA is ON — admin sign-in needs an e-mailed code. Without SMTP nobody can sign in. Fix: npm run admin:disable-mfa");
  else ok("Admin MFA is off (password is enough to sign in)");

  log("\nE-mail / OTP");
  if (isMailerConfigured()) ok("SMTP is configured");
  else warn(`SMTP is NOT configured (missing: ${missingMailerSettings().join(", ")}). OTP e-mails cannot be sent.`);
  const cfg = await otpConfigRepo.get();
  log(`       OTP master switch: ${cfg.enabled ? "on" : "OFF"}, channel: ${cfg.activeMethod}, dev-OTP mode: ${cfg.devMode ? "on" : "off"}`);
  const policy = await platformSettings.getOtpPolicy();
  const signupOff = policy.SIGNUP_VERIFICATION === "OTP_NOT_REQUIRED";
  const deviceOff = policy.NEW_DEVICE_LOGIN === "OTP_NOT_REQUIRED";
  log(`       Registration OTP check: ${signupOff ? "OFF (accounts are created without a code)" : "required"}`);
  log(`       New-device login OTP check: ${deviceOff ? "OFF" : "required"}`);
  if (!isMailerConfigured() && !cfg.devMode && !signupOff) {
    bad("Sign-up will FAIL: the sign-up code is required but cannot be e-mailed.  Fix: npm run dev:otp -- off   (or configure SMTP)");
  }

  log("\nMembers and search");
  const [{ members }] = (await db.execute(sql`select count(*)::int as members from users`)).rows as Array<{ members: number }>;
  log(`       Members: ${members}`);
  const [r] = (
    await db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where ${profiles.profileStatus} = 'INCOMPLETE')::int as incomplete,
        count(*) filter (where ${profiles.profileStatus} = 'COMPLETE')::int as no_photo,
        count(*) filter (where ${profiles.profileStatus} = 'READY_FOR_VISIBILITY' and ${profiles.approvalStatus} = 'PENDING')::int as pending,
        count(*) filter (where ${profiles.profileStatus} = 'READY_FOR_VISIBILITY' and ${profiles.approvalStatus} = 'REJECTED')::int as rejected,
        count(*) filter (where ${profiles.profileStatus} = 'READY_FOR_VISIBILITY' and ${profiles.approvalStatus} = 'APPROVED' and ${profiles.profileVisibility} <> 'VISIBLE')::int as hidden,
        count(*) filter (where ${profiles.profileStatus} = 'READY_FOR_VISIBILITY' and ${profiles.approvalStatus} = 'APPROVED' and ${profiles.profileVisibility} = 'VISIBLE' and ${users.status} <> 'ACTIVE')::int as inactive,
        count(*) filter (where ${profiles.profileStatus} = 'READY_FOR_VISIBILITY' and ${profiles.approvalStatus} = 'APPROVED' and ${profiles.profileVisibility} = 'VISIBLE' and ${users.status} = 'ACTIVE')::int as searchable
      from ${profiles} join ${users} on ${users.id} = ${profiles.userId}`)
  ).rows as Array<Record<string, number>>;
  log(`       Profiles: ${r.total} total`);
  log(`         appear in search:                    ${r.searchable}`);
  log(`         incomplete (missing required fields): ${r.incomplete}`);
  log(`         complete but NO PHOTO (not shown):    ${r.no_photo}`);
  log(`         waiting for admin approval:           ${r.pending}`);
  log(`         rejected by an admin:                 ${r.rejected}`);
  log(`         hidden by the member:                 ${r.hidden}`);
  log(`         account not ACTIVE:                   ${r.inactive}`);
  const manual = (await platformSettings.getApprovalSettings()).manualApproval;
  log(`       Manual profile approval: ${manual ? "ON (new profiles wait in the Visibility Queue)" : "off (profiles are approved automatically)"}`);
  if (r.searchable === 0) warn("Nothing is searchable yet. Run: npm run dev:setup   (creates 4 complete, approved test profiles)");
  log("");
}

// ---------------------------------------------------------------------------
// otp on/off
// ---------------------------------------------------------------------------
async function setOtp(mode: "on" | "off", includeNewDevice = false): Promise<void> {
  const next = mode === "off" ? "OTP_NOT_REQUIRED" : "OTP_REQUIRED";
  const previous = await platformSettings.getOtpPolicy();
  // Registration only by default. The new-device login check is a separate setting and is touched only with --all
  // (turning things back ON always restores both, which can only make the platform stricter).
  const value = {
    ...previous,
    SIGNUP_VERIFICATION: next,
    ...(includeNewDevice || mode === "on" ? { NEW_DEVICE_LOGIN: next } : {}),
  };
  await settingsRepo.upsert("otp.policy", value, null);
  await record({
    actorType: "SYSTEM",
    action: "otp.policy_changed",
    entityType: "platform_setting",
    metadata: { setting: "otp.policy", previous, new: value, via: "scripts/dev-tools.ts", reason: "local development" },
  });
  ok(`Registration OTP verification is now ${mode === "off" ? "OFF" : "ON (required)"}.`);
  if (mode === "on") ok("New-device login OTP check is now ON (required).");
  else if (includeNewDevice) ok("New-device login OTP check is now OFF.");
  else log(`       New-device login OTP check left unchanged (${value.NEW_DEVICE_LOGIN === "OTP_NOT_REQUIRED" ? "OFF" : "required"}).`);
  if (mode === "off") warn("Local development only. New accounts are created with e-mail/mobile UNVERIFIED. Switch back on before launch: npm run dev:otp -- on");
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
async function setupAdmin(): Promise<{ email: string }> {
  const email = (process.env.SEED_DEV_SUPER_ADMIN_EMAIL ?? "dev-superadmin@rishteyzindagi.local").trim().toLowerCase();
  const password = (process.env.SEED_DEV_SUPER_ADMIN_PASSWORD ?? "").trim();
  if (!password) throw new Error("SEED_DEV_SUPER_ADMIN_PASSWORD is empty in .env — set it (any value you like) and re-run.");
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "SUPER_ADMIN")).limit(1);
  if (!role) throw new Error("SUPER_ADMIN role missing — the seed did not complete.");
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  if (existing) {
    await db
      .update(adminUsers)
      .set({ passwordHash, status: "ACTIVE", roleId: role.id, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(adminUsers.id, existing.id));
    ok(`Super Admin ${email}: password reset to the value of SEED_DEV_SUPER_ADMIN_PASSWORD in .env, account ACTIVE`);
  } else {
    await db.insert(adminUsers).values({ name: "Dev Super Admin", email, passwordHash, roleId: role.id, mustChangePassword: false });
    ok(`Super Admin ${email}: created (password = SEED_DEV_SUPER_ADMIN_PASSWORD in .env)`);
  }
  // Admin MFA needs a working mailbox; with it on and no SMTP, nobody can sign in.
  const mfa = (await settingsRepo.get("admin.security"))?.value as { mfaRequired?: boolean } | undefined;
  if (mfa?.mfaRequired) {
    await settingsRepo.upsert("admin.security", { mfaRequired: false }, null);
    ok("Admin MFA was ON — switched OFF for local development");
  }
  await record({ actorType: "SYSTEM", action: "dev.super_admin_reset", entityType: "admin_user", metadata: { email, via: "scripts/dev-tools.ts" } });

  // Self-test through the real sign-in code path.
  try {
    const res = await adminLogin({ email, password }, {});
    if ("sessionToken" in res) ok("Self-test: Super Admin sign-in works");
    else warn("Self-test: sign-in asked for an MFA code (MFA is on).");
  } catch (e) {
    bad(`Self-test: Super Admin sign-in FAILED: ${e instanceof Error ? e.message : e}`);
  }
  return { email };
}

async function ensureTestPlan(): Promise<string> {
  const code = "DEV_TEST_PLAN";
  const [existing] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, code)).limit(1);
  if (existing) return existing.id;
  const [p] = await db
    .insert(membershipPlans)
    .values({ code, name: "Dev Test Plan", priceInPaise: 0, durationDays: 365, features: { advancedSearch: true }, isActive: false })
    .returning({ id: membershipPlans.id });
  return p.id;
}

function jreq(url: string, token: string, body?: unknown, method?: string) {
  return new NextRequest(url, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function setupMember(m: (typeof TEST_MEMBERS)[number], refs: Awaited<ReturnType<typeof resolveReferenceIds>>, planId: string): Promise<string> {
  const passwordHash = await hashPassword(TEST_MEMBER_PASSWORD);
  let [u] = await db.select().from(users).where(eq(users.email, m.email)).limit(1);
  if (!u) {
    [u] = await db
      .insert(users)
      .values({ name: m.name, email: m.email, mobileNumber: m.mobile, countryCode: "+91", passwordHash, status: "ACTIVE", emailVerifiedAt: new Date(), mobileVerifiedAt: new Date() })
      .returning();
  } else {
    await db.update(users).set({ passwordHash, status: "ACTIVE", updatedAt: new Date() }).where(eq(users.id, u.id));
  }

  // Short-lived session used only to drive the real profile endpoints; removed afterwards.
  const token = generateSessionToken();
  await db.insert(deviceSessions).values({ userId: u.id, tokenHash: hashSessionToken(token), deviceId: "dev-tools", expiresAt: sessionExpiryDate() });
  try {
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, u.id)).limit(1);
    if (!p) {
      const r = await createProfileRoute(jreq("http://localhost/api/v1/profiles/me", token, { gender: m.gender, dateOfBirth: m.dob }));
      if (r.status >= 300) throw new Error(`create profile failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    }
    const patch = await updateProfileRoute(
      jreq(
        "http://localhost/api/v1/profiles/me",
        token,
        {
          religionId: refs.religionId,
          communityId: refs.communityId,
          motherTongueId: refs.motherTongueId,
          educationId: refs.educationId,
          professionId: refs.professionId,
          maritalStatusId: refs.maritalStatusId,
          countryId: refs.countryId,
          cityId: refs.cityId,
          incomeRange: "10-15 LPA",
          incomeCurrency: "INR",
          heightCm: m.height,
        },
        "PATCH"
      )
    );
    if (patch.status !== 200) throw new Error(`update profile failed (${patch.status}): ${(await patch.text()).slice(0, 200)}`);

    const [cur] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, u.id)).limit(1);
    const n = (await db.select({ id: profilePhotos.id }).from(profilePhotos).where(eq(profilePhotos.profileId, cur.id))).length;
    if (n === 0) {
      const up = await uploadPhotoRoute(
        new NextRequest("http://localhost/api/v1/profiles/me/photos", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: makePhotoFormData(tinyPngBuffer(300, 300)),
        })
      );
      if (up.status >= 300) throw new Error(`photo upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    }
  } finally {
    await db.delete(deviceSessions).where(and(eq(deviceSessions.userId, u.id), eq(deviceSessions.deviceId, "dev-tools")));
  }

  // If manual approval is on, a dev fixture should not sit in the queue.
  await db
    .update(profiles)
    .set({ approvalStatus: "APPROVED", approvalDecidedAt: new Date(), profileVisibility: "VISIBLE" })
    .where(and(eq(profiles.userId, u.id), eq(profiles.profileStatus, "READY_FOR_VISIBILITY")));

  const [active] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.status, "ACTIVE"))).limit(1);
  if (!active) {
    await db.insert(memberships).values({ userId: u.id, planId, status: "ACTIVE", startedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000) });
  }
  return u.id;
}

async function setup(noOtp: boolean): Promise<void> {
  log("RishteyZindagi — local setup\n");
  await ensureSchemaAndSeed();
  log("Super Admin");
  const admin = await setupAdmin();

  log("\nTest members (complete, approved, with a photo, active membership)");
  const refs = await resolveReferenceIds();
  const planId = await ensureTestPlan();
  for (const m of TEST_MEMBERS) {
    try {
      await setupMember(m, refs, planId);
      ok(`${m.name}  ${m.email}`);
    } catch (e) {
      bad(`${m.email}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (noOtp) {
    log("\nOTP");
    await setOtp("off");
  }

  log("\nSearch self-test");
  const res = await searchProfiles(null, { filters: {}, page: 1, pageSize: 20 });
  (res.total > 0 ? ok : bad)(`Public search returns ${res.total} profile(s)`);

  log("\n------------------------------------------------------------");
  log(" Admin panel:   /admin/login");
  log(`   e-mail:      ${admin.email}`);
  log("   password:    the value of SEED_DEV_SUPER_ADMIN_PASSWORD in your .env");
  log(" Member login:  /login   (dev-only test accounts)");
  for (const m of TEST_MEMBERS) log(`   ${m.email}   password: ${TEST_MEMBER_PASSWORD}`);
  log("------------------------------------------------------------\n");
}

async function main() {
  guard();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "doctor") await doctor();
  else if (cmd === "setup") await setup(process.argv.includes("--no-otp"));
  else if (cmd === "otp" && (arg === "on" || arg === "off")) await setOtp(arg, process.argv.includes("--all"));
  else {
    console.error("Usage: dev-tools.ts doctor | setup [--no-otp] | otp on|off [--all]");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", describe(err));
  process.exit(1);
});
