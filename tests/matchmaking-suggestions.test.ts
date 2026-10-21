/**
 * Personal Matchmaking matching, suggestion workflow and privacy:
 *  - automatic recommendations and manual picks use the same eligibility rules (opt-out, blocks both ways, hidden,
 *    unapproved, suspended, gender, self) and the live scoring weights; already-suggested profiles are left out;
 *  - only SENT suggestions reach the member, re-checked on every read; responses never create interests, matches
 *    or chats; contact details are never exposed;
 *  - notes (internal vs customer-visible), status changes, closing, and the audit trail.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, chats, interests, matches, notifications, profiles, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { POST as blockRoute } from "@/app/api/v1/interactions/blocks/route";
import { POST as openChat } from "@/app/api/v1/chats/route";
import { POST as sendInterestRoute } from "@/app/api/v1/interactions/interests/route";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests, resetMatchingWeightsForTests } from "./helpers/reset-db";
import { buildReadyProfile, resolveReferenceIds, type ReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { api, buildCustomer, buyMatchmaking, caseRow, configure, json } from "./helpers/matchmaking";

let refs: ReferenceIds;
let admin: TestAdmin;
let customer: ReadyProfile;
let caseId: string;
const pool: Record<string, ReadyProfile> = {};
const B = "http://localhost/api/v1";

const block = (token: string, targetUserId: string) => blockRoute(jreq(`${B}/interactions/blocks`, { body: { targetUserId }, token }));
const uid = (k: string) => pool[k].member.userId;

/** Adds, approves and sends a suggestion; returns its id. */
async function sendSuggestion(candidateKey: string) {
  const added = await json(await api.admin.addSuggestion(admin.token, caseId, uid(candidateKey), "AUTO"));
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  const id = added.body.data.suggestion.id as string;
  expect((await api.admin.act(admin.token, id, "APPROVE")).status).toBe(200);
  expect((await api.admin.act(admin.token, id, "SEND")).status).toBe(200);
  return id;
}

beforeAll(async () => {
  await resetTransactionalTables();
  await resetMatchingWeightsForTests();
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __clearDevPaymentStoreForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  admin = await createAdmin("SUPER_ADMIN");
  await configure(admin.token);

  customer = await buildCustomer("mm-sug-customer", refs, "MALE");
  for (const key of ["eligibleA", "eligibleB", "optedOut", "blockedByCustomer", "blockedCustomer", "hidden", "unapproved", "suspended"]) {
    __resetRateLimitsForTests();
    pool[key] = await buildReadyProfile(`mm-sug-${key}`, refs, { gender: "FEMALE", dateOfBirth: "1995-06-06" });
  }
  pool.sameGender = await buildReadyProfile("mm-sug-samegender", refs, { gender: "MALE", dateOfBirth: "1993-01-01" });
  __resetRateLimitsForTests();

  expect((await api.optOut(pool.optedOut.member.sessionToken, true)).status).toBe(200);
  expect((await block(customer.member.sessionToken, uid("blockedByCustomer"))).status).toBe(201);
  expect((await block(pool.blockedCustomer.member.sessionToken, customer.member.userId)).status).toBe(201);
  await db.update(profiles).set({ profileVisibility: "HIDDEN" }).where(eq(profiles.userId, uid("hidden")));
  await db.update(profiles).set({ approvalStatus: "PENDING" }).where(eq(profiles.userId, uid("unapproved")));
  await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, uid("suspended")));

  ({ caseId } = await buyMatchmaking(customer.member.sessionToken));
  expect((await caseRow(caseId)).status).toBe("ACTIVE");
}, 240_000);

