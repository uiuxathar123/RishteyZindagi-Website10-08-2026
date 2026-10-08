CREATE TYPE "public"."behaviour_event_type" AS ENUM('PROFILE_VIEW', 'LIKE', 'SHORTLIST', 'INTEREST_SENT', 'INTEREST_ACCEPTED', 'INTEREST_REJECTED', 'MATCH_CREATED', 'SEARCH_INTERACTION', 'CHAT_INITIATED');--> statement-breakpoint
CREATE TABLE "account_suspensions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"suspended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by_admin_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "behaviour_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"target_user_id" uuid,
	"event_type" "behaviour_event_type" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "account_suspensions" ADD CONSTRAINT "account_suspensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_suspensions" ADD CONSTRAINT "account_suspensions_lifted_by_admin_id_admin_users_id_fk" FOREIGN KEY ("lifted_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behaviour_events" ADD CONSTRAINT "behaviour_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behaviour_events" ADD CONSTRAINT "behaviour_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_suspensions_user_idx" ON "account_suspensions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "behaviour_events_actor_created_idx" ON "behaviour_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "behaviour_events_target_created_idx" ON "behaviour_events" USING btree ("target_user_id","created_at");