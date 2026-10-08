/**
 * RishteyZindagi backend — Phase B1 schema foundation.
 *
 * Scope note (see BACKEND.md for the full B1 report): this establishes the
 * relational shape, IDs, timestamps, relations, indexes and constraints for
 * every entity B1 asked for. Only a handful of these tables are actually
 * read/written by working API code in B1 (users, profiles + its lookups,
 * admin_roles/permissions/role_permissions/admin_users, audit_logs,
 * device_sessions, login_attempts) — the rest exist as correctly-shaped
 * foundation for the phases that will build the real business logic on top
 * of them (B2+), per the brief's explicit "schema foundation only, don't
 * overbuild business rules yet" instruction.
 *
 * ORM choice: Drizzle ORM + node-postgres (`pg`), not Prisma. Prisma's CLI
 * needs to download a platform-specific native query-engine binary from
 * `binaries.prisma.sh` on `generate`/`migrate`, and this sandbox's egress
 * allowlist (registry.npmjs.org and a short list of others — see
 * `/root/.ccr/README.md`) blocks that host outright (confirmed: every
 * attempt came back "403 Forbidden" / "connect_rejected — organization
 * policy"). Drizzle talks to Postgres over the wire protocol through the
 * pure-JS `pg` driver, so it needs nothing beyond the npm registry, which
 * this sandbox can already reach — the same reasoning documented in
 * BACKEND.md. It's a first-class, widely-used choice for Next.js/TypeScript
 * backends, not a downgrade from Prisma.
 *
 * IDs are generated in application code (`crypto.randomUUID()` via
 * `.$defaultFn`) rather than a Postgres-side `gen_random_uuid()`, so
 * nothing here depends on the `pgcrypto` extension being enabled.
 *
 * `updated_at` columns are NOT auto-updated by a DB trigger in B1 — every
 * repository update call sets it explicitly (see `src/server/lib/db-helpers.ts`).
 * A DB-side trigger is a reasonable B2+ hardening step, noted in BACKEND.md.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const accountStatusEnum = pgEnum("account_status", [
  "ACTIVE",
  "SUSPENDED",
  "DELETED_PENDING",
  "DELETED",
  "BLOCKED",
]);

export const profileGenderEnum = pgEnum("profile_gender", ["MALE", "FEMALE"]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

export const interestStatusEnum = pgEnum("interest_status", [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "DISMISSED",
]);

export const warningStatusEnum = pgEnum("warning_status", [
  "ACTIVE",
  "ACKNOWLEDGED",
  "EXPIRED",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "CANCELLED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", ["ISSUED", "PAID", "VOID"]);

// B8: which mechanism verified a payment. AUTO = the provider's own
// verifyPayment() call confirmed success; MANUAL = an admin holding
// `payments.review` confirmed it by hand (see payments.service.ts's
// manualVerifyPayment). Plain text, not an enum — this mirrors the exact
// posture `notifications.failureReason` already established (a small,
// closed, documentary set of values doesn't need a DB-level enum; the
// service layer is the single writer and validates it).


export const ticketStatusEnum = pgEnum("ticket_status", [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "PUSH",
  "IN_APP",
]);

export const actorTypeEnum = pgEnum("actor_type", ["USER", "ADMIN", "SYSTEM"]);

// B7: delivery-status lifecycle for a `notifications` row. PENDING is the
// transient state between "row inserted" and "provider call attempted" —
// in practice every row leaves PENDING within the same request (see
// notifications.service.ts's notify()), but it's kept as a real state
// (not skipped straight to SENT/FAILED) so a crash between insert and
// provider-call is honestly visible rather than silently indistinguishable
// from "never attempted". DELIVERED is reserved for a channel whose
// delivery is unconditionally real the moment the row exists (IN_APP —
// see notify()'s doc comment); SENT means "handed to a provider
// successfully" without a delivery receipt/webhook (no such integration
// exists in this codebase for EMAIL/WHATSAPP/PUSH, matching the OTP
// providers' own honesty posture — see providers/*.provider.ts). FAILED
// always carries a non-secret failureReason.
export const notificationStatusEnum = pgEnum("notification_status", [
  "PENDING",
  "SENT",
  "DELIVERED",
  "FAILED",
]);

// B11: which mobile/web platform a registered push token belongs to. WEB is
// kept alongside ANDROID/IOS (rather than an ANDROID-only enum) since a push
// token is inherently platform-scoped at the vendor level (FCM/APNs/Web
// Push all differ) and a two-value enum would need a migration the moment a
// second platform's app existed — Android is what B11 is asked to make the
// backend ready for, this just doesn't hardcode the door shut for the others.
export const pushPlatformEnum = pgEnum("push_platform", ["ANDROID", "IOS", "WEB"]);

// B6: real behavioural-interaction events, one row per real action, at the
// exact point it happens (never batched/backfilled/fabricated — see
// behaviour-events.service.ts). Named to match notificationChannelEnum's
// existing SCREAMING_SNAKE_CASE convention. Two values are documented
// placeholders that no B6 code path writes yet (kept in the enum so a
// later phase never needs a migration to add them): CHAT_INITIATED
// (chat doesn't exist until B7) and SEARCH_INTERACTION (B4's search is
// frozen — see BACKEND.md's B6 section for the one narrow, disclosed,
// additive change B6 *does* make to search.repository.ts, which is the
// block-exclusion fix, not a behaviour-event write).
export const behaviourEventTypeEnum = pgEnum("behaviour_event_type", [
  "PROFILE_VIEW",
  "LIKE",
  "SHORTLIST",
  "INTEREST_SENT",
  "INTEREST_ACCEPTED",
  "INTEREST_REJECTED",
  "MATCH_CREATED",
  "SEARCH_INTERACTION",
  "CHAT_INITIATED",
]);

// B2: OTP delivery method (the Super Admin-configurable channel) and the
// purposes an OTP can be issued for. Kept separate — a method is *how* an
// OTP is sent, a purpose is *why* — see otpConfigs / otps below.
export const otpMethodEnum = pgEnum("otp_method", ["SMS", "WHATSAPP", "EMAIL"]);

export const otpPurposeEnum = pgEnum("otp_purpose", [
  "SIGNUP",
  "LOGIN",
  "FORGOT_PASSWORD",
  "NEW_DEVICE",
]);

// B3: backend-authoritative profile readiness state. INCOMPLETE = one or
// more required fields (see profiles.service.ts REQUIRED_FIELDS) missing;
// COMPLETE = every required field present but no valid photo yet;
// READY_FOR_VISIBILITY = complete + at least one photo — the only state
// eligible for normal (non-owner) profile visibility. Stored (not only
// computed) so later phases (B4 search, B5 matching) can filter on it
// directly without recomputing per row.
export const profileStatusEnum = pgEnum("profile_status", [
  "INCOMPLETE",
  "COMPLETE",
  "READY_FOR_VISIBILITY",
]);

// ---------------------------------------------------------------------------
// 1. Users, profiles, photos, partner preferences
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    mobileNumber: text("mobile_number").notNull(),
    countryCode: text("country_code").notNull().default("+91"),
    passwordHash: text("password_hash").notNull(),
    status: accountStatusEnum("status").notNull().default("ACTIVE"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
    country: text("country"),
    city: text("city"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    mobileIdx: uniqueIndex("users_mobile_idx").on(t.mobileNumber),
    statusIdx: index("users_status_idx").on(t.status),
  })
);

export const religions = pgTable("religions", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const motherTongues = pgTable("mother_tongues", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educations = pgTable("educations", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const professions = pgTable("professions", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const countries = pgTable("countries", {
  id: id(),
  name: text("name").notNull().unique(),
  isoCode: varchar("iso_code", { length: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cities = pgTable(
  "cities",
  {
    id: id(),
    name: text("name").notNull(),
    countryId: uuid("country_id")
      .notNull()
      .references(() => countries.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    countryIdx: index("cities_country_idx").on(t.countryId),
  })
);

export const maritalStatuses = pgTable("marital_statuses", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communities = pgTable(
  "communities",
  {
    id: id(),
    name: text("name").notNull(),
    religionId: uuid("religion_id").references(() => religions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    religionIdx: index("communities_religion_idx").on(t.religionId),
  })
);

export const profiles = pgTable(
  "profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    gender: profileGenderEnum("gender").notNull(),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: true }).notNull(),
    maritalStatusId: uuid("marital_status_id").references(() => maritalStatuses.id),
    religionId: uuid("religion_id").references(() => religions.id),
    communityId: uuid("community_id").references(() => communities.id),
    motherTongueId: uuid("mother_tongue_id").references(() => motherTongues.id),
    educationId: uuid("education_id").references(() => educations.id),
    professionId: uuid("profession_id").references(() => professions.id),
    incomeRange: text("income_range"),
    // B3: ISO 4217-shaped currency code for incomeRange (e.g. "INR", "USD").
    // Kept as an explicit column rather than folded into incomeRange so a
    // range's currency is never ambiguous — see BACKEND.md "Income".
    incomeCurrency: text("income_currency").default("INR"),
    // B4: structured numeric bounds parallel to the free-text incomeRange
    // above. B3 deliberately kept incomeRange as free text (no confirmed
    // band list existed yet — see BACKEND.md §29), but B4 search/partner
    // preferences need real range comparison at the database level, which
    // a free-text field can't support. These are optional, independently
    // settable via the same PATCH /profiles/me endpoint (see
    // profiles.controller.ts's updateProfileSchema) and never required
    // for profile completion — a profile with only the free-text
    // incomeRange set simply won't match an income search filter. Amounts
    // are whole units of incomeCurrency (e.g. annual, not paise). See
    // BACKEND.md §"B4 income search" for the full rationale.
    incomeMinAmount: integer("income_min_amount"),
    incomeMaxAmount: integer("income_max_amount"),
    heightCm: integer("height_cm"),
    countryId: uuid("country_id").references(() => countries.id),
    cityId: uuid("city_id").references(() => cities.id),
    aboutMe: text("about_me"),
    // B3: secondary/additional selections beyond the single primary FK
    // above, stored as a jsonb array of the same lookup table's uuids
    // (mother_tongues / educations / professions respectively). The
    // primary *Id column remains the single required value used for
    // completion checks and any future search/matching filter; these
    // arrays are optional extras ("multiple selections... where
    // applicable" per the B3 brief) and are not validated against search
    // logic, which stays out of scope for B3.
    motherTongueIds: jsonb("mother_tongue_ids"),
    educationIds: jsonb("education_ids"),
    professionIds: jsonb("profession_ids"),
    // B3: structured, optional, free-shape-within-reason jsonb — see the
    // zod shapes in profiles.controller.ts for what's actually validated.
    // Not part of the required-field/completion set.
    lifestyle: jsonb("lifestyle"),
    familyDetails: jsonb("family_details"),
    profileCompletionPercent: integer("profile_completion_percent").notNull().default(0),
    // B3: which required fields (see profiles.service.ts REQUIRED_FIELDS)
    // are still missing, recomputed and persisted alongside
    // profileCompletionPercent on every write that can affect it. Stored
    // so a caller never has to re-derive it from scratch, and so it's
    // available to future phases without re-running the completion logic.
    missingRequiredFields: jsonb("missing_required_fields"),
    // B3: true once the profile has at least one profile_photos row —
    // kept as a denormalized flag (updated transactionally alongside
    // photo mutations) purely so profileStatus/visibility can be queried
    // without a join, matching profileCompletionPercent's existing
    // "backend precomputes it" pattern.
    hasProfilePhoto: boolean("has_profile_photo").notNull().default(false),
    // B3: backend-authoritative readiness state — see profileStatusEnum's
    // own comment for the state definitions.
    profileStatus: profileStatusEnum("profile_status").notNull().default("INCOMPLETE"),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("UNVERIFIED"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // B3: which admin most recently set verificationStatus — a normal
    // USER can never write this column; only the admin verification
    // endpoint (gated by the existing "profiles.verify" permission) does.
    verifiedByAdminId: uuid("verified_by_admin_id").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    genderIdx: index("profiles_gender_idx").on(t.gender),
    countryIdx: index("profiles_country_idx").on(t.countryId),
    cityIdx: index("profiles_city_idx").on(t.cityId),
    religionIdx: index("profiles_religion_idx").on(t.religionId),
    maritalStatusIdx: index("profiles_marital_status_idx").on(t.maritalStatusId),
    professionIdx: index("profiles_profession_idx").on(t.professionId),
    motherTongueIdx: index("profiles_mother_tongue_idx").on(t.motherTongueId),
    statusIdx: index("profiles_status_idx").on(t.profileStatus),
    // B4: search filter categories with no existing index. dateOfBirth
    // backs age-range search (§20); heightCm backs height search;
    // educationId backs education search (§9) — B3 indexed the other
    // primary-lookup FKs but not this one; incomeCurrency+min+max is a
    // composite covering same-currency income-range overlap queries (§21)
    // — see search.repository.ts.
    dobIdx: index("profiles_dob_idx").on(t.dateOfBirth),
    heightIdx: index("profiles_height_idx").on(t.heightCm),
    educationIdx: index("profiles_education_idx").on(t.educationId),
    incomeIdx: index("profiles_income_idx").on(t.incomeCurrency, t.incomeMinAmount, t.incomeMaxAmount),
  })
);

export const profilePhotos = pgTable(
  "profile_photos",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // B1's original column: a backend-controlled access path (never a raw
    // storage-provider URL — see B3's storage/photo-access-security
    // notes in BACKEND.md), e.g. "/api/v1/profiles/photos/{id}/file".
    url: text("url").notNull(),
    // B3: the storage adapter's own key/path for this file (see
    // src/server/modules/storage). Never returned in any API response —
    // it's an internal detail, not a public asset location.
    storageKey: text("storage_key"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    width: integer("width"),
    height: integer("height"),
    // B3: "COMPLETE" | "PENDING" | "FAILED" — free text (not a DB enum),
    // matching login_attempts.failureReason's precedent of using plain
    // strings for statuses that may grow without a migration. Today's
    // synchronous local-disk upload only ever produces "COMPLETE" or
    // throws; PENDING/FAILED are reserved for a future async pipeline.
    uploadStatus: text("upload_status").notNull().default("COMPLETE"),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    moderation: verificationStatusEnum("moderation").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    profileIdx: index("profile_photos_profile_idx").on(t.profileId),
  })
);

// B4: this table was scaffolded schema-only in B1 (empty, no business
// logic — same foundation pattern as B1's profiles/profile_photos before
// B3 built on them). B4 builds the actual partner-preferences business
// logic on top of it. Two of B1's original columns (`religionIds`,
// `incomeMin`) don't match the confirmed B4 product requirements
// (religion preference is a single selection, not multi; income needs a
// min+max+currency, not a bare min string) — rather than alter or drop
// them (disallowed by the additive-only freeze rules), B4 adds the
// correctly-shaped new columns below and leaves the two mismatched
// original columns unused/superseded. See BACKEND.md's B4 section for
// the full rationale. Every other original column is reused as-is: it
// already matched the confirmed shape (ageMin/Max, heightMinCm/Max,
// maritalStatusIds and communityIds and countryIds and professionIds all
// multi-select, matching §4/§9's semantics exactly).
export const partnerPreferences = pgTable("partner_preferences", {
  id: id(),
  profileId: uuid("profile_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  ageMin: integer("age_min"),
  ageMax: integer("age_max"),
  heightMinCm: integer("height_min_cm"),
  heightMaxCm: integer("height_max_cm"),
  maritalStatusIds: jsonb("marital_status_ids"),
  // B1 original column — superseded by the single-value `religionId`
  // below (B4 §4: "Religion: single selection"). Left in place, unused,
  // per the additive-only freeze rules; never read or written by B4 code.
  religionIds: jsonb("religion_ids"),
  communityIds: jsonb("community_ids"),
  countryIds: jsonb("country_ids"),
  professionIds: jsonb("profession_ids"),
  // B1 original column — superseded by `incomeMinAmount`/`incomeMaxAmount`/
  // `incomeCurrency` below (a bare min with no max or currency can't
  // support B4's range+currency requirements). Left in place, unused.
  incomeMin: text("income_min"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  // --- B4 additions ------------------------------------------------------
  // Preferred partner gender. Nullable: when not set, business logic
  // defaults to the opposite of the owning profile's own gender (see
  // preferences.service.ts) rather than storing that inference — so a
  // profile that later changes its own gender doesn't leave a stale
  // preference behind. Uses the same closed profileGenderEnum as
  // profiles.gender — no arbitrary new gender values, per §4.
  genderPreference: profileGenderEnum("gender_preference"),
  // Single-selection religion preference (§4) — see the note on the
  // legacy religionIds column above.
  religionId: uuid("religion_id").references(() => religions.id),
  motherTongueIds: jsonb("mother_tongue_ids"),
  educationIds: jsonb("education_ids"),
  // Explicit "no profession restriction" flag (§4's ANY_PROFESSION special
  // value), kept as its own typed boolean rather than a sentinel string
  // inside professionIds (which otherwise holds only real profession
  // uuids) — simpler to validate and query. When true, professionIds is
  // expected to be empty/ignored (enforced in preferences.controller.ts).
  professionAny: boolean("profession_any").notNull().default(false),
  cityIds: jsonb("city_ids"),
  incomeMinAmount: integer("income_min_amount"),
  incomeMaxAmount: integer("income_max_amount"),
  incomeCurrency: text("income_currency").default("INR"),
});

// ---------------------------------------------------------------------------
// 2. Likes, interests, matches, shortlists, blocks, reports, warnings
// ---------------------------------------------------------------------------

export const likes = pgTable(
  "likes",
  {
    id: id(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("likes_pair_idx").on(t.fromUserId, t.toUserId),
    fromIdx: index("likes_from_idx").on(t.fromUserId),
    toIdx: index("likes_to_idx").on(t.toUserId),
  })
);

export const interests = pgTable(
  "interests",
  {
    id: id(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: interestStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    pairIdx: uniqueIndex("interests_pair_idx").on(t.fromUserId, t.toUserId),
    fromIdx: index("interests_from_idx").on(t.fromUserId),
    toIdx: index("interests_to_idx").on(t.toUserId),
  })
);

export const matches = pgTable(
  "matches",
  {
    id: id(),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("matches_pair_idx").on(t.userAId, t.userBId),
    aIdx: index("matches_a_idx").on(t.userAId),
    bIdx: index("matches_b_idx").on(t.userBId),
  })
);

export const shortlists = pgTable(
  "shortlists",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("shortlists_pair_idx").on(t.userId, t.targetUserId),
    userIdx: index("shortlists_user_idx").on(t.userId),
  })
);

export const blocks = pgTable(
  "blocks",
  {
    id: id(),
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("blocks_pair_idx").on(t.blockerUserId, t.blockedUserId),
    blockerIdx: index("blocks_blocker_idx").on(t.blockerUserId),
  })
);

export const reportCategories = pgTable("report_categories", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  // B6: additive column — B1 scaffolded this table with no way for an
  // admin to "Disable" a category without deleting it (deleting is
  // unsafe: `reports.category_id` FK-references this table, and history
  // must be preserved). Defaults true so every pre-existing/seeded
  // category stays usable with no backfill needed. See
  // reports.service.ts's category management functions.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Forward-declared below (adminUsers) — reports/warnings/invoice_logs/
// support_messages reference admin_users, so admin_users is defined ahead
// of them in file order (see RBAC section).

// ---------------------------------------------------------------------------
// 9. Admin / RBAC (defined ahead of the tables that reference admin_users)
// ---------------------------------------------------------------------------

export const adminRoles = pgTable("admin_roles", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: id(),
  key: text("key").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: id(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("role_permissions_pair_idx").on(t.roleId, t.permissionId),
  })
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => adminRoles.id),
    status: accountStatusEnum("status").notNull().default("ACTIVE"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("admin_users_status_idx").on(t.status),
  })
);

// ---------------------------------------------------------------------------
// back to reports / warnings, now that admin_users exists
// ---------------------------------------------------------------------------

export const reports = pgTable(
  "reports",
  {
    id: id(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: uuid("reported_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => reportCategories.id),
    status: reportStatusEnum("status").notNull().default("OPEN"),
    description: text("description"),
    resolvedByAdminId: uuid("resolved_by_admin_id").references(() => adminUsers.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reporterIdx: index("reports_reporter_idx").on(t.reporterUserId),
    reportedIdx: index("reports_reported_idx").on(t.reportedUserId),
    statusIdx: index("reports_status_idx").on(t.status),
  })
);

export const warningCategories = pgTable("warning_categories", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const warnings = pgTable(
  "warnings",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => warningCategories.id),
    issuedByAdminId: uuid("issued_by_admin_id").references(() => adminUsers.id),
    status: warningStatusEnum("status").notNull().default("ACTIVE"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("warnings_user_idx").on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// 4. Chat
// ---------------------------------------------------------------------------

export const chats = pgTable(
  "chats",
  {
    id: id(),
    // B7: which real, mutual Match this chat belongs to — B1 scaffolded
    // `chats` with no link back to `matches` at all. The B7 product rule
    // is "a chat is created only from a real Match, at most one chat per
    // match pair" (see chat.service.ts's getOrCreateChatForMatch), and a
    // unique FK column is what makes that idempotent and race-safe at the
    // database level (the same `onConflictDoNothing` + unique-index idiom
    // `likes`/`shortlists`/`blocks`/`matches` already use throughout this
    // codebase — see chat.repository.ts's createChatForMatch), instead of
    // a select-then-insert with a race window. `notNull` because every
    // chat in this design originates from a match; `onDelete: "cascade"`
    // is defensive symmetry with `chat_participants`/`messages` cascading
    // off `chats` (matches are never actually deleted by any code path).
    matchId: uuid("match_id")
      .notNull()
      .unique()
      .references(() => matches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  // B13: same redundant-index finding as `transactions.transactionRef`
  // (see that column's comment for the full reasoning) — `matchId`'s
  // `.unique()` modifier above already creates a unique btree index on
  // this exact column (`chats_match_id_unique`); the separately-declared
  // `index("chats_match_idx")` that used to live here duplicated it
  // exactly. Dropped in drizzle/0010_b13_performance_indexes.sql.
  (t) => ({})
);

export const chatParticipants = pgTable(
  "chat_participants",
  {
    id: id(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("chat_participants_pair_idx").on(t.chatId, t.userId),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => ({
    chatIdx: index("messages_chat_idx").on(t.chatId),
  })
);

// ---------------------------------------------------------------------------
// 5. Membership, payments, invoices
// ---------------------------------------------------------------------------

export const membershipPlans = pgTable("membership_plans", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  priceInPaise: integer("price_in_paise").notNull(),
  durationDays: integer("duration_days").notNull(),
  features: jsonb("features"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // B8: this table originally had no currency column — every price was
  // implicitly INR. B8 seeds one row per (tier x currency) pair instead
  // of redesigning the table (see BACKEND.md's B8 section), so a plan's
  // own currency travels with it rather than being inferred elsewhere.
  // Defaulted to 'INR' so this is a safe additive column against a table
  // that (per every earlier phase's own audit) has always been empty.
  currency: text("currency").notNull().default("INR"),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    // Restrict (the default when no onDelete is given), not cascade —
    // membership/payment history must outlive a hard user delete (see B1
    // §13: soft delete via users.status is the real deletion path; a
    // financial record should never silently vanish with the account).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => membershipPlans.id),
    status: membershipStatusEnum("status").notNull().default("PENDING"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    autoRenew: boolean("auto_renew").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("memberships_user_idx").on(t.userId),
  })
);

export const paymentGateways = pgTable("payment_gateways", {
  id: id(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(false),
  config: jsonb("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable(
  "payments",
  {
    id: id(),
    // Restrict — payments are financial/audit records, retained even if
    // the owning user account is later hard-deleted.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    membershipId: uuid("membership_id").references(() => memberships.id),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => paymentGateways.id),
    amountInPaise: integer("amount_in_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    // B8 id-modeling note (see BACKEND.md's B8 section for the full
    // rationale): the spec asks for three distinctly-retained ids. This
    // column is repurposed as the ORDER/REFERENCE id this backend hands
    // the gateway when creating an order (set once, at checkout) — never
    // the gateway's own transaction id, which is a DIFFERENT value set
    // later, at verify time, on `transactions.gatewayTransactionId`
    // below. The third id (the INTERNAL transaction id) is
    // `transactions.transactionRef`, already frozen/unique. Column name
    // kept as `gateway_reference` (no rename — this is still frozen-
    // shape reuse, not a new column) but its meaning is now precisely
    // "order/reference id", documented here and in payments.repository.ts.
    gatewayReference: text("gateway_reference"),
    // B8: distinct from `status` — see payments.service.ts's verify flow.
    // NULL until a payment is genuinely verified (auto or manual); never
    // set on a client-claimed success alone.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationMethod: text("verification_method"), // "AUTO" | "MANUAL" | null
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("payments_user_idx").on(t.userId),
  })
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    // The INTERNAL transaction id — generated by this backend, unique,
    // never the gateway's own id (see payments.gatewayReference's
    // comment above for the full three-id mapping).
    transactionRef: text("transaction_ref").notNull().unique(),
    amountInPaise: integer("amount_in_paise").notNull(),
    status: paymentStatusEnum("status").notNull(),
    rawResponse: jsonb("raw_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // B8: the GATEWAY's own transaction id, as reported back by
    // verifyPayment() — distinct from both `transactionRef` (internal)
    // and `payments.gatewayReference` (the order/reference id we handed
    // the gateway at creation time). Nullable because it's only known
    // once a verify attempt has actually run.
    gatewayTransactionId: text("gateway_transaction_id"),
  },
  // B13 (Performance/Scalability phase — disclosed, evidenced fix; see
  // PERFORMANCE_REPORT.md / BACKEND.md's B13 section): `transactionRef`'s
  // `.unique()` modifier above already creates a unique btree index on
  // this exact column (confirmed against the real test DB via `\d
  // transactions` — Postgres names it `transactions_transaction_ref_
  // unique`). A second, separately-declared `index("transactions_ref_idx")`
  // on the SAME single column used to live here — genuinely redundant: it
  // covers no query the unique constraint's own index doesn't already
  // serve identically, so it only cost extra write-path index-maintenance
  // work (every insert into this table) for zero read benefit. Dropped in
  // drizzle/0010_b13_performance_indexes.sql; the unique constraint (and
  // its index) is untouched, so every existing lookup-by-transactionRef
  // query plan is byte-identical before/after (regression test:
  // tests/performance-redundant-indexes.test.ts).
  (t) => ({})
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    // Restrict — invoices are financial/audit records, retained even if
    // the owning user account is later hard-deleted.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    invoiceNumber: text("invoice_number").notNull().unique(),
    amountInPaise: integer("amount_in_paise").notNull(),
    status: invoiceStatusEnum("status").notNull().default("ISSUED"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // B8: the full structured invoice content at the moment it was
    // issued (header/billed-to/membership/payment/amount-tax/footer —
    // see invoice-pdf.ts) — so the stored PDF can always be regenerated
    // byte-for-byte identical from stored data, never recomputed from
    // possibly-since-changed live rows (a user's profile, a plan's
    // price, etc. can all change after the fact). Table was always
    // empty before B8, so this is safely added NOT NULL with no default.
    snapshot: jsonb("snapshot").notNull(),
    // B8: the VOID(=CANCELLED, see the invoiceStatusEnum reuse note in
    // this file's enum section) path — set together, once, never cleared.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    // B8: the storage key (via getStorageProvider(), see storage.types.ts)
    // this invoice's generated PDF lives under. Nullable only for the
    // brief instant between row-insert and PDF-generation within the
    // same service call — see invoices.service.ts.
    pdfStorageKey: text("pdf_storage_key"),
  },
  // B13: same redundant-index finding as `transactions.transactionRef`
  // above (see that column's comment for the full reasoning) —
  // `invoiceNumber`'s `.unique()` modifier already creates a unique btree
  // index on this exact column (`invoices_invoice_number_unique`); the
  // separately-declared `index("invoices_number_idx")` that used to live
  // here duplicated it exactly. Dropped in
  // drizzle/0010_b13_performance_indexes.sql.
  (t) => ({})
);

export const invoiceLogs = pgTable("invoice_logs", {
  id: id(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actorAdminId: uuid("actor_admin_id").references(() => adminUsers.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 6. Notifications
// ---------------------------------------------------------------------------

export const notificationTemplates = pgTable("notification_templates", {
  id: id(),
  code: text("code").notNull().unique(),
  channel: notificationChannelEnum("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => notificationTemplates.id),
    channel: notificationChannelEnum("channel").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    // B7: real delivery-status tracking — B1 scaffolded this table with no
    // way to know whether a row was ever actually delivered anywhere (see
    // notificationStatusEnum's own comment for the state definitions).
    // Defaults to PENDING so every pre-existing/future row without an
    // explicit value is honestly "not yet attempted", never silently
    // implied-successful.
    deliveryStatus: notificationStatusEnum("delivery_status").notNull().default("PENDING"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Never holds a secret/credential — only a short, safe-to-display
    // reason (e.g. "not configured"), matching ServiceUnavailableError's
    // own contract (see providers/*.provider.ts).
    failureReason: text("failure_reason"),
    // B7: idempotency key for notify() (notifications.service.ts) —
    // callers that care about "never send this exact event twice" pass a
    // stable key (e.g. "match_created:{matchId}:{userId}"); callers that
    // don't just omit it. Nullable, with a unique index: Postgres unique
    // indexes treat every NULL as distinct, so any number of rows with no
    // dedupeKey coexist freely, while two rows sharing a real key
    // collide and the second is a no-op (`onConflictDoNothing`).
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("notifications_user_idx").on(t.userId),
    dedupeKeyIdx: uniqueIndex("notifications_dedupe_key_idx").on(t.dedupeKey),
  })
);

// ---------------------------------------------------------------------------
// 7. Support
// ---------------------------------------------------------------------------

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    status: ticketStatusEnum("status").notNull().default("OPEN"),
    priority: text("priority"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("support_tickets_user_idx").on(t.userId),
  })
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id").references(() => users.id),
    senderAdminId: uuid("sender_admin_id").references(() => adminUsers.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketIdx: index("support_messages_ticket_idx").on(t.ticketId),
  })
);

// ---------------------------------------------------------------------------
// 8. Ratings & reviews
// ---------------------------------------------------------------------------

export const ratings = pgTable(
  "ratings",
  {
    id: id(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex("ratings_pair_idx").on(t.fromUserId, t.toUserId),
  })
);

export const reviews = pgTable("reviews", {
  id: id(),
  fromUserId: uuid("from_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 10. Audit, sessions, security
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorType: actorTypeEnum("actor_type").notNull(),
    // Deliberately NOT a foreign key: an audit log must remain legible even
    // after the actor account is hard-deleted (see B1 §13), and it may
    // reference either a users.id or an admin_users.id depending on
    // actor_type — a single FK can't target both.
    actorId: uuid("actor_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_logs_actor_idx").on(t.actorId),
    entityIdx: index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  })
);

export const deviceSessions = pgTable(
  "device_sessions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, { onDelete: "cascade" }),
    // The session token is never stored in plaintext — only a SHA-256 hash
    // of it. The raw token is returned to the client once, at login, and
    // never persisted anywhere (see src/server/lib/session.ts).
    tokenHash: text("token_hash").notNull().unique(),
    // B2: client-supplied persistent device identifier (X-Device-Id header),
    // used to tell a known device from a new/unrecognized one at login
    // without browser/OS fingerprinting. Nullable — older sessions (or
    // clients that don't send it) simply have no device-known signal.
    deviceId: text("device_id"),
    deviceInfo: jsonb("device_info"),
    browserInfo: text("browser_info"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("device_sessions_user_idx").on(t.userId),
    adminIdx: index("device_sessions_admin_idx").on(t.adminUserId),
    deviceIdx: index("device_sessions_device_idx").on(t.deviceId),
  })
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id),
    identifier: text("identifier").notNull(),
    success: boolean("success").notNull(),
    // B2: which auth method this attempt used ("PASSWORD" | "OTP"), and why
    // it failed when it did (e.g. "INVALID_PASSWORD", "INVALID_OTP",
    // "ACCOUNT_LOCKED") — both app-level strings, not DB enums, so new
    // reasons can be added without a migration. Never holds the credential
    // itself.
    method: text("method"),
    failureReason: text("failure_reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index("login_attempts_identifier_idx").on(t.identifier),
  })
);

// ---------------------------------------------------------------------------
// 11. Backups / recovery (soft-delete + data retention foundation)
// ---------------------------------------------------------------------------

export const backups = pgTable("backups", {
  id: id(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryLogs = pgTable("recovery_logs", {
  id: id(),
  backupId: uuid("backup_id").references(() => backups.id),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  performedByAdminId: uuid("performed_by_admin_id").references(() => adminUsers.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 12. OTP foundation (B2: Authentication + OTP)
// ---------------------------------------------------------------------------

/**
 * Singleton table holding the platform's ONE active OTP delivery method and
 * its runtime settings. Enforced as a true singleton — `id` is a fixed
 * integer primary key defaulting to 1, and a CHECK constraint (added by hand
 * in the generated migration, see BACKEND.md) pins it to `id = 1` so no
 * second row can ever be inserted. This is the DB-level half of the
 * "exactly one active OTP method at any time" business rule; the
 * application-level half (validating a PATCH before it's written) lives in
 * the B2 admin otp-config service.
 *
 * Provider config columns are intentionally jsonb and intentionally
 * non-secret-holding: API keys/tokens live in environment variables only
 * (see BACKEND.md "OTP providers"), never in this table or any API response
 * — these columns hold only non-secret dials (e.g. a sender ID / from
 * number / template name), so admins can rename them without a deploy.
 */
