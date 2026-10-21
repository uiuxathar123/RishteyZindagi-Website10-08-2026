#!/usr/bin/env -S npx tsx
/**
 * LOCAL DEVELOPMENT / QA ONLY — adds realistic sample member profiles (male and female, India and NRI) so search,
 * recommendations and Personal Matchmaking can be tried with a believable population. Never for production.
 *
 *   npx tsx scripts/seed-sample-profiles.ts --target=dev                 add 100 profiles to rishteyzindagi_dev
 *   npx tsx scripts/seed-sample-profiles.ts --target=test --count=40     add 40 to rishteyzindagi_test
 *   npx tsx scripts/seed-sample-profiles.ts --target=dev --dry-run       print what would be created, write nothing
 *   npx tsx scripts/seed-sample-profiles.ts --target=dev --preview=DIR   also write the avatar PNGs to DIR to look at
 *   npx tsx scripts/seed-sample-profiles.ts --target=dev --remove        delete every sample profile (and its photos)
 *
 * Guard rails (enforced in code):
 *  - refuses NODE_ENV=production, a non-local database host, or any database other than rishteyzindagi_dev /
 *    rishteyzindagi_test (read from .env / .env.test respectively);
 *  - every sample account uses the reserved e-mail domain @seed.rishteyzindagi.local (never shown to members), so
 *    --remove deletes exactly these and nothing else; the accounts cannot be signed in to (unknown random password);
 *  - profiles are created through the real profile endpoints, so completeness and visibility are computed by the
 *    application itself; photos are illustrated avatars generated here (no real person's photo or likeness);
 *  - re-running is safe: existing sample accounts are skipped. Everything is written to the audit log as SYSTEM.
 *
 * Note for --target=test: the test suite empties these tables before each test, so sample profiles there disappear
 * after the next test run.
 */
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  })
);
const target = args.get("target");
if (target !== "dev" && target !== "test") {
  console.error("Usage: npx tsx scripts/seed-sample-profiles.ts --target=dev|test [--count=100] [--dry-run] [--preview=DIR] [--remove]");
  process.exit(1);
}
const COUNT = Math.min(500, Math.max(1, Number(args.get("count") ?? 100) || 100));
const DRY = args.has("dry-run");
const REMOVE = args.has("remove");
const PREVIEW = args.get("preview");

// Load the target's environment BEFORE any application module reads it.
const ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(ROOT, target === "test" ? ".env.test" : ".env"), override: true });
const EXPECTED_DB = target === "test" ? "rishteyzindagi_test" : "rishteyzindagi_dev";

function guard() {
  if (process.env.NODE_ENV === "production") throw new Error("Refused: NODE_ENV=production.");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Refused: DATABASE_URL is not set.");
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`Refused: database host "${host}" is not this machine.`);
  if (db !== EXPECTED_DB) throw new Error(`Refused: database is "${db}", expected ${EXPECTED_DB}.`);
  return { host, db };
}

const rawLog = console.log.bind(console);
console.log = (...a: unknown[]) => {
  // the route handlers log one JSON line per request; keep this tool's output readable
  if (typeof a[0] === "string" && a[0].startsWith('{"timestamp"')) return;
  rawLog(...a);
};

