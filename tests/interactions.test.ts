/**
 * B6: Interest / Like / Shortlist / Match / Block business rules —
 * duplicate handling, self-action prevention, blocked-pair denial,
 * mutual-interest reciprocity, match creation, unblock restoration, and
 * the block-exclusion effect on B4 search / B5 recommendations now that
 * `blocks` actually contains rows (previously always empty — see
 * BACKEND.md's B6 section).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { POST as sendInterest, GET as listInterests } from "@/app/api/v1/interactions/interests/route";
import { PATCH as respondInterest } from "@/app/api/v1/interactions/interests/[interestId]/route";
import { POST as likeUser, GET as listLikes } from "@/app/api/v1/interactions/likes/route";
import { DELETE as unlikeUser } from "@/app/api/v1/interactions/likes/[toUserId]/route";
import { POST as shortlistUser, GET as listShortlist } from "@/app/api/v1/interactions/shortlist/route";
import { DELETE as unshortlistUser } from "@/app/api/v1/interactions/shortlist/[targetUserId]/route";
import { GET as listMatches } from "@/app/api/v1/interactions/matches/route";
import { POST as blockUser, GET as listBlocks } from "@/app/api/v1/interactions/blocks/route";
import { DELETE as unblockUser } from "@/app/api/v1/interactions/blocks/[targetUserId]/route";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { db } from "@/server/db/client";
import { behaviourEvents, matches, likes, interests, blocks } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import {
  resetTransactionalTables,
  resetAdminUsers,
  resetOtpConfigForTests,
  resetMatchingWeightsForTests,
  activateMembershipForTests,
} from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function ireq(url: string, body: unknown, token: string, method = "POST") {
  return req(url, body, { token, method });
}

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}

function dreq(url: string, token: string) {
  return req(url, undefined, { token, method: "DELETE" });
}

/**
 * B8 note: sendInterest now requires the SENDER to have an active
 * membership (see interactions.service.ts's pre-approved B8 touch,
 * documented in BACKEND.md's B8 section). Every sendInterest call in
 * this file goes through `a` or `b` built here, so both are given a
 * test-fixture ACTIVE membership up front — this file's own subject is
 * Interest/Like/Shortlist/Match/Block business rules, not membership
 * gating (that's covered by chat.test.ts and the new B8 membership/
 * payment test files), so every existing assertion below is preserved
 * unweakened; only the fixture setup gained this one additive call.
 */
async function twoReadyUsers(refs: ReferenceIds, prefix: string) {
  const a = await buildReadyProfile(`${prefix}-a`, refs, { gender: "FEMALE" });
  const b = await buildReadyProfile(`${prefix}-b`, refs, { gender: "MALE" });
  await activateMembershipForTests(a.member.userId);
  await activateMembershipForTests(b.member.userId);
  return { a, b };
}

