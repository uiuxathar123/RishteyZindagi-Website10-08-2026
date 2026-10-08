ALTER TABLE "partner_preferences" ADD COLUMN "gender_preference" "profile_gender";--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "religion_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "mother_tongue_ids" jsonb;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "education_ids" jsonb;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "profession_any" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "city_ids" jsonb;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "income_min_amount" integer;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "income_max_amount" integer;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD COLUMN "income_currency" text DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "income_min_amount" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "income_max_amount" integer;--> statement-breakpoint
ALTER TABLE "partner_preferences" ADD CONSTRAINT "partner_preferences_religion_id_religions_id_fk" FOREIGN KEY ("religion_id") REFERENCES "public"."religions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_dob_idx" ON "profiles" USING btree ("date_of_birth");--> statement-breakpoint
CREATE INDEX "profiles_height_idx" ON "profiles" USING btree ("height_cm");--> statement-breakpoint
CREATE INDEX "profiles_education_idx" ON "profiles" USING btree ("education_id");--> statement-breakpoint
CREATE INDEX "profiles_income_idx" ON "profiles" USING btree ("income_currency","income_min_amount","income_max_amount");