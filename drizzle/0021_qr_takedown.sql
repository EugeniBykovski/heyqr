ALTER TABLE "qr_code" ADD COLUMN "taken_down_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qr_code" ADD COLUMN "takedown_reason" text;