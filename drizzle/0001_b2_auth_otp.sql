CREATE TYPE "public"."otp_method" AS ENUM('SMS', 'WHATSAPP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('SIGNUP', 'LOGIN', 'FORGOT_PASSWORD', 'NEW_DEVICE');--> statement-breakpoint
CREATE TABLE "otp_configs" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"active_method" "otp_method" DEFAULT 'EMAIL' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"otp_length" integer DEFAULT 6 NOT NULL,
	"otp_expiry_seconds" integer DEFAULT 300 NOT NULL,
	"max_verify_attempts" integer DEFAULT 5 NOT NULL,
	"resend_cooldown_seconds" integer DEFAULT 30 NOT NULL,
	"max_resend_attempts" integer DEFAULT 5 NOT NULL,
	"resend_window_seconds" integer DEFAULT 3600 NOT NULL,
	"dev_mode" boolean DEFAULT false NOT NULL,
	"sms_config" jsonb,
	"whatsapp_config" jsonb,
	"email_config" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"channel" "otp_method" NOT NULL,
	"identifier" text NOT NULL,
	"user_id" uuid,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"metadata" jsonb,
	"ticket_hash" text,
	"ticket_expires_at" timestamp with time zone,
	"ticket_consumed_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otps_ticket_hash_unique" UNIQUE("ticket_hash")
);
--> statement-breakpoint
ALTER TABLE "device_sessions" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "otp_configs" ADD CONSTRAINT "otp_configs_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otps" ADD CONSTRAINT "otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otps_identifier_purpose_idx" ON "otps" USING btree ("identifier","purpose");--> statement-breakpoint
CREATE INDEX "otps_ticket_hash_idx" ON "otps" USING btree ("ticket_hash");--> statement-breakpoint
CREATE INDEX "device_sessions_device_idx" ON "device_sessions" USING btree ("device_id");--> statement-breakpoint
-- Singleton enforcement: otp_configs may only ever hold the row id=1. This
-- is the DB-level half of "exactly one active OTP method at any time" — no
-- second row (and therefore no second "active method") can ever exist,
-- independent of any application-level check.
ALTER TABLE "otp_configs" ADD CONSTRAINT "otp_configs_singleton_check" CHECK ("id" = 1);--> statement-breakpoint
-- Seed the single settings row so the app can always assume it exists
-- rather than special-casing a missing row. Safe to re-run.
INSERT INTO "otp_configs" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;