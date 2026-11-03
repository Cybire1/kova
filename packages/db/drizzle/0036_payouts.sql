CREATE TABLE "payout_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"network" "network" NOT NULL,
	"corridor" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"holder_name" text NOT NULL,
	"label" text NOT NULL,
	"counterparty_id" text NOT NULL,
	"payment_detail_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payout_recipients_wallet_idx" ON "payout_recipients" USING btree ("wallet","network","created_at");--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"wallet" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"amount_to" bigint NOT NULL,
	"rate" text NOT NULL,
	"fx_quote_id" text,
	"status" text DEFAULT 'quoted' NOT NULL,
	"tx_hash" text,
	"transfer_id" text,
	"provider_fee" bigint,
	"refund_tx_hash" text,
	"failure" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payouts_wallet_idx" ON "payouts" USING btree ("wallet","network","created_at");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("network","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_tx_idx" ON "payouts" USING btree ("tx_hash");
