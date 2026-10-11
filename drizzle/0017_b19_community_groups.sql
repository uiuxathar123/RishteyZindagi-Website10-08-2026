CREATE TABLE "community_group_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_admin_id" uuid,
	"removed_reason" text
);
--> statement-breakpoint
CREATE TABLE "community_group_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'VISIBLE' NOT NULL,
	"hidden_by_admin_id" uuid,
	"hidden_reason" text,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_post_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_group_members" ADD CONSTRAINT "community_group_members_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_members" ADD CONSTRAINT "community_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_members" ADD CONSTRAINT "community_group_members_removed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("removed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_posts" ADD CONSTRAINT "community_group_posts_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_posts" ADD CONSTRAINT "community_group_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_posts" ADD CONSTRAINT "community_group_posts_hidden_by_admin_id_admin_users_id_fk" FOREIGN KEY ("hidden_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_groups" ADD CONSTRAINT "community_groups_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_reports" ADD CONSTRAINT "community_post_reports_post_id_community_group_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_group_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_reports" ADD CONSTRAINT "community_post_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_group_members_pair_idx" ON "community_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "community_group_members_user_idx" ON "community_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "community_group_posts_group_created_idx" ON "community_group_posts" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_groups_name_idx" ON "community_groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "community_post_reports_one_idx" ON "community_post_reports" USING btree ("post_id","reporter_user_id");--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description") VALUES
	(gen_random_uuid(), 'groups.manage', 'Create and edit community groups, hide posts, and remove members from groups.')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id" FROM "admin_roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'SUPER_ADMIN' AND p."key" = 'groups.manage'
ON CONFLICT DO NOTHING;
