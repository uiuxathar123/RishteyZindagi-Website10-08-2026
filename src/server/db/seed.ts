/**
 * Seeds system/reference data (B1 §15): the two admin roles, a starter
 * permission set, and role→permission grants. This is safe to run more
 * than once — every insert is an upsert keyed on the natural unique
 * column (role name / permission key), so re-running never duplicates
 * rows or wipes data.
 *
 * The optional dev-only Super Admin account is created ONLY when both
 * NODE_ENV=development and SEED_DEV_SUPER_ADMIN=true — never in
 * staging/production, and never with a password baked into source code:
 * it's read from SEED_DEV_SUPER_ADMIN_PASSWORD in the environment, and
 * the seed refuses to run if that's unset while the flag is on.
 *
 * Usage: npm run db:seed
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
// Relative import, not the "@/" alias: this file runs standalone via
// `tsx` (see package.json's db:seed script), which doesn't resolve
// tsconfig's path aliases the way Next.js's bundler does.
import { hashPassword } from "../lib/password";
import { COMMUNITY_DATA } from "./reference-data/communities";

const ADMIN_ROLES = [
  { name: "SUPER_ADMIN", description: "Full platform control, including staff permission management." },
  { name: "STAFF_ADMIN", description: "Limited operational access, scoped by Super Admin-granted permissions." },
];

// A starter permission set — enough to prove role_permissions works
// end-to-end and to gate the B1 admin-ping demo route. B2+ will grow
// this list as each admin feature ships; it is not meant to be
// exhaustive yet.
const PERMISSIONS = [
  { key: "admin.ping", description: "Reach the RBAC foundation demo endpoint." },
  { key: "users.view", description: "View member accounts." },
  { key: "users.suspend", description: "Suspend or reinstate member accounts." },
  { key: "profiles.verify", description: "Approve or reject profile verification." },
  { key: "reports.resolve", description: "Resolve or dismiss user reports." },
  { key: "staff.manage", description: "Invite, role-change or disable staff/admin accounts." },
  // PCP: banning is a stronger action than suspending, so it is its own
  // permission (SUPER_ADMIN only by default; never in STAFF_ADMIN defaults).
  { key: "users.ban", description: "Ban (block) or unban member accounts." },
  { key: "platform.settings.manage", description: "Change platform-wide settings (gateway, OTP channel, flags)." },
  // B6: no existing permission fit issuing a warning or managing report
  // categories, so these two are new and narrowly scoped — see
  // BACKEND.md's B6 section for why. Both are SUPER_ADMIN-only by
  // default (not added to STAFF_ADMIN_DEFAULT_PERMISSIONS below).
  { key: "warnings.issue", description: "Issue a warning to a member account and view any member's warning history." },
  { key: "reports.categories.manage", description: "Add, edit, or disable report categories." },
  // B8: manual pending-payment verification/activation and invoice
  // cancel/regenerate — a distinct, narrowly-scoped capability from
  // `platform.settings.manage` (which B8 reuses unchanged for gateway
  // configuration; see BACKEND.md's B8 section). SUPER_ADMIN-only by
  // default, same pattern as the two B6 permissions above.
  { key: "payments.review", description: "Manually verify/activate a pending payment, and cancel or regenerate invoices." },
  // B9: audit-log visibility is its own, narrowly-scoped permission — not
  // added to STAFF_ADMIN_DEFAULT_PERMISSIONS below. Neither `staff.manage`
  // (about managing staff accounts, not viewing activity logs) nor
  // `users.view` (about member accounts, not platform-wide admin
  // activity) fits: audit logs can reveal every admin's activity across
  // the whole platform, a materially broader blast radius than either
  // existing permission implies. SUPER_ADMIN-only by default, per the
  // master brief's "do not grant STAFF_ADMIN broad access simply for
  // convenience" instruction — see BACKEND.md's B9 section.
  { key: "audit.view", description: "View platform-wide admin audit logs." },
  { key: "groups.manage", description: "Create and edit community groups, hide posts, and remove members from groups." },
];

// SUPER_ADMIN gets every permission; STAFF_ADMIN gets a deliberately
// smaller default set — Super Admin can grant more later via
// role_permissions, matching the brief's "no arbitrary unlimited admin
// privileges" instruction.
const STAFF_ADMIN_DEFAULT_PERMISSIONS = ["admin.ping", "users.view", "profiles.verify", "reports.resolve"];

// ---------------------------------------------------------------------------
// B3: profile reference/lookup data. These are closed, controlled lists
// (unlike cities/communities, which are populated on demand — see
// src/server/modules/profiles/reference.repository.ts's findOrCreate*
// helpers) because they're used as required, single-value profile fields
// and are natural future search/matching filters, so consistency matters
// more than open-ended growth. Idempotent: every insert is an upsert
// keyed on the unique `name` column, safe to re-run.
// ---------------------------------------------------------------------------

const RELIGIONS = [
  "Hindu",
  "Muslim",
  "Christian",
  "Sikh",
  "Jain",
  "Buddhist",
  "Parsi",
  "Jewish",
  "No Religion",
  "Other",
];

const MOTHER_TONGUES = [
  "Hindi",
  "English",
  "Bengali",
  "Telugu",
  "Marathi",
  "Tamil",
  "Urdu",
  "Gujarati",
  "Kannada",
  "Odia",
  "Malayalam",
  "Punjabi",
  "Assamese",
  "Maithili",
  "Sanskrit",
  "Kashmiri",
  "Konkani",
  "Sindhi",
  "Nepali",
  "Manipuri",
  "Bhojpuri",
  "Rajasthani",
  "Arabic",
  "French",
  "Spanish",
  "Mandarin",
  "Other",
];

const EDUCATIONS = [
  "High School",
  "Diploma",
  "Bachelor's — Arts",
  "Bachelor's — Science",
  "Bachelor's — Commerce",
  "Bachelor's — Engineering",
  "Bachelor's — Medicine (MBBS)",
  "Bachelor's — Law",
  "Master's — Arts",
  "Master's — Science",
  "Master's — Commerce",
  "Master's — Engineering",
  "MBA",
  "Doctorate (PhD)",
  "CA / CS / CMA",
  "Diploma — Medical",
  "Other Professional Degree",
  "Other",
];

const PROFESSIONS = [
  "Software Engineer",
  "Doctor",
  "Nurse",
  "Teacher / Professor",
  "Chartered Accountant",
  "Lawyer",
  "Government Employee",
  "Business Owner / Entrepreneur",
  "Banking Professional",
  "Consultant",
  "Marketing Professional",
  "Sales Professional",
  "Civil Engineer",
  "Mechanical Engineer",
  "Architect",
  "Pharmacist",
  "Designer",
  "Data Scientist / Analyst",
  "Human Resources Professional",
  "Defence / Armed Forces",
  "Civil Servant (IAS/IPS/etc.)",
  "Artist / Performer",
  "Farmer",
  "Homemaker",
  "Student",
  "Not Working",
  "Self-Employed",
  "Other",
];

const MARITAL_STATUSES = [
  "Never Married",
  "Divorced",
  "Widowed",
  "Awaiting Divorce",
  "Annulled",
];

// Deliberately not exhaustive — every real-world country, so profile
// onboarding is never blocked on a country the seed forgot. ISO 3166-1
// alpha-2 codes.
const COUNTRIES: Array<{ name: string; isoCode: string }> = [
  { name: "India", isoCode: "IN" },
  { name: "United States", isoCode: "US" },
  { name: "United Kingdom", isoCode: "GB" },
  { name: "Canada", isoCode: "CA" },
  { name: "Australia", isoCode: "AU" },
  { name: "United Arab Emirates", isoCode: "AE" },
  { name: "Saudi Arabia", isoCode: "SA" },
  { name: "Qatar", isoCode: "QA" },
  { name: "Kuwait", isoCode: "KW" },
  { name: "Oman", isoCode: "OM" },
  { name: "Bahrain", isoCode: "BH" },
  { name: "Singapore", isoCode: "SG" },
  { name: "Malaysia", isoCode: "MY" },
  { name: "Germany", isoCode: "DE" },
  { name: "France", isoCode: "FR" },
  { name: "Netherlands", isoCode: "NL" },
  { name: "Ireland", isoCode: "IE" },
  { name: "New Zealand", isoCode: "NZ" },
  { name: "South Africa", isoCode: "ZA" },
  { name: "Nepal", isoCode: "NP" },
  { name: "Sri Lanka", isoCode: "LK" },
  { name: "Bangladesh", isoCode: "BD" },
  { name: "Pakistan", isoCode: "PK" },
  { name: "Japan", isoCode: "JP" },
  { name: "China", isoCode: "CN" },
  { name: "Other", isoCode: "XX" },
];

// A starter set of major cities per country, purely a convenience so the
// reference-options endpoint isn't empty on a fresh install — NOT meant
// to be exhaustive. Any city not listed here is created on first use by
// findOrCreateCity() (see reference.repository.ts), scoped to its
// country, so onboarding is never blocked by a missing city.
const CITIES_BY_COUNTRY: Record<string, string[]> = {
  India: [
    "Mumbai",
    "Delhi",
    "Bengaluru",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Pune",
    "Ahmedabad",
    "Jaipur",
    "Surat",
    "Lucknow",
    "Kanpur",
    "Nagpur",
    "Indore",
    "Thane",
    "Navi Mumbai",
    "Bhopal",
    "Patna",
    "Chandigarh",
    "Kochi",
  ],
  "United States": ["New York", "San Francisco", "Los Angeles", "Chicago", "Houston", "Seattle", "Dallas"],
  "United Kingdom": ["London", "Manchester", "Birmingham", "Leeds", "Edinburgh"],
  Canada: ["Toronto", "Vancouver", "Montreal", "Calgary"],
  Australia: ["Sydney", "Melbourne", "Brisbane", "Perth"],
  "United Arab Emirates": ["Dubai", "Abu Dhabi", "Sharjah"],
  "Saudi Arabia": ["Riyadh", "Jeddah", "Dammam"],
};

// ---------------------------------------------------------------------------
// B6: system-predefined report categories and warning categories. Both
// lists are idempotent (upserted by unique `name`), same pattern as
// RELIGIONS/EDUCATIONS/etc. above. Report categories are never
// hard-deleted (see schema.ts's reportCategories.isActive comment) — an
// admin "removes" one by disabling it via reports.service.ts, which this
// seed's re-run never overrides (only `description` is refreshed on
// conflict, `isActive` is left alone so a disabled category stays
// disabled across reseeds).
// ---------------------------------------------------------------------------

const REPORT_CATEGORIES = [
  { name: "Fake Profile", description: "The profile appears to be fake, impersonated, or not a real person." },
  { name: "Inappropriate Content", description: "Photos, text, or other content that violates platform guidelines." },
  { name: "Harassment", description: "Abusive, threatening, or unwanted repeated contact." },
  { name: "Spam/Scam", description: "Solicitation, financial scam, or spam messaging." },
  { name: "Underage", description: "The profile appears to belong to someone under the platform's minimum age." },
  { name: "Other", description: "Any other concern not covered by the categories above." },
];

const WARNING_CATEGORIES = [
  { name: "Inappropriate Messages", description: "Messaging conduct that violates platform guidelines." },
  { name: "Fake Information", description: "Profile information found to be false or misleading." },
  { name: "Policy Violation", description: "A general violation of platform policies or terms of use." },
  { name: "Other", description: "Any other reason not covered by the categories above." },
];

// ---------------------------------------------------------------------------
// B8: payment gateways + membership plans. Idempotent (upserted by unique
// `name`/`code`), same pattern as every other reference/seed list above.
// ---------------------------------------------------------------------------

// Exactly the five gateways the master brief names. Razorpay is the
// documented default active gateway (it's listed first in the brief and
// is the most widely-integrated gateway for Indian matrimonial/SaaS
// products) — every other row starts inactive; exactly one is ever
// active at a time (enforced in gateways.service.ts, not here — this
// seed only sets the STARTING state, an admin can change it afterward).
const PAYMENT_GATEWAYS = [
  { name: "Razorpay", isActive: true },
  { name: "Cashfree Payments", isActive: false },
  { name: "PayU", isActive: false },
  { name: "PhonePe Payment Gateway", isActive: false },
  { name: "Paytm Payment Gateway", isActive: false },
];

// Four tiers x two currencies = eight rows. PRICES ARE PLACEHOLDERS —
// no real business/pricing input was given for this project; these are
// clearly-round, documented placeholder numbers chosen only to exercise
// the checkout/payment/invoice pipeline end to end, never presented as
// researched real-world pricing (see BACKEND.md's B8 section for the
// explicit disclosure). `durationDays` for "3 months"/"6 months" are
// fixed day-counts (90/180), not calendar-month arithmetic — see
// plan-tiers.ts's own doc comment for why.
//
// `features` is informational/marketing metadata ONLY (see §5 of the B8
// brief, documented again in membership-plans.service.ts) — only
// `visibilityBoost` is a real, separately-enforced mechanism
// (visibility-boost.ts); `unlimitedInterests`/`advancedSearch`/
// `shortlist` are never metered or gated anywhere in this phase.
const MEMBERSHIP_PLANS = [
  {
    code: "PLAN_7DAY_INR",
    name: "7-Day Pass",
    currency: "INR",
    durationDays: 7,
    priceInPaise: 19900, // Rs. 199 — placeholder
    features: { chat: true },
  },
  {
    code: "PLAN_7DAY_USD",
    name: "7-Day Pass",
    currency: "USD",
    durationDays: 7,
    priceInPaise: 499, // $4.99 — placeholder
    features: { chat: true },
  },
  {
    code: "PLAN_MONTHLY_INR",
    name: "Monthly",
    currency: "INR",
    durationDays: 30,
    priceInPaise: 99900, // Rs. 999 — placeholder
    features: { chat: true, unlimitedInterests: true },
  },
  {
    code: "PLAN_MONTHLY_USD",
    name: "Monthly",
    currency: "USD",
    durationDays: 30,
    priceInPaise: 1999, // $19.99 — placeholder
    features: { chat: true, unlimitedInterests: true },
  },
  {
    code: "PLAN_3MONTH_INR",
    name: "3-Month",
    currency: "INR",
    durationDays: 90,
    priceInPaise: 249900, // Rs. 2,499 — placeholder
    features: { chat: true, unlimitedInterests: true, shortlist: true, advancedSearch: true },
  },
  {
    code: "PLAN_3MONTH_USD",
    name: "3-Month",
    currency: "USD",
    durationDays: 90,
    priceInPaise: 4999, // $49.99 — placeholder
    features: { chat: true, unlimitedInterests: true, shortlist: true, advancedSearch: true },
  },
  {
    code: "PLAN_6MONTH_INR",
    name: "6-Month",
    currency: "INR",
    durationDays: 180,
    priceInPaise: 449900, // Rs. 4,499 — placeholder
    features: { chat: true, unlimitedInterests: true, shortlist: true, advancedSearch: true, visibilityBoost: true },
  },
  {
    code: "PLAN_6MONTH_USD",
    name: "6-Month",
    currency: "USD",
    durationDays: 180,
    priceInPaise: 8999, // $89.99 — placeholder
    features: { chat: true, unlimitedInterests: true, shortlist: true, advancedSearch: true, visibilityBoost: true },
  },
];

async function seedPaymentAndMembershipReferenceData(db: NodePgDatabase<typeof schema>) {
  console.log("Seeding payment gateways and membership plans...");

  for (const gateway of PAYMENT_GATEWAYS) {
    await db
      .insert(schema.paymentGateways)
      .values({ name: gateway.name, isActive: gateway.isActive })
      // isActive is intentionally NOT in the update set — a re-run of
      // this seed must never silently flip an admin's later gateway
      // choice back to the seed default (same "don't override live
      // admin state on reseed" precedent report_categories.isActive
      // already established).
      .onConflictDoUpdate({ target: schema.paymentGateways.name, set: { name: gateway.name } });
  }

  for (const plan of MEMBERSHIP_PLANS) {
    await db
      .insert(schema.membershipPlans)
      .values(plan)
      .onConflictDoUpdate({
        target: schema.membershipPlans.code,
        set: { name: plan.name, currency: plan.currency, durationDays: plan.durationDays, priceInPaise: plan.priceInPaise, features: plan.features },
      });
  }
}

async function seedModerationReferenceData(db: NodePgDatabase<typeof schema>) {
  console.log("Seeding report categories and warning categories...");

  for (const category of REPORT_CATEGORIES) {
    await db
      .insert(schema.reportCategories)
      .values(category)
      .onConflictDoUpdate({ target: schema.reportCategories.name, set: { description: category.description } });
  }
  for (const category of WARNING_CATEGORIES) {
    await db
      .insert(schema.warningCategories)
      .values(category)
      .onConflictDoUpdate({ target: schema.warningCategories.name, set: { description: category.description } });
  }
}

async function seedProfileReferenceData(db: NodePgDatabase<typeof schema>) {
  console.log("Seeding profile reference data (religions, mother tongues, educations, professions, countries, cities, marital statuses)...");

  for (const name of RELIGIONS) {
    await db.insert(schema.religions).values({ name }).onConflictDoNothing({ target: schema.religions.name });
  }
  for (const name of MOTHER_TONGUES) {
    await db.insert(schema.motherTongues).values({ name }).onConflictDoNothing({ target: schema.motherTongues.name });
  }
  for (const name of EDUCATIONS) {
    await db.insert(schema.educations).values({ name }).onConflictDoNothing({ target: schema.educations.name });
  }
  for (const name of PROFESSIONS) {
    await db.insert(schema.professions).values({ name }).onConflictDoNothing({ target: schema.professions.name });
  }
  for (const name of MARITAL_STATUSES) {
    await db.insert(schema.maritalStatuses).values({ name }).onConflictDoNothing({ target: schema.maritalStatuses.name });
  }
  for (const country of COUNTRIES) {
    await db
      .insert(schema.countries)
      .values(country)
      .onConflictDoNothing({ target: schema.countries.name });
  }

  const countryRows = await db.select().from(schema.countries);
  const countryIdByName = new Map(countryRows.map((c) => [c.name, c.id]));
  for (const [countryName, cityNames] of Object.entries(CITIES_BY_COUNTRY)) {
    const countryId = countryIdByName.get(countryName);
    if (!countryId) continue;
    for (const cityName of cityNames) {
      const existing = await db
        .select()
        .from(schema.cities)
        .where(and(eq(schema.cities.name, cityName), eq(schema.cities.countryId, countryId)));
      if (existing.length === 0) {
        await db.insert(schema.cities).values({ name: cityName, countryId });
      }
    }
  }

  await seedCommunities(db);
}

/**
 * B16: community / caste reference data. B3 left `communities` empty and
 * unreachable (its findOrCreate path is not exposed by any API route), so
 * community — a profile field, a partner-preference filter, a search
 * filter and an 8-point matching weight — could never actually be used.
 * The product's reviewed community/caste dataset already exists in
 * `src/data/communityData.ts` (see its header for provenance); this seeds
 * it into the real lookup table, scoped to each religion.
 *
 * Stored as one flat row per group named `"<sect> › <group>"` so the
 * existing table (name + religion_id) is enough — no schema change. A
 * client regroups by the text before " › " to show the sect tier. Fully
 * idempotent: a (religion, name) pair that already exists is left alone,
 * so re-running the seed never duplicates or overwrites anything.
 */
