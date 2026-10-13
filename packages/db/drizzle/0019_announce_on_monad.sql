ALTER TABLE "stealth_announcements" ADD COLUMN "sealed" text;--> statement-breakpoint
ALTER TABLE "stealth_announcements" ADD COLUMN "announce_tx" text;--> statement-breakpoint
ALTER TABLE "stealth_payments" ADD COLUMN "announce_tx" text;