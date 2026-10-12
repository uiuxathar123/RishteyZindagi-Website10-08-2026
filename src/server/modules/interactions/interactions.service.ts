/**
 * B6: business rules for Interest, Like, Shortlist, Match, and Block —
 * the "Social / Interaction System" this phase adds on top of B1's
 * previously-unused `likes`/`interests`/`matches`/`shortlists`/`blocks`
 * tables (see interactions.repository.ts's file comment).
 *
 * Every mutating action here is authorized from the SESSION
 * (`requireMemberSubject`), never from a client-supplied "who is this
 * from" id — matching every other B1-B5 module's convention.
 *
 * Documented judgment calls (all referenced again in BACKEND.md's B6
 * section):
 *
 *  - Enum reuse: the product spec's "REJECT"/"CANCEL" Interest actions
 *    map onto the frozen `interestStatusEnum`'s real values —
 *    REJECT = DECLINED, CANCEL = WITHDRAWN (see schema.ts; the enum
 *    cannot be renamed, only reused).
 *  - Interest reciprocity: if B already has a PENDING interest to A, and
 *    A then sends an interest to B, that is treated as MUTUAL interest —
 *    B's original PENDING interest is auto-accepted (not a second row
 *    created) and a match is created immediately. This is the
 *    "recommended" option named in the product brief, chosen because the
 *    alternative (blocking the second send as a duplicate) would make a
 *    same-day-mutual-interest pair wait on an explicit accept neither
 *    side needs to give.
 *  - Duplicate Interest after DECLINE/WITHDRAWN: the unique
 *    `(fromUserId, toUserId)` index means there can only ever be one row
 *    per ordered pair — so a re-send after a decline/withdrawal REUSES
 *    that row (resets it to PENDING) rather than being rejected forever.
 *    A duplicate while PENDING/ACCEPTED is rejected with 409 Conflict.
 *  - Like/Shortlist duplicate: idempotent no-op (returns the existing
 *    row, no error, no second row — enforced at the DB level too via the
 *    existing unique pair indexes).
 *  - Unlike/Un-shortlist/Unblock: idempotent no-op if the row doesn't
 *    exist — removing something already absent is not an error.
 *  - Eligibility bar for *initiating* an interaction (Like/Shortlist/
 *    Interest-send only, never for responding to or removing one):
 *    target account must be ACTIVE and target profile must be
 *    READY_FOR_VISIBILITY — the same bar B4 search / B5 recommendations
 *    already use to decide who's discoverable at all, so an interaction
 *    can never be initiated against someone who couldn't have been
 *    legitimately discovered through the app.
 */
