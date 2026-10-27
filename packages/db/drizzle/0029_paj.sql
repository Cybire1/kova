ALTER TABLE "cash_outs" ADD COLUMN "partner" text DEFAULT 'paystack' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD COLUMN "partner_order_id" text;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD COLUMN "partner_address" text;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD COLUMN "pay_units" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_outs_partner_order_idx" ON "cash_outs" USING btree ("partner_order_id");--> statement-breakpoint
ALTER TABLE "naira_top_ups" ADD COLUMN "partner" text DEFAULT 'paystack' NOT NULL;--> statement-breakpoint
ALTER TABLE "naira_top_ups" ADD COLUMN "partner_order_id" text;--> statement-breakpoint
ALTER TABLE "naira_top_ups" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "naira_top_ups" ADD COLUMN "account_number" text;--> statement-breakpoint
ALTER TABLE "naira_top_ups" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "naira_top_ups" ADD COLUMN "return_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "naira_top_ups_partner_order_idx" ON "naira_top_ups" USING btree ("partner_order_id");
