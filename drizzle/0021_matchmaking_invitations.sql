CREATE TABLE "matchmaking_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"message_to_member" text,
	"included_membership_days" integer,
	"invited_by_admin_id" uuid NOT NULL,
	"revoked_by_admin_id" uuid,
	"case_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_invitations_kind_check" CHECK ("matchmaking_invitations"."kind" IN ('OFFER', 'COMPLIMENTARY')),
	CONSTRAINT "matchmaking_invitations_status_check" CHECK ("matchmaking_invitations"."status" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED')),
	CONSTRAINT "matchmaking_invitations_days_check" CHECK (("matchmaking_invitations"."kind" = 'OFFER' AND "matchmaking_invitations"."included_membership_days" IS NULL) OR ("matchmaking_invitations"."kind" = 'COMPLIMENTARY' AND "matchmaking_invitations"."included_membership_days" BETWEEN 0 AND 3650))
);
--> statement-breakpoint
ALTER TABLE "matchmaking_cases" DROP CONSTRAINT "matchmaking_cases_amounts_check";--> statement-breakpoint
ALTER TABLE "matchmaking_cases" ADD COLUMN "complimentary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matchmaking_invitations" ADD CONSTRAINT "matchmaking_invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_invitations" ADD CONSTRAINT "matchmaking_invitations_invited_by_admin_id_admin_users_id_fk" FOREIGN KEY ("invited_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_invitations" ADD CONSTRAINT "matchmaking_invitations_revoked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_invitations" ADD CONSTRAINT "matchmaking_invitations_case_id_matchmaking_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."matchmaking_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matchmaking_invitations_user_idx" ON "matchmaking_invitations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "matchmaking_invitations_status_idx" ON "matchmaking_invitations" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matchmaking_invitations_one_pending_per_user_idx" ON "matchmaking_invitations" USING btree ("user_id") WHERE "matchmaking_invitations"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "matchmaking_cases" ADD CONSTRAINT "matchmaking_cases_amounts_check" CHECK (("matchmaking_cases"."price_in_paise" > 0 OR ("matchmaking_cases"."complimentary" AND "matchmaking_cases"."price_in_paise" = 0)) AND "matchmaking_cases"."included_membership_days" >= 0);