import { isAcceptedPartner } from "@/server/modules/profiles/privacy";
import { NotFoundError, AuthorizationError, ConflictError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { record as recordAudit } from "@/server/modules/audit/audit.service";
import { recordEvent } from "@/server/modules/behaviour-events/behaviour-events.service";
// B7: additive notification-dispatch calls into this already-existing B6
// service — see each call site below and BACKEND.md's B7 section. B7 is
// the only phase that imports notifications.service.ts here; nothing
// about this file's own B6 business rules, error types, or return values
// changes.
import { notify } from "@/server/modules/notifications/notifications.service";
// B8 (disclosed, pre-approved, additive touch — see BACKEND.md's B8
// section, "interactions.service.ts membership gate"): "new Interests
// cannot be sent while membership is expired/inactive; received
// Interests can still be accepted/rejected" — a single guard added at
// the top of sendInterest ONLY (see below). respondToInterest and
// withdrawInterest are completely untouched.
import { hasActiveMembership } from "@/server/modules/memberships/membership-gate";
import * as repo from "./interactions.repository";
import type { InterestRow, LikeRow, ShortlistRow, BlockRow, MatchRow } from "./interactions.repository";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

function assertNotSelf(userId: string, targetUserId: string): void {
  if (userId === targetUserId) throw new ValidationError("You cannot perform this action on your own account.");
}

/** The eligibility bar for INITIATING an interaction — see this file's
 * top-of-file comment. Never applied to responding-to or removing an
 * existing interaction, so a profile that later becomes incomplete can't
 * strand an already-pending action in an unrespondable state. */
async function assertCanInitiate(actorUserId: string, targetUserId: string): Promise<void> {
  const target = await repo.findTargetAccountInfo(targetUserId);
  if (!target || target.accountStatus !== "ACTIVE" || target.profileStatus !== "READY_FOR_VISIBILITY" || target.approvalStatus !== "APPROVED") {
    throw new NotFoundError("User not found.");
  }
  // B18: a hidden profile cannot be approached by someone it never connected with (no probing of hidden members).
  if (target.profileVisibility === "HIDDEN" && !(await isAcceptedPartner(actorUserId, targetUserId))) {
    throw new NotFoundError("User not found.");
  }
  const blocked = await repo.isBlockedEitherDirection(actorUserId, targetUserId);
  if (blocked) {
    throw new AuthorizationError("This action is not available between you and this user.");
  }
}

async function assertTargetAccountExists(targetUserId: string): Promise<void> {
  const target = await repo.findTargetAccountInfo(targetUserId);
  if (!target) throw new NotFoundError("User not found.");
}

// ---------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------

export interface SendInterestResult {
  interest: InterestRow;
  /** true when this call resulted in an immediate mutual match (the
   * recipient already had a pending interest to the sender) — see the
   * reciprocity judgment call above. */
  matched: boolean;
}

/**
 * B7 addition: `interestAcceptedForUserId` is whichever party's PENDING
 * interest just became ACCEPTED (the original sender, in both call sites
 * below) — passed explicitly rather than inferred from userAId/userBId,
 * since that ordering differs between the two callers. Fires exactly one
 * "Interest accepted" notification (to that user only) plus one "New
 * match" notification to EACH of the two matched users — three rows
 * total, not four: match-creation and interest-acceptance always co-occur
 * in this system (a match is created if and only if an interest is
 * accepted), so the accepter does not also get a redundant
 * "interest accepted" notification about their own action.
 */
async function createMutualMatchAndEvents(
  userAId: string,
  userBId: string,
  viaInterestId: string,
  interestAcceptedForUserId: string
): Promise<MatchRow> {
  const match = await repo.createMatch(userAId, userBId);
  await Promise.all([
    recordEvent({ actorUserId: userAId, targetUserId: userBId, eventType: "INTEREST_ACCEPTED", metadata: { interestId: viaInterestId } }),
    recordEvent({ actorUserId: userBId, targetUserId: userAId, eventType: "INTEREST_ACCEPTED", metadata: { interestId: viaInterestId } }),
    recordEvent({ actorUserId: userAId, targetUserId: userBId, eventType: "MATCH_CREATED", metadata: { matchId: match.id } }),
    recordEvent({ actorUserId: userBId, targetUserId: userAId, eventType: "MATCH_CREATED", metadata: { matchId: match.id } }),
  ]);

  // B7: the notification delivery this file's own comment previously
  // marked as a hook point for. Best-effort (notify() never throws) —
  // see notifications.service.ts's own doc comment.
  await notify({
    userId: interestAcceptedForUserId,
    channel: "IN_APP",
    title: "Interest accepted",
    body: "Your interest was accepted.",
    dedupeKey: `interest_accepted:${viaInterestId}`,
  });
  await Promise.all([
    notify({
      userId: userAId,
      channel: "IN_APP",
      title: "New match",
      body: "You have a new match!",
      dedupeKey: `match_created:${match.id}:${userAId}`,
    }),
    notify({
      userId: userBId,
      channel: "IN_APP",
      title: "New match",
      body: "You have a new match!",
      dedupeKey: `match_created:${match.id}:${userBId}`,
    }),
  ]);

  return match;
}

export async function sendInterest(ctx: AuthContext, toUserId: string): Promise<SendInterestResult> {
  const fromUserId = requireMemberSubject(ctx);
  assertNotSelf(fromUserId, toUserId);
  await assertCanInitiate(fromUserId, toUserId);

  // B8: sending a NEW interest requires the sender to have an active
  // membership (see this file's top-of-file B8 comment). Deliberately
  // placed after assertCanInitiate (so a bad/self/blocked target still
  // reports its own, more specific error first) but before any of this
  // function's own state reads — a request-time-fresh check, same
  // real-time-read discipline `hasActiveMembership` itself documents.
  // respondToInterest/withdrawInterest never call this.
  const senderHasActiveMembership = await hasActiveMembership(fromUserId);
  if (!senderHasActiveMembership) {
    throw new AuthorizationError("An active membership is required to send new interests.");
  }

  const reverse = await repo.findInterestByPair(toUserId, fromUserId);
  if (reverse && reverse.status === "ACCEPTED") {
    throw new ConflictError("You are already matched with this user.");
  }
  if (reverse && reverse.status === "PENDING") {
    // Mutual interest — see the reciprocity judgment call above. toUserId
    // is whose earlier PENDING interest just became ACCEPTED.
    const accepted = await repo.updateInterestStatus(reverse.id, "ACCEPTED");
    await createMutualMatchAndEvents(fromUserId, toUserId, accepted.id, toUserId);
    return { interest: accepted, matched: true };
  }

  const forward = await repo.findInterestByPair(fromUserId, toUserId);
  let interest: InterestRow;
  if (forward) {
    if (forward.status === "PENDING" || forward.status === "ACCEPTED") {
      throw new ConflictError("You have already sent an interest to this user.");
    }
    interest = await repo.resetInterestToPending(forward.id);
  } else {
    const created = await repo.createInterest(fromUserId, toUserId);
    if (created) {
      interest = created;
    } else {
      // B10: lost the race — a concurrent sendInterest() call for this
      // exact pair inserted between our `forward` read above and this
      // insert (see interactions.repository.ts's createInterest doc
      // comment). Re-read the row the winner just created and react
      // exactly as if we'd seen it on the original read, rather than
      // letting a raw DB conflict surface as an unhandled error.
      const nowExisting = await repo.findInterestByPair(fromUserId, toUserId);
      if (!nowExisting) throw new ConflictError("You have already sent an interest to this user.");
      if (nowExisting.status === "PENDING" || nowExisting.status === "ACCEPTED") {
        throw new ConflictError("You have already sent an interest to this user.");
      }
      interest = await repo.resetInterestToPending(nowExisting.id);
    }
  }

  await recordEvent({ actorUserId: fromUserId, targetUserId: toUserId, eventType: "INTEREST_SENT", metadata: { interestId: interest.id } });
  // B7: dedupeKey includes createdAt so a re-send that REUSES the same
  // interest row (see the "resend after decline/withdraw" judgment call
  // above) still notifies again — the same row id would otherwise dedupe
  // away a legitimate second notification for a genuinely new episode.
  await notify({
    userId: toUserId,
    channel: "IN_APP",
    title: "New interest received",
    body: "Someone has sent you an interest.",
    dedupeKey: `interest_received:${interest.id}:${interest.createdAt.getTime()}`,
  });
  return { interest, matched: false };
}

export async function respondToInterest(ctx: AuthContext, interestId: string, action: "ACCEPT" | "REJECT"): Promise<InterestRow> {
  const userId = requireMemberSubject(ctx);
  const interest = await repo.findInterestById(interestId);
  // Same IDOR defense as profiles.service.ts's loadOwnedPhoto: identical
  // error whether the interest doesn't exist or isn't addressed to this
  // user, so a caller can never distinguish the two.
  if (!interest || interest.toUserId !== userId) {
    throw new AuthorizationError("You do not have permission to respond to this interest.");
  }
  if (interest.status !== "PENDING") {
    throw new ConflictError(`This interest is no longer pending (current status: ${interest.status}).`);
  }

  if (action === "ACCEPT") {
    const updated = await repo.updateInterestStatus(interestId, "ACCEPTED");
    // interest.fromUserId is whose interest just became ACCEPTED.
    await createMutualMatchAndEvents(interest.toUserId, interest.fromUserId, updated.id, interest.fromUserId);
    return updated;
  }

  const updated = await repo.updateInterestStatus(interestId, "DECLINED");
  await recordEvent({ actorUserId: userId, targetUserId: interest.fromUserId, eventType: "INTEREST_REJECTED", metadata: { interestId } });
  await notify({
    userId: interest.fromUserId,
    channel: "IN_APP",
    title: "Interest declined",
    body: "Your interest was declined.",
    dedupeKey: `interest_rejected:${interestId}:${interest.createdAt.getTime()}`,
  });
  return updated;
}

/** Sender withdraws their own still-PENDING interest (CANCEL = WITHDRAWN
 * — see the enum-reuse note above). Never available to the recipient. */
export async function withdrawInterest(ctx: AuthContext, interestId: string): Promise<InterestRow> {
  const userId = requireMemberSubject(ctx);
  const interest = await repo.findInterestById(interestId);
  if (!interest || interest.fromUserId !== userId) {
    throw new AuthorizationError("You do not have permission to withdraw this interest.");
  }
  if (interest.status !== "PENDING") {
    throw new ConflictError("Only a pending interest can be withdrawn.");
  }
  return repo.updateInterestStatus(interestId, "WITHDRAWN");
}

export type InterestDirection = "sent" | "received";

export async function listMyInterests(ctx: AuthContext, direction: InterestDirection): Promise<InterestRow[]> {
  const userId = requireMemberSubject(ctx);
  return direction === "sent" ? repo.listInterestsSent(userId) : repo.listInterestsReceived(userId);
}

// ---------------------------------------------------------------------------
// Like
// ---------------------------------------------------------------------------

export async function likeUser(ctx: AuthContext, toUserId: string): Promise<LikeRow> {
  const fromUserId = requireMemberSubject(ctx);
  assertNotSelf(fromUserId, toUserId);
  await assertCanInitiate(fromUserId, toUserId);
  const like = await repo.createLike(fromUserId, toUserId);
  await recordEvent({ actorUserId: fromUserId, targetUserId: toUserId, eventType: "LIKE" });
  // B7 (optional per the brief, implemented since it's a clean single
  // call site): dedupeKey is the like row's own id, which `createLike`
  // returns unchanged on a repeat call (idempotent create — see this
  // file's top-of-file "Like/Shortlist duplicate" note) — so a duplicate
  // likeUser() call naturally produces the SAME dedupeKey and is a no-op
  // here too, with no extra "was this newly inserted" tracking needed.
  await notify({
    userId: toUserId,
    channel: "IN_APP",
    title: "New like received",
    body: "Someone liked your profile.",
    dedupeKey: `like_received:${like.id}`,
  });
  return like;
}

/** Idempotent — see the top-of-file "Unlike" judgment call. */
export async function unlikeUser(ctx: AuthContext, toUserId: string): Promise<void> {
  const fromUserId = requireMemberSubject(ctx);
  await repo.removeLike(fromUserId, toUserId);
}

export type LikeDirection = "sent" | "received";

export async function listMyLikes(ctx: AuthContext, direction: LikeDirection): Promise<LikeRow[]> {
  const userId = requireMemberSubject(ctx);
  return direction === "sent" ? repo.listLikesSent(userId) : repo.listLikesReceived(userId);
}

// ---------------------------------------------------------------------------
// Shortlist
// ---------------------------------------------------------------------------

export async function shortlistUser(ctx: AuthContext, targetUserId: string): Promise<ShortlistRow> {
  const userId = requireMemberSubject(ctx);
  assertNotSelf(userId, targetUserId);
  await assertCanInitiate(userId, targetUserId);
  const row = await repo.createShortlist(userId, targetUserId);
  await recordEvent({ actorUserId: userId, targetUserId, eventType: "SHORTLIST" });
  return row;
}

/** Idempotent — see the top-of-file "Un-shortlist" judgment call. */
export async function unshortlistUser(ctx: AuthContext, targetUserId: string): Promise<void> {
  const userId = requireMemberSubject(ctx);
  await repo.removeShortlist(userId, targetUserId);
}

export async function listMyShortlist(ctx: AuthContext): Promise<ShortlistRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listShortlist(userId);
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export async function listMyMatches(ctx: AuthContext): Promise<MatchRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listMatchesForUser(userId);
}

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

