CREATE TYPE "public"."profile_status" AS ENUM('INCOMPLETE', 'COMPLETE', 'READY_FOR_VISIBILITY');--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "file_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "upload_status" text DEFAULT 'COMPLETE' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "income_currency" text DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "mother_tongue_ids" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "education_ids" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "profession_ids" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "lifestyle" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "family_details" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "missing_required_fields" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "has_profile_photo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "profile_status" "profile_status" DEFAULT 'INCOMPLETE' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "verified_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_verified_by_admin_id_admin_users_id_fk" FOREIGN KEY ("verified_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_status_idx" ON "profiles" USING btree ("profile_status");