async function main() {
  const where = guard();
  rawLog(`Target: ${where.db} on ${where.host} (credentials not shown)`);

  const { generateProfiles, avatarSvg, SAMPLE_EMAIL_DOMAIN } = await import("./lib/sample-profile-data");
  const people = generateProfiles(COUNT);

  if (DRY) {
    for (const p of people) rawLog(`${String(p.index).padStart(3)} ${p.gender === "MALE" ? "M" : "F"} ${p.name} · ${p.city} · ${p.community} · ${p.profession} · ${p.incomeRange}`);
    rawLog(`\nDry run: ${people.length} profiles, nothing written.`);
    return;
  }

  const { NextRequest } = await import("next/server");
  const sharp = (await import("sharp")).default;
  const { and, eq, inArray, like, sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { hashPassword } = await import("../src/server/lib/password");
  const { generateSessionToken, hashSessionToken, sessionExpiryDate } = await import("../src/server/lib/session");
  const { record } = await import("../src/server/modules/audit/audit.service");
  const { getStorageProvider } = await import("../src/server/modules/storage/factory");
  const profileRoute = await import("../src/app/api/v1/profiles/me/route");
  const photoRoute = await import("../src/app/api/v1/profiles/me/photos/route");
  const prefsRoute = await import("../src/app/api/v1/profiles/me/partner-preferences/route");
  const { users, profiles, profilePhotos, deviceSessions, religions, communities, motherTongues, educations, professions, maritalStatuses, countries, cities } = schema;
  const emailPattern = `%@${SAMPLE_EMAIL_DOMAIN}`;

  // ---------------------------------------------------------------- remove
  if (REMOVE) {
    const rows = await db.select({ id: users.id }).from(users).where(like(users.email, emailPattern));
    if (rows.length === 0) {
      rawLog("No sample profiles to remove.");
      return;
    }
    const ids = rows.map((r) => r.id);
    const keys = await db
      .select({ key: profilePhotos.storageKey })
      .from(profilePhotos)
      .innerJoin(profiles, eq(profiles.id, profilePhotos.profileId))
      .where(inArray(profiles.userId, ids));
    const storage = getStorageProvider();
    let filesRemoved = 0;
    for (const k of keys) {
      if (!k.key) continue;
      try {
        await storage.delete(k.key);
        filesRemoved++;
      } catch {
        /* a missing file is fine */
      }
    }
    await db.delete(users).where(like(users.email, emailPattern)); // cascades to profiles, photos, preferences, etc.
    await record({ actorType: "SYSTEM", action: "dev.sample_profiles_removed", entityType: "user", metadata: { count: ids.length, filesRemoved } });
    rawLog(`Removed ${ids.length} sample accounts and ${filesRemoved} photo files.`);
    return;
  }

  // ---------------------------------------------------------------- reference data by name
  const byName = async (table: typeof religions | typeof motherTongues | typeof educations | typeof professions | typeof maritalStatuses) =>
    new Map((await db.select({ id: table.id, name: table.name }).from(table)).map((r) => [r.name, r.id]));
  const [religionIds, tongueIds, educationIds, professionIds, maritalIds] = await Promise.all([
    byName(religions),
    byName(motherTongues),
    byName(educations),
    byName(professions),
    byName(maritalStatuses),
  ]);
  const communityIds = new Map(
    (await db.select({ id: communities.id, name: communities.name, religion: religions.name }).from(communities).innerJoin(religions, eq(religions.id, communities.religionId))).map(
      (r) => [`${r.religion}:${r.name}`, r.id]
    )
  );
  const countryIds = new Map((await db.select({ id: countries.id, iso: countries.isoCode }).from(countries)).flatMap((r) => (r.iso ? [[r.iso, r.id] as const] : [])));
  const cityIds = new Map(
    (await db.select({ id: cities.id, name: cities.name, iso: countries.isoCode }).from(cities).innerJoin(countries, eq(countries.id, cities.countryId))).map(
      (r) => [`${r.iso}:${r.name}`, r.id]
    )
  );
  const need = <T>(m: Map<string, T>, key: string, what: string): T => {
    const v = m.get(key);
    if (!v) throw new Error(`Reference data missing: ${what} "${key}". Run the normal seed first (npm run db:seed).`);
    return v;
  };

  if (PREVIEW) fs.mkdirSync(PREVIEW, { recursive: true });
  // One unknown random password for all sample accounts: nobody can sign in to them.
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
  const jreq = (url: string, token: string, body?: unknown, method?: string) =>
    new NextRequest(url, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Runs one endpoint call; on 429 (the per-IP API rate-limit policy) waits as long as the server asks and retries. */
  const call = async (what: string, send: () => Promise<Response>, okStatus: number[]) => {
    for (let attempt = 1; ; attempt++) {
      const res = await send();
      if (okStatus.includes(res.status)) return;
      if (res.status === 429 && attempt <= 6) {
        const wait = Math.max(5, Number(res.headers.get("retry-after")) || 30);
        rawLog(`  rate limit reached — waiting ${wait}s...`);
        await sleep(wait * 1000);
        continue;
      }
      throw new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
    }
  };
  /** Deletes a sample account and its stored photo files (used to undo a half-created one). */
  const removeAccount = async (userId: string) => {
    const keys = await db
      .select({ key: profilePhotos.storageKey })
      .from(profilePhotos)
      .innerJoin(profiles, eq(profiles.id, profilePhotos.profileId))
      .where(eq(profiles.userId, userId));
    for (const k of keys) if (k.key) await getStorageProvider().delete(k.key).catch(() => undefined);
    await db.delete(users).where(eq(users.id, userId));
  };

  let created = 0;
  let skipped = 0;
  for (const p of people) {
    const [existing] = await db
      .select({ id: users.id, status: profiles.profileStatus })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.email, p.email))
      .limit(1);
    if (existing?.status === "READY_FOR_VISIBILITY") {
      skipped++;
      continue;
    }
    if (existing) {
      rawLog(`  re-creating incomplete sample account #${p.index}`);
      await removeAccount(existing.id);
    }
    const lastActive = new Date(Date.now() - p.lastActiveDaysAgo * 86_400_000 - Math.floor(Math.random() * 6) * 3_600_000);
    const [u] = await db
      .insert(users)
      .values({
        name: p.name,
        email: p.email,
        mobileNumber: p.mobile,
        countryCode: p.countryIso === "IN" ? "+91" : "+1",
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        mobileVerifiedAt: new Date(),
        lastActiveAt: lastActive,
      })
      .returning({ id: users.id });

    // Short-lived session used only to drive the real profile endpoints; removed afterwards.
    const token = generateSessionToken();
    await db.insert(deviceSessions).values({ userId: u.id, tokenHash: hashSessionToken(token), deviceId: "seed-sample-profiles", expiresAt: sessionExpiryDate() });
    try {
      const B = "http://localhost/api/v1/profiles/me";
      await call("create profile", () => profileRoute.POST(jreq(B, token, { gender: p.gender, dateOfBirth: p.dateOfBirth })), [200, 201]);
      await call(
        "update profile",
        () =>
          profileRoute.PATCH(
          jreq(
            B,
            token,
            {
              maritalStatusId: need(maritalIds, p.maritalStatus, "marital status"),
              religionId: need(religionIds, p.religion, "religion"),
              communityId: need(communityIds, `${p.religion}:${p.community}`, "community"),
              motherTongueId: need(tongueIds, p.motherTongue, "mother tongue"),
              educationId: need(educationIds, p.education, "education"),
              professionId: need(professionIds, p.profession, "profession"),
              countryId: need(countryIds, p.countryIso, "country"),
              cityId: need(cityIds, `${p.countryIso}:${p.city}`, "city"),
              incomeRange: p.incomeRange,
              incomeCurrency: p.incomeCurrency,
              incomeMinAmount: p.incomeMinAmount,
              incomeMaxAmount: p.incomeMaxAmount,
              heightCm: p.heightCm,
              aboutMe: p.aboutMe,
              lifestyle: p.lifestyle,
              familyDetails: p.familyDetails,
            },
            "PATCH"
          )
        ),
        [200]
      );

      const png = await sharp(Buffer.from(avatarSvg(p))).png().toBuffer();
      if (PREVIEW) fs.writeFileSync(path.join(PREVIEW, `${String(p.index).padStart(3, "0")}-${p.gender.toLowerCase()}.png`), png);
      await call(
        "photo upload",
        () => {
          const form = new FormData();
          form.set("photo", new Blob([png as unknown as ArrayBuffer], { type: "image/png" }), "profile-photo.png");
          return photoRoute.POST(new NextRequest(`${B}/photos`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }));
        },
        [200, 201]
      );

      const opposite = p.gender === "MALE" ? "FEMALE" : "MALE";
      await call(
        "partner preferences",
        () =>
          prefsRoute.PATCH(
          jreq(
            `${B}/partner-preferences`,
            token,
            {
              genderPreference: opposite,
              ageMin: p.preferences.ageMin,
              ageMax: p.preferences.ageMax,
              heightMinCm: p.preferences.heightMinCm,
              heightMaxCm: p.preferences.heightMaxCm,
              religionId: need(religionIds, p.religion, "religion"),
              ...(p.preferences.sameCommunity ? { communityIds: [need(communityIds, `${p.religion}:${p.community}`, "community")] } : {}),
              maritalStatusIds: [need(maritalIds, "Never Married", "marital status"), ...(p.maritalStatus !== "Never Married" ? [need(maritalIds, p.maritalStatus, "marital status")] : [])],
              motherTongueIds: [need(tongueIds, p.motherTongue, "mother tongue")],
              countryIds: p.preferences.countries.map((iso) => need(countryIds, iso, "country")),
              professionAny: true,
            },
            "PATCH"
          )
        ),
        [200, 201]
      );
    } catch (err) {
      await removeAccount(u.id);
      throw err;
    } finally {
      await db.delete(deviceSessions).where(and(eq(deviceSessions.userId, u.id), eq(deviceSessions.deviceId, "seed-sample-profiles")));
    }

    // Using the endpoints above marked the account as active "now"; restore the intended spread of last activity.
    await db.update(users).set({ lastActiveAt: lastActive }).where(eq(users.id, u.id));

    // A sample profile should not wait in the manual-approval queue.
    await db
      .update(profiles)
      .set({ approvalStatus: "APPROVED", approvalDecidedAt: new Date(), profileVisibility: "VISIBLE" })
      .where(and(eq(profiles.userId, u.id), eq(profiles.profileStatus, "READY_FOR_VISIBILITY")));
    created++;
    if (created % 10 === 0) rawLog(`  ${created} created...`);
  }

  const [{ ready }] = await db
    .select({ ready: sql<number>`count(*)::int` })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(like(users.email, emailPattern), eq(profiles.profileStatus, "READY_FOR_VISIBILITY"), eq(profiles.approvalStatus, "APPROVED")));
  await record({ actorType: "SYSTEM", action: "dev.sample_profiles_added", entityType: "user", metadata: { created, skipped, target: EXPECTED_DB } });
  rawLog(`\nDone: ${created} created, ${skipped} already existed. Sample profiles visible to members: ${ready}.`);
  if (PREVIEW) rawLog(`Avatar previews written to ${PREVIEW}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("STOPPED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
