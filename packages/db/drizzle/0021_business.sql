CREATE TABLE IF NOT EXISTS "payroll_people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"wallet_address" text NOT NULL,
	"amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"network" "network" NOT NULL,
	"label" text NOT NULL,
	"total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"stealth_address" text,
	"tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"wallet_address" text NOT NULL,
	"country" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"network" "network" NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_people" ADD CONSTRAINT "payroll_people_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_person_id_payroll_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."payroll_people"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_people_merchant_wallet_idx" ON "payroll_people" USING btree ("merchant_id","wallet_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_runs_merchant_idx" ON "payroll_runs" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_payments_run_idx" ON "payroll_payments" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_merchant_wallet_idx" ON "suppliers" USING btree ("merchant_id","wallet_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_payments_merchant_idx" ON "supplier_payments" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_tx_idx" ON "supplier_payments" USING btree ("tx_hash");
