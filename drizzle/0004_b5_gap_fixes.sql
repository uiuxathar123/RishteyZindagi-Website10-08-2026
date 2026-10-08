CREATE TABLE "matching_weight_configs" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"age_weight" integer DEFAULT 15 NOT NULL,
	"height_weight" integer DEFAULT 10 NOT NULL,
	"religion_weight" integer DEFAULT 10 NOT NULL,
	"community_weight" integer DEFAULT 8 NOT NULL,
	"mother_tongue_weight" integer DEFAULT 8 NOT NULL,
	"education_weight" integer DEFAULT 10 NOT NULL,
	"profession_weight" integer DEFAULT 12 NOT NULL,
	"marital_status_weight" integer DEFAULT 8 NOT NULL,
	"location_weight" integer DEFAULT 7 NOT NULL,
	"income_weight" integer DEFAULT 12 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
ALTER TABLE "matching_weight_configs" ADD CONSTRAINT "matching_weight_configs_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Singleton enforcement: matching_weight_configs may only ever hold the
-- row id=1 — the same DB-level pattern otp_configs already uses (see
-- 0001_b2_auth_otp.sql), so "exactly one active weight configuration at
-- any time" is guaranteed independent of any application-level check.
ALTER TABLE "matching_weight_configs" ADD CONSTRAINT "matching_weight_configs_singleton_check" CHECK ("id" = 1);--> statement-breakpoint
-- Seed the single weight-configuration row so the app can always assume
-- it exists rather than special-casing a missing row. Column defaults
-- above already match scoring.ts's DEFAULT_CATEGORY_WEIGHTS exactly, so
-- this INSERT (which supplies no column values beyond id) produces a
-- fresh environment whose active weights are byte-identical to the
-- previously-hardcoded constant. Safe to re-run.
INSERT INTO "matching_weight_configs" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;