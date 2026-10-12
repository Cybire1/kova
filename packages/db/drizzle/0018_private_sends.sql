CREATE TABLE IF NOT EXISTS "stealth_announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"stealth_address" text NOT NULL,
	"ephemeral_public_key" text NOT NULL,
	"view_tag" text NOT NULL,
	"from_address" text NOT NULL,
	"amount" bigint NOT NULL,
	"token_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_stealth_keys" (
	"address" text PRIMARY KEY NOT NULL,
	"meta_address" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stealth_announcements_address_idx" ON "stealth_announcements" USING btree ("stealth_address");