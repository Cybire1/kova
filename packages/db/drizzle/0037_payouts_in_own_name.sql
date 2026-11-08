ALTER TABLE "payout_recipients" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "funded_cents" bigint;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "rest_returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "pulled_back_at" timestamp with time zone;