export async function blockUser(ctx: AuthContext, blockedUserId: string, reason: string | undefined): Promise<BlockRow> {
  const blockerUserId = requireMemberSubject(ctx);
  assertNotSelf(blockerUserId, blockedUserId);
  await assertTargetAccountExists(blockedUserId);

  const block = await repo.createBlock(blockerUserId, blockedUserId, reason ?? null);

  // A strong privacy action — worth its own audit trail entry even
  // though the actor is a member, not an admin (see BACKEND.md's B6
  // section for this documented choice).
  await recordAudit({
    actorType: "USER",
    actorId: blockerUserId,
    action: "user.block",
    entityType: "block",
    entityId: block.id,
    metadata: { blockedUserId },
  });

  return block;
}

/** Idempotent. Deliberately does nothing beyond removing the `blocks`
 * row — see interactions.repository.ts's `removeBlock` doc comment for
 * why that's the entire "restore everything" behavior. */
export async function unblockUser(ctx: AuthContext, blockedUserId: string): Promise<void> {
  const blockerUserId = requireMemberSubject(ctx);
  await repo.removeBlock(blockerUserId, blockedUserId);

  await recordAudit({
    actorType: "USER",
    actorId: blockerUserId,
    action: "user.unblock",
    entityType: "block",
    metadata: { blockedUserId },
  });
}

export async function listMyBlocks(ctx: AuthContext): Promise<BlockRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listBlocksByBlocker(userId);
}
