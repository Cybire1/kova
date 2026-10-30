ALTER TABLE "merchants" ADD COLUMN "splitter_address" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "split_names" jsonb;--> statement-breakpoint
CREATE TABLE "repeat_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network" "network" NOT NULL,
	"plan_id" bigint NOT NULL,
	"payer" text NOT NULL,
	"payee" text NOT NULL,
	"label" text,
	"amount" bigint NOT NULL,
	"every" integer NOT NULL,
	"times" integer NOT NULL,
	"left" integer NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_problem" text,
	"last_paid_at" timestamp with time zone,
	"start_tx" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repeat_plans_plan_idx" ON "repeat_plans" USING btree ("network","plan_id");--> statement-breakpoint
CREATE INDEX "repeat_plans_payer_idx" ON "repeat_plans" USING btree ("payer");--> statement-breakpoint
CREATE INDEX "repeat_plans_payee_idx" ON "repeat_plans" USING btree ("payee");--> statement-breakpoint
CREATE INDEX "repeat_plans_due_idx" ON "repeat_plans" USING btree ("status","next_at");
