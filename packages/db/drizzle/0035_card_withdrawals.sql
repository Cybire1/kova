ALTER TABLE "card_holders" ADD COLUMN "return_counterparty_id" text;--> statement-breakpoint
ALTER TABLE "card_holders" ADD COLUMN "return_payment_detail_id" text;--> statement-breakpoint
CREATE TABLE "card_withdrawals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pulling' NOT NULL,
	"transfer_id" text,
	"tx_hash" text,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_withdrawals_reference_idx" ON "card_withdrawals" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "card_withdrawals_wallet_idx" ON "card_withdrawals" USING btree ("wallet","network","created_at");
