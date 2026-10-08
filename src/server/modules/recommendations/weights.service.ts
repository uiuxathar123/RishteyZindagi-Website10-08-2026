/**
 * B5 gap-fix §5/§6: admin-configurable matching category weights.
 *
 * Mirrors `otp-config.service.ts`'s exact shape — another platform-wide
 * setting singleton, gated behind the existing `platform.settings.manage`
 * permission (already SUPER_ADMIN-only by the B1 seed; STAFF_ADMIN does
 * not get it by default — see BACKEND.md's permission table), so this
 * reuses B1's RBAC exactly rather than inventing a second authorization
 * concept, per the gap-fix instruction's explicit "reuse the existing B1
 * RBAC system... do not create a second authorization system." A
 * suitable permission already existed, so there was no need to STOP and
 * report a missing one.
 */
import { ValidationError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { DEFAULT_CATEGORY_WEIGHTS, validateWeightMap, type WeightMap } from "./scoring";
import * as weightsRepo from "./weights.repository";
import type { MatchingWeightConfigRow } from "./weights.repository";

const PERMISSION = "platform.settings.manage";

export interface PublicWeightConfig {
  weights: WeightMap;
  updatedAt: string;
  updatedByAdminId: string | null;
}

function toWeightMap(row: MatchingWeightConfigRow): WeightMap {
  return {
    age: row.ageWeight,
    height: row.heightWeight,
    religion: row.religionWeight,
    community: row.communityWeight,
    motherTongue: row.motherTongueWeight,
    education: row.educationWeight,
    profession: row.professionWeight,
    maritalStatus: row.maritalStatusWeight,
    location: row.locationWeight,
    income: row.incomeWeight,
  };
}

function toPublic(row: MatchingWeightConfigRow): PublicWeightConfig {
  return {
    weights: toWeightMap(row),
    updatedAt: row.updatedAt.toISOString(),
    updatedByAdminId: row.updatedByAdminId ?? null,
  };
}

/**
 * Reads the currently *active* weight configuration for scoring — used
 * by `recommendations.service.ts` on every recommendations request, NOT
 * gated behind admin permission (any authenticated member's
 * recommendations must be scored with the live weights; only *changing*
 * them is an admin action). Falls back to `DEFAULT_CATEGORY_WEIGHTS`
 * if the singleton row is somehow missing, rather than throwing and
 * breaking every member's recommendations over an admin-config
 * infrastructure problem — "missing configuration falls back safely to
 * defaults" (§5). This is the one place in the B5 gap-fix that
 * deliberately does NOT mirror otp-config.repository.ts's "throw loudly
 * if missing" posture, precisely because the blast radius is different:
 * a missing OTP config breaks login/signup outright (correct to throw),
 * while a missing weight config should just mean "score with the known-
 * good defaults" for a feature that's supposed to degrade gracefully.
 */
export async function getActiveWeights(): Promise<WeightMap> {
  try {
    const row = await weightsRepo.get();
    return toWeightMap(row);
  } catch {
    return DEFAULT_CATEGORY_WEIGHTS;
  }
}

/** Admin-facing read — same underlying row as `getActiveWeights`, but
 * requires `platform.settings.manage` and returns the full public shape
 * (including `updatedAt`/`updatedByAdminId`) an admin UI would want. */
export async function getConfig(ctx: AuthContext): Promise<PublicWeightConfig> {
  await requirePermission(ctx, PERMISSION);
  const row = await weightsRepo.get();
  return toPublic(row);
}

export type UpdateWeightsInput = Record<string, unknown>;

/**
 * Validates and persists a full replacement weight configuration. All
 * ten categories must be supplied together (see `validateWeightMap` in
 * scoring.ts for the exact reasoning) — there is no partial-update path,
 * because "total must equal 100" cannot be checked against a partial
 * set. An invalid configuration is rejected with a `ValidationError`
 * (400) and nothing is written — "if a configuration is invalid, reject
 * it rather than silently creating unpredictable scoring" (§6).
 */
export async function updateWeights(
  ctx: AuthContext,
  input: UpdateWeightsInput,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<PublicWeightConfig> {
  await requirePermission(ctx, PERMISSION);

  const validation = validateWeightMap(input);
  if (!validation.valid || !validation.weights) {
    throw new ValidationError(validation.error ?? "Invalid weight configuration.");
  }

  const before = await weightsRepo.get();
  const updated = await weightsRepo.update({
    ageWeight: validation.weights.age,
    heightWeight: validation.weights.height,
    religionWeight: validation.weights.religion,
    communityWeight: validation.weights.community,
    motherTongueWeight: validation.weights.motherTongue,
    educationWeight: validation.weights.education,
    professionWeight: validation.weights.profession,
    maritalStatusWeight: validation.weights.maritalStatus,
    locationWeight: validation.weights.location,
    incomeWeight: validation.weights.income,
    updatedByAdminId: ctx.subject.id,
  });

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "matching_weights.update",
    entityType: "matching_weight_config",
    // Singleton keyed by a plain integer (always 1), not a uuid — same
    // reasoning as otp_configs's own audit entries; entityType alone is
    // unambiguous.
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { before: toWeightMap(before), after: toWeightMap(updated) },
  });

  return toPublic(updated);
}
