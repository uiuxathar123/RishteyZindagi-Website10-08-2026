/**
 * B4: partner-preference business logic — one preference configuration
 * per profile, owner-only, deterministic (no hidden defaults that alter
 * search results — see §7).
 */
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { record } from "@/server/modules/audit/audit.service";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";
import * as preferencesRepo from "./preferences.repository";
import type { PartnerPreferenceWrite } from "./preferences.repository";
import { toPartnerPreferenceView, type PartnerPreferenceView } from "./preferences.dto";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

async function requireOwnedProfile(ctx: AuthContext) {
  const userId = requireMemberSubject(ctx);
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new NotFoundError("No profile exists for this account yet. Create one first.");
  return profile;
}

export interface UpsertPreferencesInput {
  ageMin?: number;
  ageMax?: number;
  heightMinCm?: number;
  heightMaxCm?: number;
  genderPreference?: "MALE" | "FEMALE";
  religionId?: string;
  maritalStatusIds?: string[];
  communityIds?: string[];
  motherTongueIds?: string[];
  educationIds?: string[];
  professionIds?: string[];
  professionAny?: boolean;
  countryIds?: string[];
  cityIds?: string[];
  incomeMinAmount?: number;
  incomeMaxAmount?: number;
  incomeCurrency?: string;
  notes?: string;
}

/** Confirms every referenced id actually exists (never trust the client —
 * B4 §23) and that "ANY_PROFESSION" and an explicit profession list
 * aren't both supplied at once (§4/§9's mutually-exclusive semantics). */
async function validateReferences(input: UpsertPreferencesInput): Promise<void> {
  if (input.religionId && !(await referenceRepo.religionExists(input.religionId))) {
    throw new ValidationError("religionId does not reference a known religion.");
  }
  if (input.professionAny && input.professionIds && input.professionIds.length > 0) {
    throw new ValidationError("professionIds must be empty when professionAny is true.");
  }

  const idListChecks: Array<[string, string[] | undefined, (id: string) => Promise<boolean>]> = [
    ["maritalStatusIds", input.maritalStatusIds, referenceRepo.maritalStatusExists],
    ["motherTongueIds", input.motherTongueIds, referenceRepo.motherTongueExists],
    ["educationIds", input.educationIds, referenceRepo.educationExists],
    ["professionIds", input.professionIds, referenceRepo.professionExists],
    ["countryIds", input.countryIds, referenceRepo.countryExists],
  ];
  for (const [field, ids, checker] of idListChecks) {
    if (!ids) continue;
    for (const id of ids) {
      if (!(await checker(id))) throw new ValidationError(`${field} contains an id that does not exist: ${id}`);
    }
  }

  if (input.communityIds) {
    for (const communityId of input.communityIds) {
      // Communities are open-ended (findOrCreate on write, per B3) — here
      // we only confirm the id exists at all, the same "existence" bar
      // reference ids get elsewhere; a community not scoped to the
      // preference's own religion is a product/UX concern, not a data
      // integrity one, since a preference's religion is optional.
      const community = await referenceRepo.getCommunityById(communityId);
      if (!community) throw new ValidationError(`communityIds contains an id that does not exist: ${communityId}`);
    }
  }
  if (input.cityIds) {
    for (const cityId of input.cityIds) {
      const city = await referenceRepo.getCityById(cityId);
      if (!city) throw new ValidationError(`cityIds contains an id that does not exist: ${cityId}`);
    }
  }
}

function toWrite(input: UpsertPreferencesInput): PartnerPreferenceWrite {
  const write: PartnerPreferenceWrite = {};
  if (input.ageMin !== undefined) write.ageMin = input.ageMin;
  if (input.ageMax !== undefined) write.ageMax = input.ageMax;
  if (input.heightMinCm !== undefined) write.heightMinCm = input.heightMinCm;
  if (input.heightMaxCm !== undefined) write.heightMaxCm = input.heightMaxCm;
  if (input.genderPreference !== undefined) write.genderPreference = input.genderPreference;
  if (input.religionId !== undefined) write.religionId = input.religionId;
  if (input.maritalStatusIds !== undefined) write.maritalStatusIds = input.maritalStatusIds;
  if (input.communityIds !== undefined) write.communityIds = input.communityIds;
  if (input.motherTongueIds !== undefined) write.motherTongueIds = input.motherTongueIds;
  if (input.educationIds !== undefined) write.educationIds = input.educationIds;
  if (input.professionIds !== undefined) write.professionIds = input.professionIds;
  if (input.professionAny !== undefined) write.professionAny = input.professionAny;
  if (input.countryIds !== undefined) write.countryIds = input.countryIds;
  if (input.cityIds !== undefined) write.cityIds = input.cityIds;
  if (input.incomeMinAmount !== undefined) write.incomeMinAmount = input.incomeMinAmount;
  if (input.incomeMaxAmount !== undefined) write.incomeMaxAmount = input.incomeMaxAmount;
  if (input.incomeCurrency !== undefined) write.incomeCurrency = input.incomeCurrency;
  if (input.notes !== undefined) write.notes = input.notes;
  return write;
}

async function toView(profileId: string): Promise<PartnerPreferenceView | null> {
  const row = await preferencesRepo.findByProfileId(profileId);
  if (!row) return null;
  const religion = row.religionId ? (await referenceRepo.getReligionById(row.religionId)) ?? null : null;
  return toPartnerPreferenceView(row, religion);
}

export async function getMyPreferences(ctx: AuthContext): Promise<PartnerPreferenceView | null> {
  const profile = await requireOwnedProfile(ctx);
  return toView(profile.id);
}

export async function upsertMyPreferences(ctx: AuthContext, input: UpsertPreferencesInput): Promise<PartnerPreferenceView> {
  const profile = await requireOwnedProfile(ctx);
  await validateReferences(input);

  const existed = !!(await preferencesRepo.findByProfileId(profile.id));
  await preferencesRepo.upsert(profile.id, toWrite(input));

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: existed ? "partner_preferences.updated" : "partner_preferences.created",
    entityType: "partner_preferences",
    entityId: profile.id,
    metadata: { changedFields: Object.keys(input) },
  });

  const view = await toView(profile.id);
  if (!view) throw new NotFoundError("Partner preferences not found after save.");
  return view;
}
