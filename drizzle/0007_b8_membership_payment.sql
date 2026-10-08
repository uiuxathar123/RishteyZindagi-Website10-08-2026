ALTER TABLE "invoices" ADD COLUMN "snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pdf_storage_key" text;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verification_method" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "gateway_transaction_id" text;