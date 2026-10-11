CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "profile_public_id_seq" START WITH 10000001;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "public_id" text;--> statement-breakpoint
UPDATE "profiles" p SET "public_id" = 'RZ' || lpad(nextval('profile_public_id_seq')::text, 8, '0') FROM (SELECT "id" FROM "profiles" ORDER BY "created_at", "id") o WHERE p."id" = o."id";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "public_id" SET DEFAULT ('RZ' || lpad(nextval('profile_public_id_seq')::text, 8, '0'));--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "profile_visibility" text DEFAULT 'VISIBLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "photo_visibility" text DEFAULT 'MEMBERS' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_last_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description") VALUES
	(gen_random_uuid(), 'plans.manage', 'Create and edit membership plans: prices, durations, entitlements, activation.'),
	(gen_random_uuid(), 'communities.manage', 'Add, rename and retire community entries used by profiles and search.')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id" FROM "admin_roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'SUPER_ADMIN' AND p."key" IN ('plans.manage', 'communities.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "membership_plans" SET "features" = "features" - 'unlimitedInterests' - 'shortlist' WHERE "features" ?| ARRAY['unlimitedInterests', 'shortlist'];
