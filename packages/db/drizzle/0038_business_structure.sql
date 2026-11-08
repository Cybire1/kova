ALTER TABLE "terminals" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "member_id" uuid;--> statement-breakpoint
CREATE TABLE "business_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"branch_ids" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"added_by" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "business_branches" ADD CONSTRAINT "business_branches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_branches_merchant_idx" ON "business_branches" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "business_members_merchant_idx" ON "business_members" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "business_members_wallet_idx" ON "business_members" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_active_idx" ON "business_members" USING btree ("merchant_id","wallet") WHERE "status" = 'active';
