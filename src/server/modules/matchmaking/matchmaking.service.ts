/**
 * Personal Matchmaking — the member side: the public offer, consent + checkout, the member's own case, the
 * suggestions a Super Admin has SENT, responses to them, and the member's own opt-out from being suggested.
 *
 * Money and entitlement rules live elsewhere and are only reused here: the price, currency and included access
 * period always come from the server-side `personal_matchmaking` setting; the payment is created and verified by
 * the existing payments architecture (openGatewayOrder / verifyPaymentInternal); fulfilment is
 * matchmaking-fulfilment.ts. A suggestion is an introduction only — responding never creates an interest, a match
 * or a chat; those still go through interactions.service.ts / chat.service.ts and their own gates.
 */
import { AuthorizationError, ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { record } from "@/server/modules/audit/audit.service";
import { getActiveGatewayRow } from "@/server/modules/payments/gateways.service";
import { createPendingPaymentRows, requestGatewayOrder, type OpenGatewayOrderResult } from "@/server/modules/payments/payments.service";
import type { VerifyOutcomeStatus } from "@/server/modules/payments/providers/types";
import { resolveUserRegion } from "@/server/modules/memberships/region";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import { resolveLookupsForProfiles } from "@/server/modules/profiles/profiles.service";
import { viewerExtrasFor } from "@/server/modules/profiles/privacy";
import { toAuthenticatedPublicView, type AuthenticatedPublicProfileView } from "@/server/modules/profiles/profiles.dto";
import { db } from "@/server/db/client";
import { matchmakingCaseEvents, matchmakingCases, payments } from "@/server/db/schema";
import { and, desc, eq } from "drizzle-orm";
import * as repo from "./matchmaking.repository";
import { eligibleFor, loadCaseOwner } from "./matchmaking-eligibility";
import { MATCHMAKING_CONSENT_TEXT, MATCHMAKING_CONSENT_VERSION, getMatchmakingSettings, offerFor } from "./matchmaking-settings";
import * as invitationsRepo from "./invitations.repository";
import { myPendingInvitation, type MemberInvitationView } from "./invitations.service";

/** Same window as membership checkout's duplicate-pending guard. */
export const DUPLICATE_CHECKOUT_TTL_MS = 15 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";

function requireMember(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  return ctx.subject.id;
}

// --- offer ------------------------------------------------------------------

export interface MatchmakingOffer {
  available: boolean;
  currency: string;
  priceInSmallestUnit: number | null;
  includedMembershipDays: number;
  consentVersion: string;
  consentText: string;
}

/** Public: what the service costs the caller right now (INR for signed-out visitors, the member's region otherwise). */
export async function getOffer(ctx: AuthContext | null): Promise<MatchmakingOffer> {
  const settings = await getMatchmakingSettings();
  const currency = ctx && ctx.subject.type === "user" ? (await resolveUserRegion(ctx.subject.id)).currency : "INR";
  const offer = offerFor(settings, currency);
  return {
    available: !!offer,
    currency,
    priceInSmallestUnit: offer?.priceInPaise ?? null,
    includedMembershipDays: settings.includedMembershipDays,
    consentVersion: MATCHMAKING_CONSENT_VERSION,
    consentText: MATCHMAKING_CONSENT_TEXT,
  };
}

// --- checkout ---------------------------------------------------------------

export interface MatchmakingCheckoutInput {
  consent: true;
  consentVersion: string;
  customerNotes?: string;
  /** Dev/mock gateway only (ignored by every real provider) — same convention as membership checkout. */
  devSimulateOutcome?: VerifyOutcomeStatus;
}

export type MatchmakingCheckoutResult = OpenGatewayOrderResult & { caseId: string };

export async function checkout(ctx: AuthContext, input: MatchmakingCheckoutInput): Promise<MatchmakingCheckoutResult> {
  const userId = requireMember(ctx);
  if (input.consent !== true) throw new ValidationError("Your consent is required to start Personal Matchmaking.");
  if (input.consentVersion !== MATCHMAKING_CONSENT_VERSION) {
    throw new ConflictError("The service terms have changed. Please review and accept them again.", { consentVersion: MATCHMAKING_CONSENT_VERSION });
  }
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new ConflictError("Create your profile before starting Personal Matchmaking.");

  const settings = await getMatchmakingSettings();
  const region = await resolveUserRegion(userId);
  const offer = offerFor(settings, region.currency);
  if (!offer) throw new ServiceUnavailableError("Personal Matchmaking is not available for purchase right now.");

  const gatewayRow = await getActiveGatewayRow();
  const now = new Date();
  const terms = {
    priceInPaise: offer.priceInPaise,
    currency: offer.currency,
    includedMembershipDays: settings.includedMembershipDays,
    consentedAt: now,
    consentVersion: MATCHMAKING_CONSENT_VERSION,
  };
  const notes = input.customerNotes?.trim() || null;

  // 1. The member's single open case: reused while unpaid, otherwise created. Two simultaneous FIRST checkouts are
  //    settled by the partial unique index (one open case per member); the loser simply carries on with the winner's case.
  const existing = await repo.findOpenCaseForUser(userId);
  if (existing && existing.status !== "PENDING_PAYMENT") {
    throw new ConflictError("You already have an active Personal Matchmaking case.", { caseId: existing.id });
  }
  let caseId = existing?.id;
  if (!caseId) {
    try {
      caseId = (await repo.insertCase({ userId, status: "PENDING_PAYMENT", customerNotes: notes, ...terms })).id;
    } catch (err) {
      const unique = (err as { code?: string })?.code === UNIQUE_VIOLATION || (err as { cause?: { code?: string } })?.cause?.code === UNIQUE_VIOLATION;
      if (!unique) throw err;
      const raced = await repo.findOpenCaseForUser(userId);
      if (!raced) throw new ConflictError("A Personal Matchmaking checkout is already in progress.");
      if (raced.status !== "PENDING_PAYMENT") throw new ConflictError("You already have an active Personal Matchmaking case.", { caseId: raced.id });
      caseId = raced.id;
    }
  }
  const lockedCaseId = caseId;

  // 2. Serialised per case: with the case row locked, check for a recent pending payment, refresh the terms, record
  //    consent and create the PENDING payment rows — all in one transaction. Concurrent checkouts for the same case
  //    therefore queue on the lock, and every one after the first sees its pending payment and is refused, so a case
  //    can never get two open payments (and the member can never be charged twice) through simultaneous requests.
  const rows = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(matchmakingCases).where(eq(matchmakingCases.id, lockedCaseId)).for("update");
    if (!locked || locked.userId !== userId) throw new ConflictError("Your Personal Matchmaking case changed while starting checkout. Please try again.");
    if (locked.status !== "PENDING_PAYMENT") throw new ConflictError("You already have an active Personal Matchmaking case.", { caseId: locked.id });
    const [recent] = await tx
      .select({ id: payments.id, createdAt: payments.createdAt })
      .from(payments)
      .where(and(eq(payments.matchmakingCaseId, lockedCaseId), eq(payments.status, "PENDING")))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (recent && recent.createdAt.getTime() > Date.now() - DUPLICATE_CHECKOUT_TTL_MS) {
      throw new ConflictError("A payment for Personal Matchmaking is already pending. Check its status, or wait a few minutes before trying again.", {
        paymentId: recent.id,
      });
    }
    await tx
      .update(matchmakingCases)
      .set({ ...terms, ...(notes !== null ? { customerNotes: notes } : {}), updatedAt: new Date() })
      .where(eq(matchmakingCases.id, lockedCaseId));
    await tx.insert(matchmakingCaseEvents).values({
      caseId: lockedCaseId,
      actorType: "USER",
      actorId: userId,
      kind: "CONSENT",
      note: "Consent given and checkout started.",
      customerVisible: false,
      metadata: { consentVersion: MATCHMAKING_CONSENT_VERSION, priceInPaise: terms.priceInPaise, currency: terms.currency, includedMembershipDays: terms.includedMembershipDays },
    });
    return createPendingPaymentRows(
      { userId, purpose: { matchmakingCaseId: lockedCaseId }, gatewayRow, amountInPaise: terms.priceInPaise, currency: terms.currency },
      tx
    );
  });

  // 3. Only now ask the gateway for an order (outside the transaction, so no lock is held during a network call).
  const order = await requestGatewayOrder(
    {
      userId,
      purpose: { matchmakingCaseId: lockedCaseId },
      gatewayRow,
      amountInPaise: terms.priceInPaise,
      currency: terms.currency,
      devSimulateOutcome: input.devSimulateOutcome,
      // The case stays PENDING_PAYMENT (one open case per member), so the member can simply try again.
      onOrderFailure: async () => undefined,
    },
    rows
  );

  await record({
    actorType: "USER",
    actorId: userId,
    action: "matchmaking.checkout_started",
    entityType: "matchmaking_case",
    entityId: lockedCaseId,
    metadata: { paymentId: order.paymentId, priceInPaise: terms.priceInPaise, currency: terms.currency },
  });
  // A Super Admin OFFER invitation is accepted by exactly this: starting the normal checkout.
  await invitationsRepo.markOfferAccepted(userId, lockedCaseId);
  return { ...order, caseId: lockedCaseId };
}

