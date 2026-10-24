ALTER TABLE "ussd_pockets" ADD COLUMN "payout_bank_code" text;--> statement-breakpoint
ALTER TABLE "ussd_pockets" ADD COLUMN "payout_bank_name" text;--> statement-breakpoint
ALTER TABLE "ussd_pockets" ADD COLUMN "payout_account_number" text;--> statement-breakpoint
ALTER TABLE "ussd_pockets" ADD COLUMN "payout_account_name" text;--> statement-breakpoint
ALTER TABLE "ussd_spends" ADD COLUMN "cash_out_id" uuid REFERENCES "cash_outs"("id");
