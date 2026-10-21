CREATE TABLE "matchmaking_introductions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"user_a_response" text DEFAULT 'PENDING' NOT NULL,
	"user_a_responded_at" timestamp with time zone,
	"user_b_response" text DEFAULT 'PENDING' NOT NULL,
	"user_b_responded_at" timestamp with time zone,
	"message_to_members" text,
	"internal_note" text,
	"score_a_to_b" integer,
	"score_b_to_a" integer,
	"created_by_admin_id" uuid NOT NULL,
	"withdrawn_by_admin_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_introductions_ordered_pair_check" CHECK ("matchmaking_introductions"."user_a_id" < "matchmaking_introductions"."user_b_id"),
	CONSTRAINT "matchmaking_introductions_status_check" CHECK ("matchmaking_introductions"."status" IN ('PENDING', 'MUTUALLY_ACCEPTED', 'DECLINED', 'WITHDRAWN')),
	CONSTRAINT "matchmaking_introductions_response_check" CHECK ("matchmaking_introductions"."user_a_response" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN') AND "matchmaking_introductions"."user_b_response" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "company_verification_status" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "company_verification_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "company_verification_reviewed_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "matchmaking_introductions" ADD CONSTRAINT "matchmaking_introductions_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_introductions" ADD CONSTRAINT "matchmaking_introductions_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_introductions" ADD CONSTRAINT "matchmaking_introductions_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_introductions" ADD CONSTRAINT "matchmaking_introductions_withdrawn_by_admin_id_admin_users_id_fk" FOREIGN KEY ("withdrawn_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matchmaking_introductions_user_a_idx" ON "matchmaking_introductions" USING btree ("user_a_id","created_at");--> statement-breakpoint
CREATE INDEX "matchmaking_introductions_user_b_idx" ON "matchmaking_introductions" USING btree ("user_b_id","created_at");--> statement-breakpoint
CREATE INDEX "matchmaking_introductions_status_idx" ON "matchmaking_introductions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matchmaking_introductions_one_open_per_pair_idx" ON "matchmaking_introductions" USING btree ("user_a_id","user_b_id") WHERE "matchmaking_introductions"."status" IN ('PENDING', 'MUTUALLY_ACCEPTED');--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_company_verification_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("company_verification_reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_company_verification_status_check" CHECK ("profiles"."company_verification_status" IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'REVOKED'));