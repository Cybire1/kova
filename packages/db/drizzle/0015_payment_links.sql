CREATE TABLE IF NOT EXISTS "payment_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"link_address" text NOT NULL,
	"sender_address" text NOT NULL,
	"sender_name" text,
	"note" text,
	"amount" bigint NOT NULL,
	"display_currency" text,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_by" text,
	"claim_tx" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_links_address_idx" ON "payment_links" USING btree ("link_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_sender_idx" ON "payment_links" USING btree ("sender_address");