async function seedCommunities(db: NodePgDatabase<typeof schema>) {
  console.log("Seeding communities / castes...");
  const religionRows = await db.select().from(schema.religions);
  const religionIdByName = new Map(religionRows.map((r) => [r.name, r.id]));

  for (const religion of COMMUNITY_DATA) {
    const religionId = religionIdByName.get(religion.religion);
    if (!religionId) continue;
    for (const sect of religion.sects) {
      for (const group of sect.groups) {
        const name = `${sect.sect} › ${group.name}`;
        const existing = await db
          .select({ id: schema.communities.id })
          .from(schema.communities)
          .where(and(eq(schema.communities.name, name), eq(schema.communities.religionId, religionId)));
        if (existing.length === 0) {
          await db.insert(schema.communities).values({ name, religionId });
        }
      }
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  console.log("Seeding admin roles...");
  for (const role of ADMIN_ROLES) {
    await db
      .insert(schema.adminRoles)
      .values(role)
      .onConflictDoUpdate({ target: schema.adminRoles.name, set: { description: role.description } });
  }

  console.log("Seeding permissions...");
  for (const perm of PERMISSIONS) {
    await db
      .insert(schema.permissions)
      .values(perm)
      .onConflictDoUpdate({ target: schema.permissions.key, set: { description: perm.description } });
  }

  const [superAdminRole] = await db
    .select()
    .from(schema.adminRoles)
    .where(eq(schema.adminRoles.name, "SUPER_ADMIN"));
  const [staffAdminRole] = await db
    .select()
    .from(schema.adminRoles)
    .where(eq(schema.adminRoles.name, "STAFF_ADMIN"));
  const allPermissions = await db.select().from(schema.permissions);

  console.log("Granting permissions to roles...");
  for (const perm of allPermissions) {
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: superAdminRole.id, permissionId: perm.id })
      .onConflictDoNothing();

    if (STAFF_ADMIN_DEFAULT_PERMISSIONS.includes(perm.key)) {
      await db
        .insert(schema.rolePermissions)
        .values({ roleId: staffAdminRole.id, permissionId: perm.id })
        .onConflictDoNothing();
    }
  }

  if (process.env.NODE_ENV === "development" && process.env.SEED_DEV_SUPER_ADMIN === "true") {
    const email = process.env.SEED_DEV_SUPER_ADMIN_EMAIL;
    const password = process.env.SEED_DEV_SUPER_ADMIN_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "SEED_DEV_SUPER_ADMIN is true but SEED_DEV_SUPER_ADMIN_EMAIL/PASSWORD are not set — refusing to seed a passwordless admin."
      );
    }
    const [existing] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, email));
    if (!existing) {
      console.log(`Seeding dev-only Super Admin account (${email})...`);
      await db.insert(schema.adminUsers).values({
        name: "Dev Super Admin",
        email,
        passwordHash: await hashPassword(password),
        roleId: superAdminRole.id,
      });
    } else {
      console.log("Dev Super Admin already exists, skipping.");
    }
  } else {
    console.log("Skipping dev Super Admin seed (not in development, or SEED_DEV_SUPER_ADMIN is not true).");
  }

  await seedProfileReferenceData(db);
  await seedModerationReferenceData(db);
  await seedPaymentAndMembershipReferenceData(db);

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