export const otpConfigs = pgTable("otp_configs", {
  id: integer("id").primaryKey().default(1),
  // Defaults to EMAIL to match the frontend's existing PLATFORM_CONFIG.otpChannel
  // placeholder so a fresh environment's default matches what the approved
  // frontend already assumes.
  activeMethod: otpMethodEnum("active_method").notNull().default("EMAIL"),
  enabled: boolean("enabled").notNull().default(true),
  otpLength: integer("otp_length").notNull().default(6),
  otpExpirySeconds: integer("otp_expiry_seconds").notNull().default(300),
  maxVerifyAttempts: integer("max_verify_attempts").notNull().default(5),
  resendCooldownSeconds: integer("resend_cooldown_seconds").notNull().default(30),
  maxResendAttempts: integer("max_resend_attempts").notNull().default(5),
  resendWindowSeconds: integer("resend_window_seconds").notNull().default(3600),
  // Structurally-gated dev/test convenience: when true (and only ever
  // reachable when NODE_ENV !== "production", enforced in code, not just by
  // this flag), OTPs are generated deterministically and never sent to a
  // real provider. See src/server/otp/providers/dev-provider.ts.
  devMode: boolean("dev_mode").notNull().default(false),
  smsConfig: jsonb("sms_config"),
  whatsappConfig: jsonb("whatsapp_config"),
  emailConfig: jsonb("email_config"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByAdminId: uuid("updated_by_admin_id").references(() => adminUsers.id),
});

/**
 * Generic OTP record covering every B2 purpose (signup, login, forgot
 * password, new-device verification). One table, purpose-isolated by the
 * `purpose` column plus the identifier/purpose index below, rather than a
 * table per flow.
 *
 * `codeHash` is a keyed (HMAC) hash of the OTP code, never the raw code —
 * mirrors device_sessions.tokenHash's "never store the secret" pattern.
 * `metadata` carries purpose-specific draft data that must NOT become
 * permanent (e.g. the pending signup's name/email/mobile before the users
 * row exists) — see BACKEND.md "Signup flow" for exactly what each purpose
 * stores there and why no separate "pending signup" table was introduced.
 * `ticketHash`/`ticketExpiresAt`/`ticketConsumedAt` implement the one-time
 * opaque "verification ticket" issued after a successful verify, which
 * bridges a multi-step flow (e.g. SIGNUP verify-otp -> set-password) without
 * re-sending or re-checking the OTP itself.
 */
export const otps = pgTable(
  "otps",
  {
    id: id(),
    purpose: otpPurposeEnum("purpose").notNull(),
    channel: otpMethodEnum("channel").notNull(),
    // Email or mobile number the OTP was (or would be) sent to — the
    // account may not exist yet (SIGNUP), so this is not always a users.id.
    identifier: text("identifier").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    ticketHash: text("ticket_hash").unique(),
    ticketExpiresAt: timestamp("ticket_expires_at", { withTimezone: true }),
    ticketConsumedAt: timestamp("ticket_consumed_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identifierPurposeIdx: index("otps_identifier_purpose_idx").on(t.identifier, t.purpose),
    // B13: same redundant-index finding as `transactions.transactionRef`
    // (see that column's comment for the full reasoning) —
    // `ticketHash`'s `.unique()` modifier above already creates a unique
    // btree index on this exact column (`otps_ticket_hash_unique`); a
    // separately-declared `index("otps_ticket_hash_idx")` on the same
    // single column duplicated it exactly and was dropped in
    // drizzle/0010_b13_performance_indexes.sql.
  })
);

// ---------------------------------------------------------------------------
// B5 gap-fix: admin-configurable matching category weights.
//
// A DB-level singleton row (`CHECK (id = 1)`, same pattern as
// `otpConfigs` above — one settings row the app can always assume
// exists rather than special-casing a missing row), holding the ten
// category weights `scoring.ts` uses to compute a compatibility score.
// One integer column per category, matching `CATEGORY_WEIGHTS`'s keys
// and DEFAULT values exactly, so a fresh environment's seeded row
// produces byte-identical scoring output to the previously-hardcoded
// constant. `weights.service.ts` is the only thing that validates and
// writes here (total must equal 100, no negative/NaN/unknown category)
// — this table intentionally has no CHECK enforcing the sum, since
// Postgres CHECK constraints can't easily express "these ten columns
// sum to 100" alongside individual-column updates without extra
// complexity; that invariant is enforced in application code before
// every write, exactly as `partner_preferences`'s min<=max range rule
// already is.
// ---------------------------------------------------------------------------
export const matchingWeightConfigs = pgTable("matching_weight_configs", {
  id: integer("id").primaryKey().default(1),
  ageWeight: integer("age_weight").notNull().default(15),
  heightWeight: integer("height_weight").notNull().default(10),
  religionWeight: integer("religion_weight").notNull().default(10),
  communityWeight: integer("community_weight").notNull().default(8),
  motherTongueWeight: integer("mother_tongue_weight").notNull().default(8),
  educationWeight: integer("education_weight").notNull().default(10),
  professionWeight: integer("profession_weight").notNull().default(12),
  maritalStatusWeight: integer("marital_status_weight").notNull().default(8),
  locationWeight: integer("location_weight").notNull().default(7),
  incomeWeight: integer("income_weight").notNull().default(12),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByAdminId: uuid("updated_by_admin_id").references(() => adminUsers.id),
});

// ---------------------------------------------------------------------------
// B6: Social / Interaction System — behaviour-event log + suspension-cycle
// tracking. `likes`, `interests`, `matches`, `shortlists`, `blocks`,
// `reportCategories`, `reports`, `warningCategories`, `warnings` above were
// all B1 schema-only foundation (see their own comments) — B6 is the phase
// that builds real business logic on top of every one of them. These two
// tables are the only genuinely NEW tables B6 needs; every other table it
// uses already existed.
// ---------------------------------------------------------------------------

/**
 * Append-only log of real interaction events, written at the exact point
 * each one happens (inside the same service call as the action itself —
 * never a batch job, never backfilled, never fabricated for a candidate
 * with no real activity). This is what B5's `BehaviourSignalProvider`
 * (see recommendations/real-behaviour-signal-provider.ts) reads to turn
 * B5's previously-inert behaviour seam into a real signal source, and what
 * a future phase could use for analytics/activity feeds. `targetUserId` is
 * nullable because not every event has a counterpart (none currently
 * don't, but the column is honestly nullable rather than requiring a
 * placeholder self-reference for a hypothetical future actor-only event).
 * `metadata` is deliberately minimal/non-sensitive — never a message body,
 * never raw preference values (see each write site for exactly what it
 * stores).
 */
export const behaviourEvents = pgTable(
  "behaviour_events",
  {
    id: id(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "cascade" }),
    eventType: behaviourEventTypeEnum("event_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // B5's real provider queries "this actor's recent events about this
    // candidate" and (symmetrically) "events this user was the target
    // of" — both by recency, so both get a composite (userId, createdAt)
    // index rather than a plain FK index.
    actorCreatedIdx: index("behaviour_events_actor_created_idx").on(t.actorUserId, t.createdAt),
    targetCreatedIdx: index("behaviour_events_target_created_idx").on(t.targetUserId, t.createdAt),
  })
);

