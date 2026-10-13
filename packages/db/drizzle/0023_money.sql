CREATE TABLE "money_access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"feature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "money_access_requests_idx" ON "money_access_requests" USING btree ("wallet","network","feature");--> statement-breakpoint
CREATE TABLE "us_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"provider" text DEFAULT 'bridge' NOT NULL,
	"customer_id" text,
	"kyc_link_id" text,
	"kyc_link" text,
	"tos_link" text,
	"kyc_status" text DEFAULT 'not_started' NOT NULL,
	"virtual_account_id" text,
	"deposit_address" text,
	"details" jsonb,
	"status" text DEFAULT 'kyc' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "us_accounts_wallet_idx" ON "us_accounts" USING btree ("wallet","network");--> statement-breakpoint
CREATE TABLE "dollar_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"provider" text DEFAULT 'lithic' NOT NULL,
	"provider_card_token" text NOT NULL,
	"last_four" text NOT NULL,
	"exp_month" text,
	"exp_year" text,
	"state" text DEFAULT 'open' NOT NULL,
	"daily_limit" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dollar_cards_token_idx" ON "dollar_cards" USING btree ("provider_card_token");--> statement-breakpoint
CREATE INDEX "dollar_cards_wallet_idx" ON "dollar_cards" USING btree ("wallet","network");--> statement-breakpoint
CREATE TABLE "savings_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"vault" text NOT NULL,
	"kind" text NOT NULL,
	"assets" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "savings_moves_tx_idx" ON "savings_moves" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "savings_moves_wallet_idx" ON "savings_moves" USING btree ("wallet","network");
