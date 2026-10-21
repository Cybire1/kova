CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alerts_wallet_symbol_idx" ON "stock_alerts" USING btree ("wallet","symbol");