/**
 * One row per suspend/lift CYCLE for a reported user's account — not a
 * duplicate of `users.status` (which remains the single source of truth
 * for "is this account currently suspended"), but the audit trail that
 * makes the report-threshold rule correct over time: "after a suspension
 * is lifted, previously-counted reports must not count again toward a
 * future 5-unique-reporter threshold" (see reports.service.ts's
 * `countUniqueReportersSince`). Computing the threshold only counts
 * `reports` rows created after the most recent `liftedAt` for that user
 * (or all-time if `liftedAt` is null / no row exists yet) — this is the
 * whole reason this table exists instead of adding a column to the
 * frozen `reports` table, which the additive-only freeze rules would
 * have allowed but which would have been a needless frozen-file touch
 * when a new, independent table does the same job.
 */
export const accountSuspensions = pgTable(
  "account_suspensions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }).notNull().defaultNow(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedByAdminId: uuid("lifted_by_admin_id").references(() => adminUsers.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("account_suspensions_user_idx").on(t.userId),
    // B10: closes a genuine race in reports.service.ts's maybeAutoSuspend
    // — two report submissions arriving near-simultaneously could both
    // observe "no active suspension yet" and both insert one, leaving a
    // user with two concurrently-active suspension rows (an integrity
    // hole, not just a display glitch: liftSuspension only looks up ONE
    // active row, so the account could be left permanently unable to be
    // un-suspended cleanly). A partial unique index — "at most one
    // (userId) row where liftedAt IS NULL" — makes "exactly one active
    // suspension per user, ever" a DB-level guarantee, not just an
    // application-level check-then-act. reports.repository.ts's
    // createSuspension uses this as its onConflictDoNothing arbiter.
    activeSuspensionIdx: uniqueIndex("account_suspensions_active_user_idx")
      .on(t.userId)
      .where(sql`${t.liftedAt} IS NULL`),
  })
);

