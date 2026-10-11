ALTER TABLE "profiles" ADD COLUMN "approval_status" text DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "approval_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "approval_decided_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "approval_reason" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_approval_decided_by_admin_id_admin_users_id_fk" FOREIGN KEY ("approval_decided_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_approval_status_idx" ON "profiles" USING btree ("approval_status");--> statement-breakpoint
-- Grandfather every profile that is already visible: it counts as decided so switching manual approval on later never hides it.
UPDATE "profiles" SET "approval_decided_at" = now() WHERE "profile_status" = 'READY_FOR_VISIBILITY';--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description") VALUES
	(gen_random_uuid(), 'profiles.approve', 'Approve or reject profiles that are waiting in the manual-approval queue.')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id" FROM "admin_roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'SUPER_ADMIN' AND p."key" = 'profiles.approve'
ON CONFLICT DO NOTHING;
