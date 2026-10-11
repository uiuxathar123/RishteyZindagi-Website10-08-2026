CREATE TABLE "renewal_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text DEFAULT 'LAPSED' NOT NULL,
	"lapsed_at" timestamp with time zone NOT NULL,
	"last_notice_at" timestamp with time zone,
	"renewed_membership_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renewal_cycles" ADD CONSTRAINT "renewal_cycles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_cycles" ADD CONSTRAINT "renewal_cycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_cycles" ADD CONSTRAINT "renewal_cycles_renewed_membership_id_memberships_id_fk" FOREIGN KEY ("renewed_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_cycles_membership_idx" ON "renewal_cycles" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "renewal_cycles_state_idx" ON "renewal_cycles" USING btree ("state","lapsed_at");