CREATE TABLE "refund" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_id" text,
	"user_id" text,
	"stripe_payment_intent_id" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"lines" jsonb,
	"outcome" text NOT NULL,
	"reason" text,
	"credits_removed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "credit_ledger_purchase_uq";--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_purchase_idx" ON "refund" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_refund_uq" ON "credit_ledger" USING btree ("purchase_id") WHERE "credit_ledger"."reason" = 'refund';--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_purchase_uq" ON "credit_ledger" USING btree ("purchase_id") WHERE "credit_ledger"."reason" in ('pack3', 'pack10');