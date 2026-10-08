import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import type { AuthContext } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import * as searchService from "./search.service";

/** Soft authentication — search must work for both signed-in and
 * anonymous callers (§13/§14), same pattern as
 * profiles.controller.ts's own tryAuthenticate. Kept as a small local
 * copy rather than importing that one, so B4 doesn't need to widen a
 * frozen B3 file's exports for a five-line helper. */
async function tryAuthenticate(req: NextRequest): Promise<AuthContext | null> {
  try {
    return await authenticate(req);
  } catch {
    return null;
  }
}

function ipKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
}

const uuidField = z.string().uuid();

function parseIdList(raw: string | null): string[] | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const parsed = z.array(uuidField).max(30).safeParse(ids);
  if (!parsed.success) {
    throw new ValidationError("One or more id-list query parameters contain an invalid id.", parsed.error.issues);
  }
  return parsed.data;
}

function parseBool(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ValidationError("Boolean query parameters must be 'true' or 'false'.");
}

function parseInt10(raw: string | null, field: string): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  if (!/^-?\d+$/.test(raw.trim())) throw new ValidationError(`${field} must be an integer.`);
  return Number.parseInt(raw, 10);
}

const searchQuerySchema = z
  .object({
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    minAge: z.number().int().min(18).max(100).optional(),
    maxAge: z.number().int().min(18).max(100).optional(),
    religionIds: z.array(uuidField).max(30).optional(),
    communityIds: z.array(uuidField).max(30).optional(),
    motherTongueIds: z.array(uuidField).max(30).optional(),
    educationIds: z.array(uuidField).max(30).optional(),
    professionIds: z.array(uuidField).max(30).optional(),
    anyProfession: z.boolean().optional(),
    maritalStatusIds: z.array(uuidField).max(30).optional(),
    countryId: uuidField.optional(),
    cityId: uuidField.optional(),
    minHeightCm: z.number().int().min(90).max(250).optional(),
    maxHeightCm: z.number().int().min(90).max(250).optional(),
    minIncome: z.number().int().min(0).max(1_000_000_000).optional(),
    maxIncome: z.number().int().min(0).max(1_000_000_000).optional(),
    incomeCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "incomeCurrency must be a 3-letter ISO 4217 code")
      .optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(searchService.MAX_PAGE_SIZE).optional(),
    // §18: only these two deterministic fields — never a "smart ranking"
    // field, which is exclusively B5 scope.
    sortBy: z.enum(["updatedAt", "createdAt"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strict()
  .refine((v) => v.minAge === undefined || v.maxAge === undefined || v.minAge <= v.maxAge, {
    message: "minAge must be less than or equal to maxAge.",
    path: ["minAge"],
  })
  .refine((v) => v.minHeightCm === undefined || v.maxHeightCm === undefined || v.minHeightCm <= v.maxHeightCm, {
    message: "minHeightCm must be less than or equal to maxHeightCm.",
    path: ["minHeightCm"],
  })
  .refine((v) => v.minIncome === undefined || v.maxIncome === undefined || v.minIncome <= v.maxIncome, {
    message: "minIncome must be less than or equal to maxIncome.",
    path: ["minIncome"],
  })
  .refine((v) => !((v.minIncome !== undefined || v.maxIncome !== undefined) && !v.incomeCurrency), {
    message: "incomeCurrency is required whenever minIncome or maxIncome is supplied.",
    path: ["incomeCurrency"],
  });

export async function searchProfilesHandler(req: NextRequest) {
  const viewer = await tryAuthenticate(req);
  checkRateLimit(`search:${viewer ? viewer.subject.id : ipKey(req)}`, 60, 60_000);

  const url = new URL(req.url);
  const sp = url.searchParams;

  // Every "unknown query key" is rejected below by .strict() — build the
  // raw object only from keys this endpoint recognizes, so an unrecognized
  // key surfaces as a clear 400 rather than being silently ignored (§23).
  const raw: Record<string, unknown> = {};
  for (const key of Array.from(sp.keys())) {
    if (
      ![
        "gender",
        "minAge",
        "maxAge",
        "religionIds",
        "communityIds",
        "motherTongueIds",
        "educationIds",
        "professionIds",
        "anyProfession",
        "maritalStatusIds",
        "countryId",
        "cityId",
        "minHeightCm",
        "maxHeightCm",
        "minIncome",
        "maxIncome",
        "incomeCurrency",
        "page",
        "pageSize",
        "sortBy",
        "sortDir",
      ].includes(key)
    ) {
      throw new ValidationError(`Unsupported search query parameter: ${key}`);
    }
  }

  const parsedQuery = {
    gender: sp.get("gender") ?? undefined,
    minAge: parseInt10(sp.get("minAge"), "minAge"),
    maxAge: parseInt10(sp.get("maxAge"), "maxAge"),
    religionIds: parseIdList(sp.get("religionIds")),
    communityIds: parseIdList(sp.get("communityIds")),
    motherTongueIds: parseIdList(sp.get("motherTongueIds")),
    educationIds: parseIdList(sp.get("educationIds")),
    professionIds: parseIdList(sp.get("professionIds")),
    anyProfession: parseBool(sp.get("anyProfession")),
    maritalStatusIds: parseIdList(sp.get("maritalStatusIds")),
    countryId: sp.get("countryId") ?? undefined,
    cityId: sp.get("cityId") ?? undefined,
    minHeightCm: parseInt10(sp.get("minHeightCm"), "minHeightCm"),
    maxHeightCm: parseInt10(sp.get("maxHeightCm"), "maxHeightCm"),
    minIncome: parseInt10(sp.get("minIncome"), "minIncome"),
    maxIncome: parseInt10(sp.get("maxIncome"), "maxIncome"),
    incomeCurrency: sp.get("incomeCurrency") ?? undefined,
    page: parseInt10(sp.get("page"), "page"),
    pageSize: parseInt10(sp.get("pageSize"), "pageSize"),
    sortBy: sp.get("sortBy") ?? undefined,
    sortDir: sp.get("sortDir") ?? undefined,
  };

  const result = searchQuerySchema.safeParse(parsedQuery);
  if (!result.success) {
    throw new ValidationError("One or more search filters are invalid.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const q = result.data;

  const page = await searchService.searchProfiles(viewer, {
    filters: {
      gender: q.gender,
      minAge: q.minAge,
      maxAge: q.maxAge,
      religionIds: q.religionIds,
      communityIds: q.communityIds,
      motherTongueIds: q.motherTongueIds,
      educationIds: q.educationIds,
      professionIds: q.professionIds,
      anyProfession: q.anyProfession,
      maritalStatusIds: q.maritalStatusIds,
      countryId: q.countryId,
      cityId: q.cityId,
      minHeightCm: q.minHeightCm,
      maxHeightCm: q.maxHeightCm,
      minIncome: q.minIncome,
      maxIncome: q.maxIncome,
      incomeCurrency: q.incomeCurrency,
    },
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
  });

  return ok(page);
}
