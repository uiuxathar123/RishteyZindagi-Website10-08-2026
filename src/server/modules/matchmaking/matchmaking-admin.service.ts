/**
 * Personal Matchmaking administration. Every function here starts with requireSuperAdmin(ctx): the role is checked
 * by NAME (never a delegable permission) and an account on a temporary password is refused. Every change is
 * written to the case history and to the platform audit log.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireSuperAdmin } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import { resolveLookupsForProfiles } from "@/server/modules/profiles/profiles.service";
import { toAuthenticatedPublicView } from "@/server/modules/profiles/profiles.dto";
import type { CandidateRow } from "@/server/modules/recommendations/recommendations.repository";
import * as repo from "./matchmaking.repository";
import { eligibleFor, loadCaseOwner, scoreFor, type CaseOwner } from "./matchmaking-eligibility";
import {
  getMatchmakingSettings,
  personalMatchmakingSettingsSchema,
  saveMatchmakingSettings,
  type PersonalMatchmakingSettings,
} from "./matchmaking-settings";

export interface AdminMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const UNIQUE_VIOLATION = "23505";
export const MAX_RECOMMENDATIONS = 50;

async function audit(ctx: AuthContext, action: string, entityId: string, meta: AdminMeta, metadata?: Record<string, unknown>) {
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action,
    entityType: "matchmaking_case",
    entityId,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata,
  });
}

async function loadCase(caseId: string): Promise<repo.MatchmakingCaseRow> {
  const c = await repo.findCaseById(caseId);
  if (!c) throw new NotFoundError("Case not found.");
  return c;
}

/** A compact, contact-free profile summary for the admin screens (the member-facing public view, without photos). */
async function candidateCards(candidates: CandidateRow[]) {
  const profiles = candidates.map((c) => c.profile);
  const lookups = await resolveLookupsForProfiles(profiles);
  return new Map(
    candidates.map((c) => {
      const view = toAuthenticatedPublicView(c.profile, c.displayName, lookups.get(c.profile.id)!, [], { photosVisible: false });
      return [c.profile.userId, { ...view, photos: [] }];
    })
  );
}

// --- settings -----------------------------------------------------------------

export async function getSettings(ctx: AuthContext): Promise<PersonalMatchmakingSettings> {
  requireSuperAdmin(ctx);
  return getMatchmakingSettings();
}

export async function updateSettings(ctx: AuthContext, input: unknown, meta: AdminMeta): Promise<PersonalMatchmakingSettings> {
  requireSuperAdmin(ctx);
  const parsed = personalMatchmakingSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid Personal Matchmaking settings.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const next = parsed.data;
  if (next.enabled && next.prices.INR === null && next.prices.USD === null) {
    throw new ValidationError("Set at least one price before enabling Personal Matchmaking.");
  }
  const before = await getMatchmakingSettings();
  const saved = await saveMatchmakingSettings(next, ctx.subject.id);
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "matchmaking.settings_updated",
    entityType: "platform_setting",
    entityId: undefined,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { before, after: saved },
  });
  return saved;
}

// --- cases -------------------------------------------------------------------

export async function listCases(ctx: AuthContext, filter: { status?: repo.CaseStatus; page: number; pageSize: number }) {
  requireSuperAdmin(ctx);
  const { rows, total } = await repo.listCases({ status: filter.status, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize });
  return {
    items: rows.map((r) => ({
      id: r.case.id,
      status: r.case.status,
      customer: { userId: r.case.userId, name: r.customerName, email: r.customerEmail },
      priceInSmallestUnit: r.case.priceInPaise,
      complimentary: r.case.complimentary,
      currency: r.case.currency,
      paidAt: r.case.paidAt,
      includedAccessUntil: r.case.includedAccessUntil,
      suggestionsSent: r.suggestionsSent,
      suggestionsTotal: r.suggestionsTotal,
      duplicateCaptures: r.duplicateCaptures,
      createdAt: r.case.createdAt,
      updatedAt: r.case.updatedAt,
    })),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
  };
}

export async function getCase(ctx: AuthContext, caseId: string) {
  requireSuperAdmin(ctx);
  const c = await loadCase(caseId);
  const [customer] = await db.select({ id: users.id, name: users.name, email: users.email, status: users.status }).from(users).where(eq(users.id, c.userId));
  const owner = await loadCaseOwner(c.userId);
  const [events, suggestions, casePayments] = await Promise.all([
    repo.listEvents(c.id, { customerVisibleOnly: false }),
    repo.listSuggestions(c.id),
    repo.listCasePayments(c.id),
  ]);
  const stillEligible = owner ? await eligibleFor(owner, suggestions.map((s) => s.candidateUserId)) : [];
  const eligibleIds = new Set(stillEligible.map((e) => e.profile.userId));
  const cards = await candidateCards(stillEligible);
  return {
    case: c,
    customer: customer ?? null,
    customerProfile: owner ? { profileId: owner.profile.publicId, gender: owner.profile.gender, hasPreferences: !!owner.preferences, profileStatus: owner.profile.profileStatus } : null,
    events,
    payments: casePayments,
    duplicateCaptures: casePayments.filter((p) => p.duplicateCapture).length,
    suggestions: suggestions.map((s) => ({ ...s, candidateEligibleNow: eligibleIds.has(s.candidateUserId), candidate: cards.get(s.candidateUserId) ?? null })),
  };
}

