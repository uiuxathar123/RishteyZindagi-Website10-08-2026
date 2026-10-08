import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { ok } from "@/server/lib/response";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import * as preferencesService from "./preferences.service";

const uuidField = z.string().uuid();

const upsertPreferencesSchema = z
  .object({
    ageMin: z.number().int().min(18).max(100).optional(),
    ageMax: z.number().int().min(18).max(100).optional(),
    heightMinCm: z.number().int().min(90).max(250).optional(),
    heightMaxCm: z.number().int().min(90).max(250).optional(),
    // §4: "do not create arbitrary gender values" — the same two-value
    // enum profiles.gender uses, nothing invented for preferences.
    genderPreference: z.enum(["MALE", "FEMALE"]).optional(),
    religionId: uuidField.optional(),
    // §4: "DO NOT create an Any Marital Status option" — the absence of
    // this field (or an empty array) already means "no restriction"; no
    // sentinel value is accepted or needed.
    maritalStatusIds: z.array(uuidField).max(20).optional(),
    communityIds: z.array(uuidField).max(20).optional(),
    motherTongueIds: z.array(uuidField).max(20).optional(),
    educationIds: z.array(uuidField).max(20).optional(),
    professionIds: z.array(uuidField).max(20).optional(),
    // §4: the one special value the brief does ask for — ANY_PROFESSION —
    // modeled as this explicit boolean rather than a sentinel string
    // mixed into professionIds (see schema.ts's comment on the column).
    professionAny: z.boolean().optional(),
    countryIds: z.array(uuidField).max(20).optional(),
    cityIds: z.array(uuidField).max(20).optional(),
    incomeMinAmount: z.number().int().min(0).max(1_000_000_000).optional(),
    incomeMaxAmount: z.number().int().min(0).max(1_000_000_000).optional(),
    incomeCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "incomeCurrency must be a 3-letter ISO 4217 code")
      .optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.ageMin === undefined || v.ageMax === undefined || v.ageMin <= v.ageMax, {
    message: "ageMin must be less than or equal to ageMax.",
    path: ["ageMin"],
  })
  .refine((v) => v.heightMinCm === undefined || v.heightMaxCm === undefined || v.heightMinCm <= v.heightMaxCm, {
    message: "heightMinCm must be less than or equal to heightMaxCm.",
    path: ["heightMinCm"],
  })
  .refine(
    (v) => v.incomeMinAmount === undefined || v.incomeMaxAmount === undefined || v.incomeMinAmount <= v.incomeMaxAmount,
    { message: "incomeMinAmount must be less than or equal to incomeMaxAmount.", path: ["incomeMinAmount"] }
  )
  .refine((v) => !(v.professionAny === true && v.professionIds && v.professionIds.length > 0), {
    message: "professionIds must be empty when professionAny is true.",
    path: ["professionIds"],
  });

export async function getMyPreferencesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const preferences = await preferencesService.getMyPreferences(ctx);
  return ok({ preferences });
}

export async function upsertMyPreferencesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`preferences-update:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, upsertPreferencesSchema);
  const preferences = await preferencesService.upsertMyPreferences(ctx, body);
  return ok({ preferences }, "Partner preferences saved.");
}
