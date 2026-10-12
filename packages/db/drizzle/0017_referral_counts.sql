CREATE TABLE IF NOT EXISTS "referral_counts" (
	"ref" text NOT NULL,
	"day" text NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"wallets" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "referral_counts_ref_day_pk" PRIMARY KEY("ref","day")
);
