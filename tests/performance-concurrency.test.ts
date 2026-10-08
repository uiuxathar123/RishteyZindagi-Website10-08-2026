/**
 * B13 (Performance/Scalability phase): additional concurrency regressions
 * beyond what B10's `tests/security-concurrency.test.ts` already covers
 * (re-run, unchanged, as part of this phase's verification — see
 * PERFORMANCE_REPORT.md). This file targets the two concurrency
 * scenarios the B13 spec asks for that weren't already covered:
 * simultaneous MATCH creation (via reciprocal interest sends) and
 * concurrent notification dedupe (the mechanism every match/interest
 * notification relies on to stay exactly-once under a race). Both are
 * CONFIRMED-ALREADY-SAFE findings — no code change was needed for either
 * (see this file's own comments for why) — these are regression tests
 * locking that fact in, not fixes.
 *
 * `[race-payment-webhook-duplicate]`: this codebase has no separate
 * webhook endpoint — payment verification is pull-based
 * (`POST /payments/:id/verify`, gateway-agnostic, called by the client or
 * `attemptAutoRenewal`), not push-based. "Concurrent duplicate webhook
 * delivery" therefore maps to exactly the same code path B10's own
 * `[race-payment-double-verify]` test already exercises — re-confirmed
 * here is out of scope for a NEW test (would be a verbatim duplicate);
 * see PERFORMANCE_REPORT.md for this disclosed judgment call.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { db } from "@/server/db/client";
import { matches, notifications } from "@/server/db/schema";
import { notify } from "@/server/modules/notifications/notifications.service";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, activateMembershipForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

describe("B13 additional concurrency regressions — match creation + notification dedupe", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  it("[race-mutual-match-creation] two simultaneous reciprocal sendInterest calls (both completing the same mutual pair) create exactly one match and exactly one 'new match' notification per user — never duplicates, never a raw 500", async () => {
    const a = await buildReadyProfile("perf-race-match-a", refs, { gender: "FEMALE" });
    const b = await buildReadyProfile("perf-race-match-b", refs, { gender: "MALE" });
    await activateMembershipForTests(a.member.userId);
    await activateMembershipForTests(b.member.userId);

    // A sends first (uncontested) — establishes the PENDING A->B interest
    // both of B's concurrent replies below will race to accept.
    const firstRes = await sendInterest(preq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
    expect(firstRes.status).toBe(201);

    // Two concurrent B->A sends now both read the same PENDING A->B row.
    // Whichever request's write lands first (sendInterest's reverse-
    // PENDING branch above) flips that row to ACCEPTED and creates the
    // match; the other, if its own read lands after that flip has
    // already committed, sees `reverse.status === "ACCEPTED"` and
    // correctly receives a 409 "already matched" — an ACCURATE conflict,
    // not a bug: by the time it's processed, the two users genuinely are
    // already matched.
    //
    // B15 (2026-10-02) independently re-verified this under real
    // `Promise.all` concurrency and found the 409-for-the-loser outcome
    // is in fact the COMMON case (observed in ~4 of 5 isolated runs), not
    // a rare edge case — the original B13 assertion below (requiring
    // BOTH requests to land on 200/201) was wrong about how the race
    // actually resolves under genuine concurrency, even though it never
    // caused a real defect: `matches.createMatch`'s canonical-pair
    // `onConflictDoNothing` (schema.ts's `matches_pair_idx` unique index)
    // and every "new match" `notify()` call's match-id-scoped `dedupeKey`
    // (`notifications_dedupe_key_idx`, unique) make exactly-one-match /
    // exactly-one-notification-per-user true regardless of which request
    // wins — confirmed by reading `interactions.repository.ts`'s
    // `createMatch` (re-fetches and returns the existing row on conflict
    // rather than erroring) and reconfirmed by this test's own assertions
    // below passing every time the status-list assertion was loosened to
    // match reality. P2, documented, not a release blocker — see
    // BACKEND.md's B15 section / B15_KNOWN_LIMITATIONS.md.
    const fireReciprocal = () =>
      sendInterest(preq("http://localhost/api/v1/interactions/interests", { toUserId: a.member.userId }, b.member.sessionToken));
    const [res1, res2] = await Promise.all([fireReciprocal(), fireReciprocal()]);

    // Neither request may surface a raw, unhandled error — every status
    // is one of the three legitimate outcomes.
    for (const res of [res1, res2]) expect([200, 201, 409]).toContain(res.status);
    // At least one request must have actually succeeded — if the match
    // were NEVER created (both requests 409ing), that would be the real
    // failure mode this test guards against, as opposed to one request
    // accurately 409ing against the other's already-completed success.
    expect([res1.status, res2.status].some((s) => s === 200 || s === 201)).toBe(true);

    const matchRows = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.userAId, a.member.userId < b.member.userId ? a.member.userId : b.member.userId),
          eq(matches.userBId, a.member.userId < b.member.userId ? b.member.userId : a.member.userId)
        )
      );
    expect(matchRows).toHaveLength(1);

    const matchId = matchRows[0].id;
    const notifRowsA = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, a.member.userId), eq(notifications.dedupeKey, `match_created:${matchId}:${a.member.userId}`)));
    const notifRowsB = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, b.member.userId), eq(notifications.dedupeKey, `match_created:${matchId}:${b.member.userId}`)));
    expect(notifRowsA).toHaveLength(1);
    expect(notifRowsB).toHaveLength(1);
  });

  it("[race-notification-dedupe] two concurrent notify() calls sharing the same dedupeKey create exactly one notification row — confirmed already safe (onConflictDoNothing on notifications_dedupe_key_idx), no code change", async () => {
    const member = await buildReadyProfile("perf-race-notif-dedupe", refs, { gender: "MALE" });
    const dedupeKey = `perf-race-dedupe-${Date.now()}`;

    const fire = () =>
      notify({ userId: member.member.userId, channel: "IN_APP", title: "Race test", body: "Race test body", dedupeKey });
    await Promise.all([fire(), fire(), fire()]);

    const rows = await db.select().from(notifications).where(eq(notifications.dedupeKey, dedupeKey));
    expect(rows).toHaveLength(1);
  });
});
