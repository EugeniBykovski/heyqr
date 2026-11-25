CREATE TABLE "developer_notify" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"topic" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_report" (
	"id" text PRIMARY KEY NOT NULL,
	"short_code" text NOT NULL,
	"qr_code_id" text,
	"version" integer,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"email" text,
	"reporter_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_hosted_version" (
	"id" text PRIMARY KEY NOT NULL,
	"qr_code_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_report" ADD CONSTRAINT "page_report_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_hosted_version" ADD CONSTRAINT "qr_hosted_version_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "developer_notify_email_topic_uq" ON "developer_notify" USING btree ("email","topic");--> statement-breakpoint
CREATE INDEX "page_report_code_idx" ON "page_report" USING btree ("short_code","created_at");--> statement-breakpoint
CREATE INDEX "page_report_reporter_idx" ON "page_report" USING btree ("reporter_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_hosted_version_qr_uq" ON "qr_hosted_version" USING btree ("qr_code_id","version");