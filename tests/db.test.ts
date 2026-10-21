import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

describe("database", () => {
  it("connects to Postgres", async () => {
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
  });

  it("has every migration applied — all 48 B1+B2 tables exist, plus B5 gap-fix's additive matching_weight_configs, B6's additive behaviour_events/account_suspensions, B11's additive device_push_tokens, and PCP's five additive production tables (57 total), then B18's additive platform_settings (58 total), then B19's eight additive tables (66 total)", async () => {
    const result = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    const tableNames = result.rows.map((r) => (r as { table_name: string }).table_name);

    const expected = [
      "users",
      "profiles",
      "profile_photos",
      "partner_preferences",
      "religions",
      "mother_tongues",
      "educations",
      "professions",
      "countries",
      "cities",
      "marital_statuses",
      "communities",
      "likes",
      "interests",
      "matches",
      "shortlists",
      "blocks",
      "reports",
      "report_categories",
      "warnings",
      "warning_categories",
      "chats",
      "chat_participants",
      "messages",
      "membership_plans",
      "memberships",
      "payment_gateways",
      "payments",
      "transactions",
      "invoices",
      "invoice_logs",
      "notifications",
      "notification_templates",
      "support_tickets",
      "support_messages",
      "ratings",
      "reviews",
      "admin_users",
      "admin_roles",
      "permissions",
      "role_permissions",
      "audit_logs",
      "device_sessions",
      "login_attempts",
      "backups",
      "recovery_logs",
      "otp_configs",
      "otps",
      // B5 gap-fix (required, additive dependency — see BACKEND.md §48
      // and the B5 gap-fix implementation report): a new, genuinely
      // necessary table for admin-configurable matching weights,
      // following the exact otp_configs singleton pattern. Every one of
      // the original 48 B1+B2 table-name assertions above is unchanged
      // — this only adds one new, correct, positive assertion and
      // updates the exact-count check to match.
      "matching_weight_configs",
      // B6 (required, additive dependency — same coincidental-count
      // situation as matching_weight_configs above, disclosed in
      // BACKEND.md's B6 section): two new, genuinely necessary tables —
      // the real behavioural-event log B5's provider now reads, and the
      // suspension-cycle tracker the report-threshold rule needs so a
      // lifted suspension's reports don't count twice. Every prior
      // assertion in this list is unchanged.
      "behaviour_events",
      "account_suspensions",
      // B11 (required, additive dependency — disclosed in BACKEND.md §55):
      // one new, genuinely necessary table — the push-notification
      // device-token store push.provider.ts's own B7 doc comment named as
      // a future-phase gap. Every prior assertion in this list is
      // unchanged.
      "device_push_tokens",
      // PCP (Production Completion Phase — owner-approved update of this
      // exact-count list, same precedent as B5/B6/B11; see
      // PRODUCTION_COMPLETION_AUDIT.md conflict C7): five additive tables
      // from drizzle/0011_pcp_production_completion.sql.
      "payment_webhook_events",
      "payment_refunds",
      "account_bans",
      "job_runs",
      "rate_limit_counters",
      "platform_settings",
      // B19 (owner-approved additive tables; drizzle/0015–0018): contact form inbox, success stories, weekly-digest log,
      // community groups (groups, members, posts, post reports) and renewal follow-up cycles — 66 in total.
      "contact_messages",
      "success_stories",
      "digest_log",
      "community_groups",
      "community_group_members",
      "community_group_posts",
      "community_post_reports",
      "renewal_cycles",
      // Personal Matchmaking (owner-approved additive tables; drizzle/0019): cases, suggestions and case history; and
      // drizzle/0020: Super Admin introductions; drizzle/0021: invitations — 71 in total.
      "matchmaking_cases",
      "matchmaking_suggestions",
      "matchmaking_case_events",
      "matchmaking_introductions",
      "matchmaking_invitations",
    ];

    for (const table of expected) {
      expect(tableNames, `expected table "${table}" to exist`).toContain(table);
    }
    expect(tableNames.length).toBe(expected.length);
  });

  it("has admin roles and permissions seeded", async () => {
    const roles = await db.execute(sql`select name from admin_roles order by name`);
    expect(roles.rows.map((r) => (r as { name: string }).name)).toEqual(["STAFF_ADMIN", "SUPER_ADMIN"]);

    const permCount = await db.execute(sql`select count(*)::int as count from permissions`);
    expect((permCount.rows[0] as { count: number }).count).toBeGreaterThan(0);
  });
});
