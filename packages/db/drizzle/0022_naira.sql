CREATE TABLE "cash_outs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"wallet_address" text NOT NULL,
	"amount" bigint NOT NULL,
	"naira" bigint NOT NULL,
	"rate" text NOT NULL,
	"fee" bigint NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"recipient_code" text,
	"status" text DEFAULT 'quoted' NOT NULL,
	"tx_hash" text,
	"refund_tx_hash" text,
	"transfer_code" text,
	"failure" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "naira_top_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"wallet_address" text NOT NULL,
	"amount" bigint NOT NULL,
	"naira" bigint NOT NULL,
	"rate" text NOT NULL,
	"email" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'initialized' NOT NULL,
	"tx_hash" text,
	"failure" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cash_outs_wallet_idx" ON "cash_outs" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_outs_tx_idx" ON "cash_outs" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "naira_top_ups_reference_idx" ON "naira_top_ups" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "naira_top_ups_wallet_idx" ON "naira_top_ups" USING btree ("wallet_address","created_at");