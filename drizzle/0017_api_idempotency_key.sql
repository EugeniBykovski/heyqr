-- HEY-165: Idempotency-Key replays of POST /api/v1/qr-codes, per account and operation (retention 24 h). New table only.
CREATE TABLE "api_idempotency_key" (
	"user_id" text NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"qr_code_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_key_user_id_operation_key_pk" PRIMARY KEY("user_id","operation","key")
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_key" ADD CONSTRAINT "api_idempotency_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency_key" ADD CONSTRAINT "api_idempotency_key_qr_code_id_qr_code_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_code"("id") ON DELETE cascade ON UPDATE no action;