// --- the member's own case ----------------------------------------------------

export interface MemberCaseView {
  id: string;
  status: repo.CaseStatus;
  priceInSmallestUnit: number;
  currency: string;
  includedMembershipDays: number;
  includedAccessUntil: string | null;
  accessRevoked: boolean;
  /** A free case from a Super Admin invitation: no payment was taken. */
  complimentary: boolean;
  paidAt: string | null;
  closedAt: string | null;
  customerNotes: string | null;
  createdAt: string;
}

export interface MemberSuggestionView {
  id: string;
  sentAt: string | null;
  response: repo.SuggestionResponse;
  respondedAt: string | null;
  profile: AuthenticatedPublicProfileView;
}

export interface MyMatchmakingView {
  offer: MatchmakingOffer;
  optOut: boolean;
  case: MemberCaseView | null;
  /** A pending invitation from the matchmaking team, if any. */
  invitation: MemberInvitationView | null;
  history: Array<{ id: string; kind: string; toStatus: string | null; note: string | null; createdAt: string }>;
  suggestions: MemberSuggestionView[];
}

function toMemberCase(c: repo.MatchmakingCaseRow): MemberCaseView {
  return {
    id: c.id,
    status: c.status as repo.CaseStatus,
    priceInSmallestUnit: c.priceInPaise,
    currency: c.currency,
    includedMembershipDays: c.includedMembershipDays,
    includedAccessUntil: c.includedAccessUntil ? c.includedAccessUntil.toISOString() : null,
    accessRevoked: !!c.includedAccessRevokedAt,
    complimentary: c.complimentary,
    paidAt: c.paidAt ? c.paidAt.toISOString() : null,
    closedAt: c.closedAt ? c.closedAt.toISOString() : null,
    customerNotes: c.customerNotes,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * SENT suggestions of a case, as the member is allowed to see them right now: each candidate is re-checked
 * against the full eligibility rules (blocks, visibility, approval, account status, opt-out, gender) and dropped
 * if it no longer passes; profiles use the normal authenticated member view (no e-mail or phone, photo rules kept).
 */
export async function visibleSuggestions(viewerUserId: string, caseRow: repo.MatchmakingCaseRow): Promise<MemberSuggestionView[]> {
  if (!repo.SERVICE_CASE_STATUSES.includes(caseRow.status as repo.CaseStatus)) return [];
  const sent = await repo.listSuggestions(caseRow.id, { status: "SENT" });
  if (sent.length === 0) return [];
  const owner = await loadCaseOwner(caseRow.userId);
  if (!owner) return [];
  const eligible = await eligibleFor(owner, sent.map((s) => s.candidateUserId));
  const byUser = new Map(eligible.map((c) => [c.profile.userId, c]));
  const shown = sent.filter((s) => byUser.has(s.candidateUserId));
  const profilesShown = shown.map((s) => byUser.get(s.candidateUserId)!.profile);
  const [lookups, photos, extras] = await Promise.all([
    resolveLookupsForProfiles(profilesShown),
    profilesRepo.listPhotosForProfiles(profilesShown.map((p) => p.id)),
    viewerExtrasFor(viewerUserId, profilesShown),
  ]);
  return shown.map((s) => {
    const c = byUser.get(s.candidateUserId)!;
    return {
      id: s.id,
      sentAt: s.sentAt ? s.sentAt.toISOString() : null,
      response: s.response as repo.SuggestionResponse,
      respondedAt: s.respondedAt ? s.respondedAt.toISOString() : null,
      profile: toAuthenticatedPublicView(c.profile, c.displayName, lookups.get(c.profile.id)!, photos.get(c.profile.id) ?? [], extras.get(c.profile.id)),
    };
  });
}

export async function getMyMatchmaking(ctx: AuthContext): Promise<MyMatchmakingView> {
  const userId = requireMember(ctx);
  const [offer, profile, latest, invitation] = await Promise.all([
    getOffer(ctx),
    profilesRepo.findByUserId(userId),
    repo.findLatestCaseForUser(userId),
    myPendingInvitation(userId),
  ]);
  if (!latest) return { offer, optOut: profile?.matchmakingOptOut ?? false, case: null, invitation, history: [], suggestions: [] };
  const [events, suggestions] = await Promise.all([repo.listEvents(latest.id, { customerVisibleOnly: true }), visibleSuggestions(userId, latest)]);
  return {
    offer,
    optOut: profile?.matchmakingOptOut ?? false,
    case: toMemberCase(latest),
    invitation,
    history: events.map((e) => ({ id: e.id, kind: e.kind, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt.toISOString() })),
    suggestions,
  };
}

export async function updateMyNotes(ctx: AuthContext, customerNotes: string | null): Promise<MemberCaseView> {
  const userId = requireMember(ctx);
  const open = await repo.findOpenCaseForUser(userId);
  if (!open) throw new NotFoundError("You have no open Personal Matchmaking case.");
  const updated = await repo.updateCustomerNotes(open.id, customerNotes?.trim() || null);
  if (!updated) throw new ConflictError("This case can no longer be changed.");
  await repo.insertEvent({ caseId: open.id, actorType: "USER", actorId: userId, kind: "NOTE", note: "Updated the notes for the matchmaking team.", customerVisible: false });
  return toMemberCase(updated);
}

export async function respondToSuggestion(ctx: AuthContext, suggestionId: string, response: "INTERESTED" | "NOT_INTERESTED"): Promise<MemberSuggestionView> {
  const userId = requireMember(ctx);
  const suggestion = await repo.findSuggestionById(suggestionId);
  const caseRow = suggestion ? await repo.findCaseById(suggestion.caseId) : undefined;
  // Same answer whether the suggestion does not exist, is not this member's, was never sent, or its profile is no
  // longer eligible — nothing can be probed through this endpoint.
  if (!suggestion || !caseRow || caseRow.userId !== userId || suggestion.status !== "SENT") throw new NotFoundError("Suggestion not found.");
  const visible = (await visibleSuggestions(userId, caseRow)).find((s) => s.id === suggestionId);
  if (!visible) throw new NotFoundError("Suggestion not found.");

  const updated = await repo.setSuggestionResponse(suggestionId, response);
  if (!updated) throw new NotFoundError("Suggestion not found.");
  await repo.insertEvent({
    caseId: caseRow.id,
    actorType: "USER",
    actorId: userId,
    kind: "SUGGESTION",
    note: response === "INTERESTED" ? "Marked a suggestion as interested." : "Marked a suggestion as not interested.",
    customerVisible: false,
    metadata: { suggestionId, response },
  });
  return { ...visible, response, respondedAt: (updated.respondedAt ?? new Date()).toISOString() };
}

export async function setMyOptOut(ctx: AuthContext, optOut: boolean): Promise<{ optOut: boolean }> {
  const userId = requireMember(ctx);
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new NotFoundError("Create your profile first.");
  if (profile.matchmakingOptOut !== optOut) {
    await profilesRepo.update(profile.id, { matchmakingOptOut: optOut });
    await record({ actorType: "USER", actorId: userId, action: "matchmaking.opt_out_changed", entityType: "profile", entityId: profile.id, metadata: { optOut } });
  }
  return { optOut };
}