describe("Personal Matchmaking — eligibility", () => {
  it("[mm-reco-exclusions] recommendations hold only eligible profiles, scored with the live weights; manual picks follow the same rules", async () => {
    const recos = await json(await api.admin.recos(admin.token, caseId));
    expect(recos.status).toBe(200);
    expect(recos.body.data.status).toBe("ok");
    const ids = recos.body.data.items.map((i: { candidateUserId: string }) => i.candidateUserId).sort();
    expect(ids).toEqual([uid("eligibleA"), uid("eligibleB")].sort());
    for (const item of recos.body.data.items) {
      expect(item.score).toBeGreaterThan(0);
      expect(Array.isArray(item.breakdown) && item.breakdown.length).toBeGreaterThan(0);
      expect(item.candidate.email).toBeUndefined();
      expect(item.candidate.mobileNumber).toBeUndefined();
    }

    for (const key of ["optedOut", "blockedByCustomer", "blockedCustomer", "hidden", "unapproved", "suspended", "sameGender"]) {
      const res = await api.admin.addSuggestion(admin.token, caseId, uid(key));
      expect(res.status, key).toBe(409);
    }
    expect((await api.admin.addSuggestion(admin.token, caseId, customer.member.userId)).status).toBe(409); // never the customer themself

    expect((await api.admin.addSuggestion(admin.token, caseId, uid("eligibleA"), "MANUAL")).status).toBe(201);
    expect((await api.admin.addSuggestion(admin.token, caseId, uid("eligibleA"), "MANUAL")).status).toBe(409); // once per case
    const after = await json(await api.admin.recos(admin.token, caseId));
    expect(after.body.data.items.map((i: { candidateUserId: string }) => i.candidateUserId)).toEqual([uid("eligibleB")]);
  });
});

describe("Personal Matchmaking — suggestions and privacy", () => {
  it("[mm-sent-only] the member sees a suggestion only once it is SENT, with the normal member profile view and no contact details", async () => {
    const added = await json(await api.admin.addSuggestion(admin.token, caseId, uid("eligibleA"), "AUTO"));
    const id = added.body.data.suggestion.id as string;
    expect((await json(await api.mine(customer.member.sessionToken))).body.data.suggestions).toEqual([]);
    expect((await api.admin.act(admin.token, id, "SEND")).status).toBe(409); // must be approved first
    expect((await api.admin.act(admin.token, id, "APPROVE")).status).toBe(200);
    expect((await json(await api.mine(customer.member.sessionToken))).body.data.suggestions).toEqual([]);
    expect((await api.admin.act(admin.token, id, "SEND")).status).toBe(200);

    const mine = (await json(await api.mine(customer.member.sessionToken))).body.data;
    expect(mine.suggestions).toHaveLength(1);
    const s = mine.suggestions[0];
    expect(s).toMatchObject({ id, response: "PENDING" });
    expect(s.profile.userId).toBe(uid("eligibleA"));
    const flat = JSON.stringify(s);
    expect(flat).not.toContain(pool.eligibleA.member.email);
    for (const key of ["email", "mobileNumber", "countryCode", "dateOfBirth", "score", "scoreBreakdown", "createdByAdminId"]) {
      expect(Object.keys(s.profile)).not.toContain(key);
      expect(Object.keys(s)).not.toContain(key);
    }
    expect(mine.history.some((h: { note: string }) => /shared with you/.test(h.note ?? ""))).toBe(true);
    expect(await db.select().from(notifications).where(eq(notifications.dedupeKey, `matchmaking_suggestion_sent:${id}`))).toHaveLength(1);
  });

  it("[mm-no-match-or-chat] responding records interest only: no interest, match or chat is created, and chat stays gated", async () => {
    const id = await sendSuggestion("eligibleA");
    const r = await json(await api.respond(customer.member.sessionToken, id, "INTERESTED"));
    expect(r.status).toBe(200);
    expect(r.body.data.suggestion.response).toBe("INTERESTED");

    const pair = [customer.member.userId, uid("eligibleA")];
    expect(await db.select().from(interests).where(or(inArray(interests.fromUserId, pair), inArray(interests.toUserId, pair)))).toEqual([]);
    expect(await db.select().from(matches).where(or(inArray(matches.userAId, pair), inArray(matches.userBId, pair)))).toEqual([]);
    expect(await db.select().from(chats)).toEqual([]);
    const chat = await openChat(jreq(`${B}/chats`, { body: { counterpartUserId: uid("eligibleA") }, token: customer.member.sessionToken }));
    expect(chat.status).toBe(404); // no match → no chat

    // the normal route still works and still needs mutual interest: one-sided interest is not a match
    const interest = await sendInterestRoute(jreq(`${B}/interactions/interests`, { body: { toUserId: uid("eligibleA") }, token: customer.member.sessionToken }));
    expect(interest.status).toBe(201);
    expect(await db.select().from(matches).where(or(inArray(matches.userAId, pair), inArray(matches.userBId, pair)))).toEqual([]);
    expect((await openChat(jreq(`${B}/chats`, { body: { counterpartUserId: uid("eligibleA") }, token: customer.member.sessionToken }))).status).toBe(404);
  });

  it("[mm-stale-hidden] a sent suggestion disappears as soon as its profile becomes ineligible, and can no longer be answered", async () => {
    const a = await sendSuggestion("eligibleA");
    const b = await sendSuggestion("eligibleB");
    expect((await json(await api.mine(customer.member.sessionToken))).body.data.suggestions).toHaveLength(2);

    expect((await api.optOut(pool.eligibleA.member.sessionToken, true)).status).toBe(200);
    expect((await block(pool.eligibleB.member.sessionToken, customer.member.userId)).status).toBe(201);
    expect((await json(await api.mine(customer.member.sessionToken))).body.data.suggestions).toEqual([]);
    expect((await api.respond(customer.member.sessionToken, a, "INTERESTED")).status).toBe(404);
    expect((await api.respond(customer.member.sessionToken, b, "NOT_INTERESTED")).status).toBe(404);

    const detail = (await json(await api.admin.getCase(admin.token, caseId))).body.data;
    expect(detail.suggestions.map((s: { candidateEligibleNow: boolean }) => s.candidateEligibleNow)).toEqual([false, false]);
  });

  it("[mm-ownership] another member can neither see nor answer this member's suggestions", async () => {
    const id = await sendSuggestion("eligibleA");
    const other = await buildCustomer("mm-sug-other", refs, "MALE");
    expect((await json(await api.mine(other.member.sessionToken))).body.data).toMatchObject({ case: null, suggestions: [] });
    expect((await api.respond(other.member.sessionToken, id, "INTERESTED")).status).toBe(404);
    expect((await api.respond(customer.member.sessionToken, "00000000-0000-4000-8000-000000000001", "INTERESTED")).status).toBe(404);
  });

  it("[mm-withdraw] a withdrawn suggestion is no longer shown", async () => {
    const id = await sendSuggestion("eligibleA");
    expect((await api.admin.act(admin.token, id, "WITHDRAW")).status).toBe(200);
    expect((await json(await api.mine(customer.member.sessionToken))).body.data.suggestions).toEqual([]);
    expect((await api.admin.act(admin.token, id, "WITHDRAW")).status).toBe(409);
  });
});

