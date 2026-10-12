CREATE TABLE IF NOT EXISTS "stealth_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"merchant_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"stealth_address" text NOT NULL,
	"ephemeral_public_key" text NOT NULL,
	"view_tag" text NOT NULL,
	"swept_tx" text,
	"swept_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "stealth_meta_address" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stealth_payments" ADD CONSTRAINT "stealth_payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stealth_payments" ADD CONSTRAINT "stealth_payments_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stealth_payments_intent_idx" ON "stealth_payments" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stealth_payments_address_idx" ON "stealth_payments" USING btree ("stealth_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stealth_payments_merchant_idx" ON "stealth_payments" USING btree ("merchant_id");