export async function addNote(ctx: AuthContext, caseId: string, input: { note: string; customerVisible: boolean }, meta: AdminMeta) {
  requireSuperAdmin(ctx);
  const c = await loadCase(caseId);
  const note = input.note.trim();
  if (!note) throw new ValidationError("A note cannot be empty.");
  const event = await repo.insertEvent({ caseId: c.id, actorType: "ADMIN", actorId: ctx.subject.id, kind: "NOTE", note, customerVisible: input.customerVisible });
  if (input.customerVisible) {
    await notify({ userId: c.userId, channel: "IN_APP", title: "Update on your Personal Matchmaking", body: note.slice(0, 280), dedupeKey: `matchmaking_note:${event.id}` });
  }
  await audit(ctx, "matchmaking.note_added", c.id, meta, { customerVisible: input.customerVisible });
  return event;
}

/** Allowed Super Admin status changes. Payment-driven states (ACTIVE from payment, REFUNDED) are never set by hand. */
const ADMIN_TRANSITIONS: Record<string, repo.CaseStatus[]> = {
  IN_PROGRESS: ["ACTIVE"],
  COMPLETED: ["ACTIVE", "IN_PROGRESS"],
  CANCELLED: ["ACTIVE", "IN_PROGRESS"],
};

export async function changeStatus(ctx: AuthContext, caseId: string, input: { status: repo.CaseStatus; note?: string; customerVisible?: boolean }, meta: AdminMeta) {
  requireSuperAdmin(ctx);
  const c = await loadCase(caseId);
  const allowedFrom = ADMIN_TRANSITIONS[input.status];
  if (!allowedFrom) throw new ValidationError(`A case cannot be set to ${input.status} by hand.`);
  if (!allowedFrom.includes(c.status as repo.CaseStatus)) throw new ConflictError(`A ${c.status} case cannot be changed to ${input.status}.`);
  const closing = input.status === "COMPLETED" || input.status === "CANCELLED";
  const updated = await repo.transitionCase(c.id, allowedFrom, input.status, closing ? { closedAt: new Date() } : {});
  if (!updated) throw new ConflictError("The case changed in the meantime. Reload and try again.");
  const customerVisible = input.customerVisible ?? true;
  await repo.insertEvent({
    caseId: c.id,
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    kind: "STATUS_CHANGE",
    fromStatus: c.status,
    toStatus: input.status,
    note: input.note?.trim() || null,
    customerVisible,
  });
  if (customerVisible) {
    const label = input.status === "IN_PROGRESS" ? "is now in progress" : input.status === "COMPLETED" ? "has been completed" : "has been closed";
    await notify({ userId: c.userId, channel: "IN_APP", title: "Personal Matchmaking update", body: `Your Personal Matchmaking case ${label}.`, dedupeKey: `matchmaking_status:${c.id}:${input.status}` });
  }
  await audit(ctx, "matchmaking.status_changed", c.id, meta, { from: c.status, to: input.status });
  return updated;
}

// --- recommendations and suggestions --------------------------------------------

function requireWorkableCase(c: repo.MatchmakingCaseRow) {
  if (c.status !== "ACTIVE" && c.status !== "IN_PROGRESS") throw new ConflictError("Suggestions can only be worked on for an active case.");
}

async function requireOwner(c: repo.MatchmakingCaseRow): Promise<CaseOwner> {
  const owner = await loadCaseOwner(c.userId);
  if (!owner) throw new ConflictError("The customer has no profile.");
  return owner;
}

/** Automatic recommendations: the eligible pool for the customer, scored with the live weights, best first. Already
 * suggested candidates (in any state) are left out. Nothing is saved until a Super Admin adds one. */
