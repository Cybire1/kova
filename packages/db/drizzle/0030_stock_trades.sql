CREATE TABLE "stock_attestations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"country" text NOT NULL,
	"message" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_trades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"wallet" text NOT NULL,
	"side" text NOT NULL,
	"symbol" text NOT NULL,
	"stock" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_out" numeric(78, 0) NOT NULL,
	"min_out" numeric(78, 0) NOT NULL,
	"price" text NOT NULL,
	"ref" text NOT NULL,
	"country" text NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"tx_hash" text,
	"filled" numeric(78, 0),
	"failure" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "stock_attestations_wallet_idx" ON "stock_attestations" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE INDEX "stock_trades_wallet_idx" ON "stock_trades" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_trades_ref_idx" ON "stock_trades" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_trades_tx_idx" ON "stock_trades" USING btree ("tx_hash");
