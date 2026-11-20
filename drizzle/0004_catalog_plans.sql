CREATE TABLE "allowance_use" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"qr_code_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"purchase_id" text,
	"qr_code_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase" ALTER COLUMN "qr_code_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "plan" text DEFAULT 'starter' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "current_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allowance_use" ADD CONSTRAINT "allowance_use_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowance_use" ADD CONSTRAINT "allowance_use_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allowance_use_user_idx" ON "allowance_use" USING btree ("user_id","kind","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "allowance_use_code_uq" ON "allowance_use" USING btree ("kind","qr_code_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_purchase_uq" ON "credit_ledger" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_unlock_uq" ON "credit_ledger" USING btree ("qr_code_id") WHERE "credit_ledger"."reason" = 'unlock';