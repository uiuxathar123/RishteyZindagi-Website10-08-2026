CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"topic" text DEFAULT 'GENERAL' NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"admin_note" text,
	"ip_hash" text,
	"handled_by_admin_id" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "success_stories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"couple_names" text NOT NULL,
	"location" text NOT NULL,
	"year" integer NOT NULL,
	"story" text NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_handled_by_admin_id_admin_users_id_fk" FOREIGN KEY ("handled_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "success_stories" ADD CONSTRAINT "success_stories_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_status_created_idx" ON "contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "success_stories_published_idx" ON "success_stories" USING btree ("is_published","sort_order");--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description") VALUES
	(gen_random_uuid(), 'support.manage', 'Read and answer contact-form messages and edit the public support contact details.'),
	(gen_random_uuid(), 'content.manage', 'Create, edit, publish and remove success stories shown on the public site.')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id" FROM "admin_roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'SUPER_ADMIN' AND p."key" IN ('support.manage', 'content.manage')
ON CONFLICT DO NOTHING;
