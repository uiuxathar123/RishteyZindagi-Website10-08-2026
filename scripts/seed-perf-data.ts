/**
 * B13 (Performance / Scalability / Database Optimization) — PERF-TESTING
 * ONLY synthetic data seeder. NOT part of any application code path, NOT
 * wired into `npm run db:seed`, and NEVER intended to run against the dev
 * database — see the hard guard immediately below `main()`.
 *
 * Purpose: without a realistic data volume, `EXPLAIN ANALYZE` on this
 * codebase's real queries (search, recommendations, chat, admin lists) is
 * meaningless — every query looks instant against a handful of rows
 * regardless of whether an index is actually being used. This script
 * seeds a few thousand rows of clearly-synthetic, clearly-labeled test
 * fixture data into the TEST database only, so B13's query-plan analysis
 * and N+1 audit are measuring something real.
 *
 * Every seeded row is unambiguously synthetic: user emails/mobiles use a
 * reserved `perf-test-*` / `9555*` namespace that can never collide with
 * a real signup, and every row this script inserts can be identified and
 * wiped by that namespace alone (see `scripts/seed-perf-data.ts --wipe`,
 * not built — a fresh `npm run db:migrate` against a scratch test DB is
 * the documented way to reset; see PERFORMANCE_REPORT.md).
 *
 * No fake payments are presented as real: every seeded payment is
 * `status: 'SUCCESS'` with `verificationMethod: 'AUTO'` exactly like a
 * real dev-provider checkout would produce (see payments.service.ts) —
 * nothing here claims a real gateway delivery, and the whole dataset only
 * ever exists in the test database (§12 of the master spec).
 *
 * Usage: npx tsx scripts/seed-perf-data.ts [profileCount]
 *   (defaults to 3000 profiles if not given)
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import path from "path";
// Load .env.test SECOND so it overrides any DATABASE_URL "dotenv/config"
// picked up from a real .env — this script must only ever run against
// the test database (see the guard below, which is the actual hard stop;
// this is defense in depth, matching tests/setup.ts's own precedent).
loadEnv({ path: path.resolve(__dirname, "../.env.test"), override: true });

import { randomUUID } from "crypto";
import { Pool } from "pg";
import { hashPassword } from "../src/server/lib/password";

const PROFILE_COUNT = Number(process.argv[2] ?? 3000);

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  // Hard guard: refuse to run against anything that isn't obviously a
  // test database. This is the real safety mechanism (not the .env.test
  // load above, which a caller could still override) — see the module
  // doc comment's "never against dev" rule.
  if (!/test/i.test(databaseUrl)) {
    console.error(
      `Refusing to run: DATABASE_URL does not look like a test database (${databaseUrl.replace(/:[^:@]+@/, ":***@")}).\n` +
        `This script seeds thousands of synthetic rows and must only ever run against rishteyzindagi_test.`
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 8 });

  console.log(`Seeding ${PROFILE_COUNT} synthetic perf-test profiles into ${databaseUrl.replace(/:[^:@]+@/, ":***@")} ...`);

  // --- 1. Load real reference ids already seeded by db:seed -----------------
  const [religions, motherTongues, educations, professions, maritalStatuses, countries, plans, gateways] = await Promise.all([
    pool.query(`SELECT id FROM religions`),
    pool.query(`SELECT id FROM mother_tongues`),
    pool.query(`SELECT id FROM educations`),
    pool.query(`SELECT id FROM professions`),
    pool.query(`SELECT id FROM marital_statuses`),
    pool.query(`SELECT id FROM countries`),
    pool.query(`SELECT id, code, duration_days, price_in_paise, currency FROM membership_plans`),
    pool.query(`SELECT id FROM payment_gateways WHERE is_active = true LIMIT 1`),
  ]);
  if (religions.rows.length === 0 || countries.rows.length === 0 || plans.rows.length === 0) {
    console.error("Reference data missing — run `npm run db:seed` against the test database first.");
    process.exit(1);
  }
  // A handful of real cities under the first country (find-or-create, same
  // as reference.repository.ts's own on-demand pattern) — enough spread
  // for search/recommendations filters to have real variety.
  const countryId = countries.rows[0].id as string;
  const cityNames = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai", "Kolkata", "Ahmedabad"];
  const cityIds: string[] = [];
  for (const name of cityNames) {
    const existing = await pool.query(`SELECT id FROM cities WHERE name = $1 AND country_id = $2 LIMIT 1`, [name, countryId]);
    if (existing.rows[0]) {
      cityIds.push(existing.rows[0].id);
    } else {
      const inserted = await pool.query(`INSERT INTO cities (id, name, country_id) VALUES ($1, $2, $3) RETURNING id`, [
        randomUUID(),
        name,
        countryId,
      ]);
      cityIds.push(inserted.rows[0].id);
    }
  }

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const religionIds = religions.rows.map((r) => r.id as string);
  const motherTongueIds = motherTongues.rows.map((r) => r.id as string);
  const educationIds = educations.rows.map((r) => r.id as string);
  const professionIds = professions.rows.map((r) => r.id as string);
  const maritalStatusIds = maritalStatuses.rows.map((r) => r.id as string);
  const sixMonthPlan = plans.rows.find((p) => Number(p.duration_days) === 180 && p.currency === "INR");
  const anyGateway = gateways.rows[0]?.id as string | undefined;

  const sharedPasswordHash = await hashPassword("perf-test-not-a-real-password");
  const now = Date.now();

  // --- 2. Users + profiles (batched multi-row INSERT, chunked) --------------
  type SeedUser = { userId: string; profileId: string; gender: "MALE" | "FEMALE" };
  const seedUsers: SeedUser[] = [];

  const CHUNK = 500;
  for (let start = 0; start < PROFILE_COUNT; start += CHUNK) {
    const end = Math.min(start + CHUNK, PROFILE_COUNT);
    const userValues: unknown[] = [];
    const userRows: string[] = [];
    const profileValues: unknown[] = [];
    const profileRows: string[] = [];
    const photoValues: unknown[] = [];
    const photoRows: string[] = [];

    for (let i = start; i < end; i++) {
      const userId = randomUUID();
      const profileId = randomUUID();
      const gender: "MALE" | "FEMALE" = i % 2 === 0 ? "MALE" : "FEMALE";
      seedUsers.push({ userId, profileId, gender });

      // Reserved, unambiguous synthetic namespace — see module doc comment.
      const email = `perf-test-${i}-${now}@perf.invalid`;
      const mobile = `9${String(555000000 + i).padStart(9, "0")}`.slice(0, 10);

      userRows.push(`($${userValues.length + 1}, $${userValues.length + 2}, $${userValues.length + 3}, $${userValues.length + 4}, $${userValues.length + 5}, 'ACTIVE', now(), now())`);
      userValues.push(userId, `Perf Test User ${i}`, email, mobile, sharedPasswordHash);

      const ageYears = 21 + (i % 25);
      const dob = new Date(now - ageYears * 365 * 24 * 60 * 60 * 1000 - (i % 300) * 24 * 60 * 60 * 1000).toISOString();
      const heightCm = 150 + (i % 45);
      const cityId = cityIds[i % cityIds.length];
      const religionId = religionIds[i % religionIds.length];
      const communityId = null; // closed-list-free; not required for search/recommendations breadth
      const motherTongueId = motherTongueIds[i % motherTongueIds.length];
      const educationId = educationIds[i % educationIds.length];
      const professionId = professionIds[i % professionIds.length];
      const maritalStatusId = maritalStatusIds[i % maritalStatusIds.length];
      const incomeMin = 300000 + (i % 20) * 50000;
      const incomeMax = incomeMin + 500000;

      const base = profileValues.length;
      profileRows.push(
        `($${base + 1}, $${base + 2}, $${base + 3}::profile_gender, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, 'INR', $${base + 14}, $${base + 15}, 100, true, 'READY_FOR_VISIBILITY', now(), now())`
      );
      profileValues.push(
        profileId,
        userId,
        gender,
        dob,
        maritalStatusId,
        religionId,
        communityId,
        motherTongueId,
        educationId,
        professionId,
        countryId,
        cityId,
        heightCm,
        incomeMin,
        incomeMax
      );

      const photoId = randomUUID();
      const pbase = photoValues.length;
      photoRows.push(`($${pbase + 1}, $${pbase + 2}, $${pbase + 3}, 'COMPLETE', true, 0, 'VERIFIED', now(), now())`);
      photoValues.push(photoId, profileId, `/api/v1/profiles/photos/${photoId}/file`);
    }

    await pool.query(
      `INSERT INTO users (id, name, email, mobile_number, password_hash, status, created_at, updated_at) VALUES ${userRows.join(",")}`,
      userValues
    );
    await pool.query(
      `INSERT INTO profiles (id, user_id, gender, date_of_birth, marital_status_id, religion_id, community_id, mother_tongue_id, education_id, profession_id, country_id, city_id, height_cm, income_currency, income_min_amount, income_max_amount, profile_completion_percent, has_profile_photo, profile_status, created_at, updated_at) VALUES ${profileRows.join(",")}`,
      profileValues
    );
    await pool.query(
      `INSERT INTO profile_photos (id, profile_id, url, upload_status, is_primary, sort_order, moderation, created_at, updated_at) VALUES ${photoRows.join(",")}`,
      photoValues
    );
    process.stdout.write(`\r  profiles: ${end}/${PROFILE_COUNT}`);
  }
  console.log();

  // --- 3. Partner preferences for ~70% of profiles ---------------------------
  let prefCount = 0;
  for (let start = 0; start < seedUsers.length; start += CHUNK) {
    const chunk = seedUsers.slice(start, start + CHUNK).filter(() => Math.random() < 0.7);
    if (chunk.length === 0) continue;
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const u of chunk) {
      const base = values.length;
      // Age + height + a wide-open income range (weight 15+10+12=37,
      // clears scoring.ts's MIN_EVALUABLE_WEIGHT=30 floor) — enough for
      // every candidate to be genuinely evaluable, which is what B13's
      // N+1 measurement needs (a non-empty candidate/scored set).
      rows.push(`($${base + 1}, $${base + 2}, 21, 45, 150, 195, 100000, 5000000, 'INR', now(), now())`);
      values.push(randomUUID(), u.profileId);
    }
    await pool.query(
      `INSERT INTO partner_preferences (id, profile_id, age_min, age_max, height_min_cm, height_max_cm, income_min_amount, income_max_amount, income_currency, created_at, updated_at) VALUES ${rows.join(",")}`,
      values
    );
    prefCount += chunk.length;
  }
  console.log(`  partner_preferences: ${prefCount}`);

  // --- 4. Behaviour events — realistic pair activity among the first 800 users, so
  // recommendations' behaviour-signal lookup has real rows to scan/batch. -----
  const activeSlice = seedUsers.slice(0, Math.min(800, seedUsers.length));
  let eventCount = 0;
  const eventTypes = ["PROFILE_VIEW", "LIKE", "SHORTLIST", "INTEREST_SENT"];
  for (let start = 0; start < activeSlice.length; start += CHUNK) {
    const chunk = activeSlice.slice(start, start + CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const u of chunk) {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const target = pick(seedUsers);
        if (target.userId === u.userId) continue;
        const base = values.length;
        const eventType = pick(eventTypes);
        const daysAgo = Math.floor(Math.random() * 90);
        rows.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::behaviour_event_type, now() - ($${base + 5} || ' days')::interval)`
        );
        values.push(randomUUID(), u.userId, target.userId, eventType, String(daysAgo));
      }
    }
    if (rows.length === 0) continue;
    await pool.query(`INSERT INTO behaviour_events (id, actor_user_id, target_user_id, event_type, created_at) VALUES ${rows.join(",")}`, values);
    eventCount += rows.length;
  }
  console.log(`  behaviour_events: ${eventCount}`);

  // --- 5. Memberships (SIX_MONTH, ACTIVE) for ~5% of profiles — Visibility Boost ---
  let membershipCount = 0;
  if (sixMonthPlan) {
    const boosted = seedUsers.filter(() => Math.random() < 0.05);
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const u of boosted) {
      const base = values.length;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, 'ACTIVE', now(), now() + interval '90 days', false, now())`);
      values.push(randomUUID(), u.userId, sixMonthPlan.id);
    }
    if (rows.length) {
      await pool.query(`INSERT INTO memberships (id, user_id, plan_id, status, started_at, expires_at, auto_renew, created_at) VALUES ${rows.join(",")}`, values);
      membershipCount = boosted.length;
    }
  }
  console.log(`  memberships (SIX_MONTH ACTIVE / visibility boost): ${membershipCount}`);

  // --- 6. Payments + transactions + invoices for a few hundred users ---------
  let paymentCount = 0;
  if (anyGateway) {
    const payers = seedUsers.slice(0, Math.min(400, seedUsers.length));
    for (const u of payers) {
      const paymentId = randomUUID();
      const amount = 99900;
      await pool.query(
        `INSERT INTO payments (id, user_id, gateway_id, amount_in_paise, currency, status, verified_at, verification_method, created_at, updated_at) VALUES ($1,$2,$3,$4,'INR','SUCCESS', now(), 'AUTO', now(), now())`,
        [paymentId, u.userId, anyGateway, amount]
      );
      const transactionRef = `TXN-PERF-${randomUUID()}`;
      await pool.query(
        `INSERT INTO transactions (id, payment_id, transaction_ref, amount_in_paise, status, created_at, gateway_transaction_id) VALUES ($1,$2,$3,$4,'SUCCESS', now(), $5)`,
        [randomUUID(), paymentId, transactionRef, amount, `GW-PERF-${randomUUID()}`]
      );
      const invoiceNumber = `INV-PERF-${now}-${paymentCount}`;
      await pool.query(
        `INSERT INTO invoices (id, user_id, payment_id, invoice_number, amount_in_paise, status, issued_at, created_at, snapshot) VALUES ($1,$2,$3,$4,$5,'ISSUED', now(), now(), $6::jsonb)`,
        [randomUUID(), u.userId, paymentId, invoiceNumber, amount, JSON.stringify({ perfTestFixture: true })]
      );
      paymentCount++;
    }
  }
  console.log(`  payments/transactions/invoices: ${paymentCount}`);

  // --- 7. Notifications for a spread of users ---------------------------------
  let notificationCount = 0;
  for (let start = 0; start < seedUsers.length; start += CHUNK) {
    const chunk = seedUsers.slice(start, start + CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const u of chunk) {
      const n = Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) {
        const base = values.length;
        rows.push(`($${base + 1}, $${base + 2}, 'IN_APP', $${base + 3}, $${base + 4}, $${base + 5}, 'DELIVERED', now())`);
        values.push(randomUUID(), u.userId, "Perf test notification", "Synthetic perf-test fixture notification body.", Math.random() < 0.4);
      }
    }
    if (rows.length === 0) continue;
    await pool.query(`INSERT INTO notifications (id, user_id, channel, title, body, is_read, delivery_status, created_at) VALUES ${rows.join(",")}`, values);
    notificationCount += rows.length;
  }
  console.log(`  notifications: ${notificationCount}`);

  // --- 8. Matches + chats + messages for a slice of user pairs -----------------
  let messageCount = 0;
  let chatCount = 0;
  const chatPairs = Math.min(60, Math.floor(seedUsers.length / 2));
  for (let i = 0; i < chatPairs; i++) {
    const a = seedUsers[i * 2];
    const b = seedUsers[i * 2 + 1];
    if (!a || !b) break;
    const matchId = randomUUID();
    await pool.query(`INSERT INTO matches (id, user_a_id, user_b_id, matched_at) VALUES ($1,$2,$3, now())`, [matchId, a.userId, b.userId]);
    const chatId = randomUUID();
    await pool.query(`INSERT INTO chats (id, match_id, created_at, last_message_at) VALUES ($1,$2, now(), now())`, [chatId, matchId]);
    await pool.query(`INSERT INTO chat_participants (id, chat_id, user_id, joined_at) VALUES ($1,$2,$3, now()), ($4,$2,$5, now())`, [
      randomUUID(),
      chatId,
      a.userId,
      randomUUID(),
      b.userId,
    ]);
    chatCount++;

    const msgN = 150; // enough volume that pagination/EXPLAIN is meaningful
    const values: unknown[] = [];
    const rows: string[] = [];
    for (let m = 0; m < msgN; m++) {
      const sender = m % 2 === 0 ? a.userId : b.userId;
      const base = values.length;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, now() - ($${base + 5} || ' minutes')::interval)`);
      values.push(randomUUID(), chatId, sender, `Perf test message #${m}`, String(msgN - m));
    }
    await pool.query(`INSERT INTO messages (id, chat_id, sender_user_id, body, sent_at) VALUES ${rows.join(",")}`, values);
    messageCount += msgN;
  }
  console.log(`  matches/chats: ${chatCount}, messages: ${messageCount}`);

  await pool.end();
  console.log("Done. This data is synthetic perf-test fixtures in the TEST database only — never presented as real users/payments.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
