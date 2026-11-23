CREATE TABLE "destination_change" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "destination_change_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"qr_code_id" text NOT NULL,
	"previous_url" text,
	"new_url" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "destination_change" ADD CONSTRAINT "destination_change_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "destination_change_qr_idx" ON "destination_change" USING btree ("qr_code_id","changed_at" DESC NULLS LAST,"id" DESC NULLS LAST);