// ---------------------------------------------------------------------------
// B11: Android Backend Integration / Mobile API Readiness — push-notification
// device-token addressing. Genuinely new: push.provider.ts's own doc comment
// (B7) explicitly named "this schema has no device-push-token store anywhere
// yet" as an out-of-scope gap for a future phase. This table is that store —
// completing the PUSH channel's *addressing* (where to send), never its
// delivery (no real vendor/FCM/APNs SDK is wired in; see push.provider.ts,
// unchanged).
//
// Deliberately its own table, not a column bolted onto `device_sessions`:
// `device_sessions` is authentication session state (one row per login,
// expires, gets revoked on logout) while this is push-delivery addressing
// (one row per device+app-install's push token, independent of whether any
// session is currently active on that device — a token should keep
// receiving pushes across re-logins on the same device, and a user may be
// logged out everywhere yet still "have a device registered" for push).
// Conflating the two would mean a logout (or session expiry) silently
// deleting a still-valid push address, which is not what either concept
// means. Mirrors device_sessions' own naming/index conventions (index on
// userId, unique constraint on the secret/address column, a nullable
// revokedAt) without sharing its table.
// ---------------------------------------------------------------------------

/**
 * One row per registered device push token. `token` is unique across the
 * whole table (not scoped per-user) because a push token is inherently
 * unique per device+app-install at the vendor level — see
 * `push-tokens.repository.ts`'s `upsertToken` for what happens on a genuine
 * re-registration (refresh, or the same physical device reused under a
 * different account after a logout/login). `revokedAt` marks a token
 * invalidated (explicit client logout/removal, or — for a real future vendor
 * integration — a provider-reported "token no longer valid" response); a
 * revoked token is excluded from `notify()`'s PUSH addressing lookup but the
 * row itself is kept (audit trail), never deleted.
 */
export const devicePushTokens = pgTable(
  "device_push_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: pushPlatformEnum("platform").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("device_push_tokens_user_idx").on(t.userId),
  })
);
