CREATE TABLE "matchmaking_case_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_case_events_actor_type_check" CHECK ("matchmaking_case_events"."actor_type" IN ('ADMIN', 'USER', 'SYSTEM')),
	CONSTRAINT "matchmaking_case_events_kind_check" CHECK ("matchmaking_case_events"."kind" IN ('STATUS_CHANGE', 'NOTE', 'SUGGESTION', 'CONSENT'))
);
--> statement-breakpoint
CREATE TABLE "matchmaking_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"consent_version" text NOT NULL,
	"customer_notes" text,
	"price_in_paise" integer NOT NULL,
	"currency" text NOT NULL,
	"included_membership_days" integer NOT NULL,
	"paid_payment_id" uuid,
	"paid_at" timestamp with time zone,
	"included_access_until" timestamp with time zone,
	"included_access_revoked_at" timestamp with time zone,
	"invoice_claimed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_cases_status_check" CHECK ("matchmaking_cases"."status" IN ('PENDING_PAYMENT', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED')),
	CONSTRAINT "matchmaking_cases_amounts_check" CHECK ("matchmaking_cases"."price_in_paise" > 0 AND "matchmaking_cases"."included_membership_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "matchmaking_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"candidate_user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"score" integer,
	"score_breakdown" jsonb,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"response" text DEFAULT 'PENDING' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_by_admin_id" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_suggestions_source_check" CHECK ("matchmaking_suggestions"."source" IN ('AUTO', 'MANUAL')),
	CONSTRAINT "matchmaking_suggestions_status_check" CHECK ("matchmaking_suggestions"."status" IN ('PROPOSED', 'APPROVED', 'SENT', 'WITHDRAWN')),
	CONSTRAINT "matchmaking_suggestions_response_check" CHECK ("matchmaking_suggestions"."response" IN ('PENDING', 'INTERESTED', 'NOT_INTERESTED'))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "matchmaking_case_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "matchmaking_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matchmaking_case_events" ADD CONSTRAINT "matchmaking_case_events_case_id_matchmaking_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."matchmaking_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_cases" ADD CONSTRAINT "matchmaking_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_cases" ADD CONSTRAINT "matchmaking_cases_paid_payment_id_payments_id_fk" FOREIGN KEY ("paid_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_suggestions" ADD CONSTRAINT "matchmaking_suggestions_case_id_matchmaking_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."matchmaking_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_suggestions" ADD CONSTRAINT "matchmaking_suggestions_candidate_user_id_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_suggestions" ADD CONSTRAINT "matchmaking_suggestions_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matchmaking_case_events_case_created_idx" ON "matchmaking_case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "matchmaking_cases_user_idx" ON "matchmaking_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "matchmaking_cases_status_idx" ON "matchmaking_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matchmaking_cases_one_open_per_user_idx" ON "matchmaking_cases" USING btree ("user_id") WHERE "matchmaking_cases"."status" IN ('PENDING_PAYMENT', 'ACTIVE', 'IN_PROGRESS');--> statement-breakpoint
CREATE UNIQUE INDEX "matchmaking_cases_paid_payment_idx" ON "matchmaking_cases" USING btree ("paid_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matchmaking_suggestions_case_candidate_idx" ON "matchmaking_suggestions" USING btree ("case_id","candidate_user_id");--> statement-breakpoint
CREATE INDEX "matchmaking_suggestions_case_status_idx" ON "matchmaking_suggestions" USING btree ("case_id","status");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_matchmaking_case_id_matchmaking_cases_id_fk" FOREIGN KEY ("matchmaking_case_id") REFERENCES "public"."matchmaking_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_matchmaking_case_idx" ON "payments" USING btree ("matchmaking_case_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_single_purchase_check" CHECK (NOT ("payments"."membership_id" IS NOT NULL AND "payments"."matchmaking_case_id" IS NOT NULL));