export async function getRecommendations(ctx: AuthContext, caseId: string) {
  requireSuperAdmin(ctx);
  const c = await loadCase(caseId);
  requireWorkableCase(c);
  const owner = await requireOwner(c);
  const already = new Set(await repo.suggestedCandidateIds(c.id));
  const pool = (await eligibleFor(owner)).filter((cand) => !already.has(cand.profile.userId));
  if (!owner.preferences) return { status: "preferences_not_configured" as const, items: [] };
  const scored = (await scoreFor(owner, pool))
    .filter((s) => s.result?.evaluable)
    .sort((a, b) => b.result!.score - a.result!.score || a.candidate.profile.id.localeCompare(b.candidate.profile.id))
    .slice(0, MAX_RECOMMENDATIONS);
  const cards = await candidateCards(scored.map((s) => s.candidate));
  return {
    status: "ok" as const,
    items: scored.map((s) => ({
      candidateUserId: s.candidate.profile.userId,
      score: s.result!.score,
      tier: s.tier,
      breakdown: s.result!.breakdown,
      candidate: cards.get(s.candidate.profile.userId)!,
    })),
  };
}

/** Adds a candidate to the case (AUTO when picked from the recommendations, MANUAL otherwise). The candidate must pass
 * exactly the same eligibility rules either way; the score is always recomputed on the server. */
export async function addSuggestion(ctx: AuthContext, caseId: string, input: { candidateUserId: string; source: "AUTO" | "MANUAL" }, meta: AdminMeta) {
  requireSuperAdmin(ctx);
  const c = await loadCase(caseId);
  requireWorkableCase(c);
  const owner = await requireOwner(c);
  const [eligible] = await eligibleFor(owner, [input.candidateUserId]);
  if (!eligible) throw new ConflictError("This profile cannot be suggested: it is not eligible for this customer (visibility, approval, account status, blocks, gender preference or matchmaking opt-out).");
  const [scored] = await scoreFor(owner, [eligible]);
  let row: repo.MatchmakingSuggestionRow;
  try {
    row = await repo.insertSuggestion({
      caseId: c.id,
      candidateUserId: input.candidateUserId,
      source: input.source,
      score: scored.result?.evaluable ? scored.result.score : null,
      scoreBreakdown: scored.result ? scored.result.breakdown : null,
      status: "PROPOSED",
      createdByAdminId: ctx.subject.id,
    });
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION || (err as { cause?: { code?: string } })?.cause?.code === UNIQUE_VIOLATION) {
      throw new ConflictError("This profile is already on this case.");
    }
    throw err;
  }
  await repo.insertEvent({ caseId: c.id, actorType: "ADMIN", actorId: ctx.subject.id, kind: "SUGGESTION", note: `Suggestion added (${input.source}).`, customerVisible: false, metadata: { suggestionId: row.id } });
  await audit(ctx, "matchmaking.suggestion_added", c.id, meta, { suggestionId: row.id, candidateUserId: input.candidateUserId, source: input.source });
  return row;
}

export async function actOnSuggestion(ctx: AuthContext, suggestionId: string, action: "APPROVE" | "SEND" | "WITHDRAW", meta: AdminMeta) {
  requireSuperAdmin(ctx);
  const s = await repo.findSuggestionById(suggestionId);
  if (!s) throw new NotFoundError("Suggestion not found.");
  const c = await loadCase(s.caseId);
  const now = new Date();
  let updated: repo.MatchmakingSuggestionRow | undefined;

  if (action === "WITHDRAW") {
    updated = await repo.transitionSuggestion(s.id, ["PROPOSED", "APPROVED", "SENT"], "WITHDRAWN", { withdrawnAt: now });
    if (!updated) throw new ConflictError("This suggestion is already withdrawn.");
  } else {
    requireWorkableCase(c);
    // Re-checked at every step: a profile that became ineligible since it was added can never be approved or sent.
    const owner = await requireOwner(c);
    const [eligible] = await eligibleFor(owner, [s.candidateUserId]);
    if (!eligible) throw new ConflictError("This profile is no longer eligible to be suggested. Withdraw the suggestion instead.");
    if (action === "APPROVE") {
      updated = await repo.transitionSuggestion(s.id, ["PROPOSED"], "APPROVED", { approvedAt: now });
      if (!updated) throw new ConflictError("Only a proposed suggestion can be approved.");
    } else {
      updated = await repo.transitionSuggestion(s.id, ["APPROVED"], "SENT", { sentAt: now });
      if (!updated) throw new ConflictError("Approve the suggestion before sending it.");
      await notify({
        userId: c.userId,
        channel: "IN_APP",
        title: "New Personal Matchmaking suggestion",
        body: "Your matchmaking team has shared a new profile with you.",
        dedupeKey: `matchmaking_suggestion_sent:${s.id}`,
      });
    }
  }

  await repo.insertEvent({
    caseId: c.id,
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    kind: "SUGGESTION",
    note: action === "SEND" ? "A new profile suggestion was shared with you." : `Suggestion ${action === "APPROVE" ? "approved" : "withdrawn"}.`,
    customerVisible: action === "SEND",
    metadata: { suggestionId: s.id, action },
  });
  await audit(ctx, `matchmaking.suggestion_${action.toLowerCase()}`, c.id, meta, { suggestionId: s.id });
  return updated;
}