describe("B6 interactions", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  // --- Interest ------------------------------------------------------------

  describe("Interest", () => {
    it("[interest-send] sends a PENDING interest and records an INTEREST_SENT behaviour event", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-send");
      const res = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.interest.status).toBe("PENDING");
      expect(data.matched).toBe(false);

      const events = await db.select().from(behaviourEvents).where(and(eq(behaviourEvents.actorUserId, a.member.userId), eq(behaviourEvents.eventType, "INTEREST_SENT")));
      expect(events).toHaveLength(1);
      expect(events[0].targetUserId).toBe(b.member.userId);
    });

    it("[interest-self] cannot send an interest to yourself", async () => {
      const { a } = await twoReadyUsers(refs, "int-self");
      const res = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: a.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(400);
    });

    it("[interest-duplicate] a second PENDING interest to the same target is rejected with 409", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-dup");
      await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const res2 = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res2.status).toBe(409);
    });

    // --- B8 pre-approved touch regression proof (see BACKEND.md's B8
    // section, "interactions.service.ts membership gate") ------------------

    it("[interest-requires-membership] sending a NEW interest without an active membership is rejected with 403", async () => {
      // Deliberately built via buildReadyProfile directly, NOT
      // twoReadyUsers (which now activates membership for both parties
      // by default — see this file's own note above) — so `a` genuinely
      // has no active membership here.
      const a = await buildReadyProfile("int-nomember-a", refs, { gender: "FEMALE" });
      const b = await buildReadyProfile("int-nomember-b", refs, { gender: "MALE" });
      const res = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(403);
    });

    it("[interest-received-still-actionable-without-membership] a received interest can still be accepted/rejected even without an active membership", async () => {
      const a = await buildReadyProfile("int-recv-nomember-a", refs, { gender: "FEMALE" });
      const b = await buildReadyProfile("int-recv-nomember-b", refs, { gender: "MALE" });
      await activateMembershipForTests(a.member.userId); // only the SENDER needs it
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(sendRes.status).toBe(201);
      const { data: sendData } = await sendRes.json();

      // b (the recipient) has NO active membership at all, yet can still
      // accept — the gate applies only to sendInterest, never to
      // respondToInterest/withdrawInterest.
      const respondRes = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(respondRes.status).toBe(200);
      const { data: respondData } = await respondRes.json();
      expect(respondData.interest.status).toBe("ACCEPTED");
    });

    it("[interest-accept] the recipient accepting creates a mutual match and INTEREST_ACCEPTED/MATCH_CREATED events for both users", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-accept");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      const respondRes = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(respondRes.status).toBe(200);
      const { data: respondData } = await respondRes.json();
      expect(respondData.interest.status).toBe("ACCEPTED");

      const matchRows = await db.select().from(matches);
      expect(matchRows).toHaveLength(1);
      const involved = [matchRows[0].userAId, matchRows[0].userBId].sort();
      expect(involved).toEqual([a.member.userId, b.member.userId].sort());

      const acceptedEvents = await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "INTEREST_ACCEPTED"));
      expect(acceptedEvents.length).toBeGreaterThanOrEqual(2);
      const matchEvents = await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "MATCH_CREATED"));
      expect(matchEvents.length).toBeGreaterThanOrEqual(2);
    });

    it("[interest-reject] the recipient rejecting sets DECLINED, creates no match, and records INTEREST_REJECTED", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-reject");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      const respondRes = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "DECLINED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(respondRes.status).toBe(200);
      const { data: respondData } = await respondRes.json();
      expect(respondData.interest.status).toBe("DECLINED");

      const matchRows = await db.select().from(matches);
      expect(matchRows).toHaveLength(0);

      const rejectEvents = await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "INTEREST_REJECTED"));
      expect(rejectEvents).toHaveLength(1);
    });

    it("[interest-withdraw] the sender can withdraw their own still-PENDING interest (CANCEL = WITHDRAWN)", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-withdraw");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      const withdrawRes = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "WITHDRAWN" }, a.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(withdrawRes.status).toBe(200);
      const { data } = await withdrawRes.json();
      expect(data.interest.status).toBe("WITHDRAWN");
    });

    it("[interest-withdraw-idor] the recipient cannot withdraw an interest addressed to them (only the sender can)", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-withdraw-idor");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      const res = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "WITHDRAWN" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(res.status).toBe(403);
    });

    it("[interest-idor] a user cannot accept/reject an interest not addressed to them", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-idor");
      const stranger = await buildReadyProfile("int-idor-stranger", refs, { gender: "MALE" });
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      const res = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, stranger.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(res.status).toBe(403);
    });

    it("[interest-reciprocal] mutual interest (B already PENDING to A, A then sends to B) auto-accepts and matches immediately", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-mutual");
      await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: a.member.userId }, b.member.sessionToken));

      const res = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.matched).toBe(true);
      expect(data.interest.status).toBe("ACCEPTED");

      const matchRows = await db.select().from(matches);
      expect(matchRows).toHaveLength(1);
    });

    it("[interest-resend] a re-send after DECLINE reuses the row and resets it to PENDING (not a permanent block)", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-resend");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();
      await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "DECLINED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );

      const res2 = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res2.status).toBe(201);
      const { data: data2 } = await res2.json();
      expect(data2.interest.status).toBe("PENDING");
      expect(data2.interest.id).toBe(sendData.interest.id); // same row reused

      const allInterests = await db.select().from(interests);
      expect(allInterests).toHaveLength(1); // never a second row for the same ordered pair
    });

    it("[interest-list] listing sent/received interests returns the right rows for the right user", async () => {
      const { a, b } = await twoReadyUsers(refs, "int-list");
      await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));

      const sentRes = await listInterests(greq("http://localhost/api/v1/interactions/interests?direction=sent", a.member.sessionToken));
      const { data: sentData } = await sentRes.json();
      expect(sentData.interests).toHaveLength(1);

      const receivedRes = await listInterests(greq("http://localhost/api/v1/interactions/interests?direction=received", b.member.sessionToken));
      const { data: receivedData } = await receivedRes.json();
      expect(receivedData.interests).toHaveLength(1);

      const receivedByARes = await listInterests(greq("http://localhost/api/v1/interactions/interests?direction=received", a.member.sessionToken));
      const { data: receivedByAData } = await receivedByARes.json();
      expect(receivedByAData.interests).toHaveLength(0);
    });
  });

  // --- Like ------------------------------------------------------------

  describe("Like", () => {
    it("[like] likes a user and records a LIKE behaviour event", async () => {
      const { a, b } = await twoReadyUsers(refs, "like");
      const res = await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(201);

      const events = await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "LIKE"));
      expect(events).toHaveLength(1);
    });

    it("[like-self] cannot like your own account", async () => {
      const { a } = await twoReadyUsers(refs, "like-self");
      const res = await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: a.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(400);
    });

    it("[like-duplicate] liking the same user twice is idempotent — one row, no error", async () => {
      const { a, b } = await twoReadyUsers(refs, "like-dup");
      const res1 = await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));
      const res2 = await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);

      const rows = await db.select().from(likes);
      expect(rows).toHaveLength(1);
    });

    it("[unlike] unliking removes the row, and unliking again is a no-op (idempotent)", async () => {
      const { a, b } = await twoReadyUsers(refs, "unlike");
      await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));
      const res1 = await unlikeUser(dreq(`http://localhost/api/v1/interactions/likes/${b.member.userId}`, a.member.sessionToken), {
        params: { toUserId: b.member.userId },
      });
      expect(res1.status).toBe(200);
      const rows = await db.select().from(likes);
      expect(rows).toHaveLength(0);

      const res2 = await unlikeUser(dreq(`http://localhost/api/v1/interactions/likes/${b.member.userId}`, a.member.sessionToken), {
        params: { toUserId: b.member.userId },
      });
      expect(res2.status).toBe(200); // still a no-op, not an error
    });

    it("[like-list] listMyLikes returns sent/received correctly", async () => {
      const { a, b } = await twoReadyUsers(refs, "like-list");
      await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));

      const sentRes = await listLikes(greq("http://localhost/api/v1/interactions/likes?direction=sent", a.member.sessionToken));
      const { data: sentData } = await sentRes.json();
      expect(sentData.likes).toHaveLength(1);

      const receivedRes = await listLikes(greq("http://localhost/api/v1/interactions/likes?direction=received", b.member.sessionToken));
      const { data: receivedData } = await receivedRes.json();
      expect(receivedData.likes).toHaveLength(1);
    });
  });

  // --- Shortlist -----------------------------------------------------------

  describe("Shortlist", () => {
    it("[shortlist] shortlists a user and records a SHORTLIST behaviour event", async () => {
      const { a, b } = await twoReadyUsers(refs, "sl");
      const res = await shortlistUser(ireq("http://localhost/api/v1/interactions/shortlist", { targetUserId: b.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(201);
      const events = await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "SHORTLIST"));
      expect(events).toHaveLength(1);
    });

    it("[shortlist-self] cannot shortlist your own account", async () => {
      const { a } = await twoReadyUsers(refs, "sl-self");
      const res = await shortlistUser(ireq("http://localhost/api/v1/interactions/shortlist", { targetUserId: a.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(400);
    });

    it("[shortlist-duplicate] shortlisting the same user twice is idempotent", async () => {
      const { a, b } = await twoReadyUsers(refs, "sl-dup");
      await shortlistUser(ireq("http://localhost/api/v1/interactions/shortlist", { targetUserId: b.member.userId }, a.member.sessionToken));
      await shortlistUser(ireq("http://localhost/api/v1/interactions/shortlist", { targetUserId: b.member.userId }, a.member.sessionToken));
      const rows = await db.select().from(likes); // sanity: unrelated table untouched
      expect(rows).toHaveLength(0);
      const listRes = await listShortlist(greq("http://localhost/api/v1/interactions/shortlist", a.member.sessionToken));
      const { data } = await listRes.json();
      expect(data.shortlist).toHaveLength(1);
    });

    it("[unshortlist] removing restores non-shortlisted state, idempotent on repeat", async () => {
      const { a, b } = await twoReadyUsers(refs, "unsl");
      await shortlistUser(ireq("http://localhost/api/v1/interactions/shortlist", { targetUserId: b.member.userId }, a.member.sessionToken));
      const res1 = await unshortlistUser(dreq(`http://localhost/api/v1/interactions/shortlist/${b.member.userId}`, a.member.sessionToken), {
        params: { targetUserId: b.member.userId },
      });
      expect(res1.status).toBe(200);
      const res2 = await unshortlistUser(dreq(`http://localhost/api/v1/interactions/shortlist/${b.member.userId}`, a.member.sessionToken), {
        params: { targetUserId: b.member.userId },
      });
      expect(res2.status).toBe(200);
      const listRes = await listShortlist(greq("http://localhost/api/v1/interactions/shortlist", a.member.sessionToken));
      const { data } = await listRes.json();
      expect(data.shortlist).toHaveLength(0);
    });
  });

  // --- Match -----------------------------------------------------------

  describe("Match", () => {
    it("[match-list] a mutual match shows up in both users' match list", async () => {
      const { a, b } = await twoReadyUsers(refs, "match-list");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();
      await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );

      const aMatches = await listMatches(greq("http://localhost/api/v1/interactions/matches", a.member.sessionToken));
      const { data: aData } = await aMatches.json();
      expect(aData.matches).toHaveLength(1);
      expect(aData.matches[0].counterpart.userId).toBe(b.member.userId);

      const bMatches = await listMatches(greq("http://localhost/api/v1/interactions/matches", b.member.sessionToken));
      const { data: bData } = await bMatches.json();
      expect(bData.matches).toHaveLength(1);
      expect(bData.matches[0].counterpart.userId).toBe(a.member.userId);
    });
  });

  // --- Block -----------------------------------------------------------

  describe("Block", () => {
    it("[block] blocking a user creates a blocks row and is audit-logged", async () => {
      const { a, b } = await twoReadyUsers(refs, "block");
      const res = await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId, reason: "spam" }, a.member.sessionToken));
      expect(res.status).toBe(201);
      const rows = await db.select().from(blocks).where(eq(blocks.blockerUserId, a.member.userId));
      expect(rows).toHaveLength(1);
      expect(rows[0].blockedUserId).toBe(b.member.userId);
    });

    it("[block-self] cannot block your own account", async () => {
      const { a } = await twoReadyUsers(refs, "block-self");
      const res = await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: a.member.userId }, a.member.sessionToken));
      expect(res.status).toBe(400);
    });

    it("[block-denies-interaction] once A blocks B, neither side can send an Interest/Like/Shortlist to the other", async () => {
      const { a, b } = await twoReadyUsers(refs, "block-deny");
      await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

      const interestRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(interestRes.status).toBe(403);

      const reverseInterestRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: a.member.userId }, b.member.sessionToken));
      expect(reverseInterestRes.status).toBe(403);

      const likeRes = await likeUser(ireq("http://localhost/api/v1/interactions/likes", { toUserId: b.member.userId }, a.member.sessionToken));
      expect(likeRes.status).toBe(403);

      const shortlistRes = await shortlistUser(ireq("http://localhost/api/v1/interactions/shortlist", { targetUserId: a.member.userId }, b.member.sessionToken));
      expect(shortlistRes.status).toBe(403);
    });

    it("[block-preserves-history] blocking does not delete a previously-sent, still-PENDING interest", async () => {
      const { a, b } = await twoReadyUsers(refs, "block-hist");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

      const rows = await db.select().from(interests).where(eq(interests.id, sendData.interest.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("PENDING");
    });

    it("[unblock] unblocking removes the block, and a previously-sent interest is visible/actionable again", async () => {
      const { a, b } = await twoReadyUsers(refs, "unblock");
      const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
      const { data: sendData } = await sendRes.json();

      await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));
      const unblockRes = await unblockUser(dreq(`http://localhost/api/v1/interactions/blocks/${b.member.userId}`, a.member.sessionToken), {
        params: { targetUserId: b.member.userId },
      });
      expect(unblockRes.status).toBe(200);

      const blockRows = await db.select().from(blocks);
      expect(blockRows).toHaveLength(0);

      // The original interest is still there, and can now be accepted.
      const respondRes = await respondInterest(
        ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
        { params: { interestId: sendData.interest.id } }
      );
      expect(respondRes.status).toBe(200);
      const { data } = await respondRes.json();
      expect(data.interest.status).toBe("ACCEPTED");
    });

    it("[unblock-idempotent] unblocking someone not blocked is a no-op, not an error", async () => {
      const { a, b } = await twoReadyUsers(refs, "unblock-noop");
      const res = await unblockUser(dreq(`http://localhost/api/v1/interactions/blocks/${b.member.userId}`, a.member.sessionToken), {
        params: { targetUserId: b.member.userId },
      });
      expect(res.status).toBe(200);
    });

    it("[block-list] listBlocks returns the blocker's own blocked users", async () => {
      const { a, b } = await twoReadyUsers(refs, "block-list");
      await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));
      const res = await listBlocks(greq("http://localhost/api/v1/interactions/blocks", a.member.sessionToken));
      const { data } = await res.json();
      expect(data.blocks).toHaveLength(1);
      expect(data.blocks[0].counterpart.userId).toBe(b.member.userId);
    });

    // --- Block effect on B4 search / B5 recommendations (§ "verify it holds
    // under real data" — blocks was always empty before B6) ----------------

    it("[block-hides-from-search] a blocked user disappears from BOTH parties' search results (symmetric)", async () => {
      const { a, b } = await twoReadyUsers(refs, "block-search");

      const beforeA = await searchProfiles(greq("http://localhost/api/v1/search/profiles", a.member.sessionToken));
      const { data: beforeAData } = await beforeA.json();
      expect(beforeAData.items.some((i: { profile: { id: string } }) => i.profile.id === b.profileId)).toBe(true);

      await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

      const afterA = await searchProfiles(greq("http://localhost/api/v1/search/profiles", a.member.sessionToken));
      const { data: afterAData } = await afterA.json();
      expect(afterAData.items.some((i: { profile: { id: string } }) => i.profile.id === b.profileId)).toBe(false);

      const afterB = await searchProfiles(greq("http://localhost/api/v1/search/profiles", b.member.sessionToken));
      const { data: afterBData } = await afterB.json();
      expect(afterBData.items.some((i: { profile: { id: string } }) => i.profile.id === a.profileId)).toBe(false);
    });

    it("[block-hides-from-recommendations] a blocked user disappears from BOTH parties' recommendations (symmetric)", async () => {
      const { a, b } = await twoReadyUsers(refs, "block-recs");
      // A "full" preference body matching both fixtures' shared `refs`
      // exactly (buildReadyProfile gives both profiles the same
      // religion/community/etc. by default) — comfortably clears
      // MIN_EVALUABLE_WEIGHT (=30) so the candidate is actually scored
      // and returned, which a narrower age/height-only preference would
      // not (most categories would be UNAVAILABLE, totaling only 25).
      const prefBody = {
        ageMin: 18,
        ageMax: 60,
        heightMinCm: 100,
        heightMaxCm: 220,
        religionId: refs.religionId,
        maritalStatusIds: [refs.maritalStatusId],
        communityIds: [refs.communityId],
        motherTongueIds: [refs.motherTongueId],
        educationIds: [refs.educationId],
        professionIds: [refs.professionId],
        countryIds: [refs.countryId],
        cityIds: [refs.cityId],
        incomeMinAmount: 0,
        incomeMaxAmount: 100_000_000,
        incomeCurrency: "INR",
      };
      await patchPreferences(ireq("http://localhost/api/v1/profiles/me/partner-preferences", prefBody, a.member.sessionToken, "PATCH"));
      await patchPreferences(ireq("http://localhost/api/v1/profiles/me/partner-preferences", prefBody, b.member.sessionToken, "PATCH"));

      const beforeA = await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", a.member.sessionToken));
      const { data: beforeAData } = await beforeA.json();
      const beforeIds = [...beforeAData.items, ...beforeAData.secondaryItems].map((i: { profile: { id: string } }) => i.profile.id);
      expect(beforeIds).toContain(b.profileId);

      await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

      const afterA = await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", a.member.sessionToken));
      const { data: afterAData } = await afterA.json();
      const afterAIds = [...afterAData.items, ...afterAData.secondaryItems].map((i: { profile: { id: string } }) => i.profile.id);
      expect(afterAIds).not.toContain(b.profileId);

      const afterB = await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", b.member.sessionToken));
      const { data: afterBData } = await afterB.json();
      const afterBIds = [...afterBData.items, ...afterBData.secondaryItems].map((i: { profile: { id: string } }) => i.profile.id);
      expect(afterBIds).not.toContain(a.profileId);
    });
  });
});