describe("Personal Matchmaking — notes, status and audit", () => {
  it("[mm-notes-status-audit] internal notes stay internal; customer-visible notes and status changes reach the member; closing stops the work; everything is audited", async () => {
    expect((await api.admin.note(admin.token, caseId, { note: "Internal: prefers Delhi", customerVisible: false })).status).toBe(201);
    expect((await api.admin.note(admin.token, caseId, { note: "We have started reviewing profiles for you.", customerVisible: true })).status).toBe(201);
    expect((await api.admin.status(admin.token, caseId, { status: "IN_PROGRESS" })).status).toBe(200);
    // payment-driven states can never be set by hand
    expect((await api.admin.status(admin.token, caseId, { status: "ACTIVE" })).status).toBe(400);
    expect((await api.admin.status(admin.token, caseId, { status: "REFUNDED" })).status).toBe(400);

    const mine = (await json(await api.mine(customer.member.sessionToken))).body.data;
    const notes = mine.history.map((h: { note: string | null }) => h.note);
    expect(notes).toContain("We have started reviewing profiles for you.");
    expect(notes).not.toContain("Internal: prefers Delhi");
    expect(mine.case.status).toBe("IN_PROGRESS");

    const detail = (await json(await api.admin.getCase(admin.token, caseId))).body.data;
    expect(detail.events.map((e: { note: string | null }) => e.note)).toContain("Internal: prefers Delhi");

    expect((await api.admin.status(admin.token, caseId, { status: "COMPLETED", note: "Introduced two profiles." })).status).toBe(200);
    const closed = await caseRow(caseId);
    expect(closed.status).toBe("COMPLETED");
    expect(closed.closedAt).not.toBeNull();
    expect((await api.admin.addSuggestion(admin.token, caseId, uid("eligibleA"))).status).toBe(409);
    expect((await api.admin.status(admin.token, caseId, { status: "CANCELLED" })).status).toBe(409);
    // a closed paid case keeps its included access period (only a full refund revokes it)
    expect(closed.includedAccessRevokedAt).toBeNull();

    const audit = await db
      .select({ action: auditLogs.action, actorRole: auditLogs.actorRole })
      .from(auditLogs)
      .where(and(like(auditLogs.action, "matchmaking.%"), eq(auditLogs.actorType, "ADMIN")));
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["matchmaking.settings_updated", "matchmaking.note_added", "matchmaking.status_changed"]));
    expect(audit.every((a) => a.actorRole === "SUPER_ADMIN")).toBe(true);
  });
});
