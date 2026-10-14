CREATE TABLE "ios_beta_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"country" text,
	"source" text DEFAULT 'iphone-page' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ios_beta_requests_email_idx" ON "ios_beta_requests" USING btree ("email");
