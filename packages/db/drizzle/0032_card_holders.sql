CREATE TABLE "card_holders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"provider" text DEFAULT 'nuvion' NOT NULL,
	"entity_id" text NOT NULL,
	"person_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"account_id" text,
	"account_number" text,
	"counterparty_id" text,
	"payment_detail_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_holders_wallet_idx" ON "card_holders" USING btree ("wallet","network");--> statement-breakpoint
CREATE TABLE "card_topups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"amount" bigint NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"tx_hash" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"transfer_id" text,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_topups_tx_idx" ON "card_topups" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "card_topups_reference_idx" ON "card_topups" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "card_topups_wallet_idx" ON "card_topups" USING btree ("wallet","network","created_at");
