ALTER TABLE "purchase" ADD COLUMN "item" text DEFAULT 'single_qr' NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_code" ADD COLUMN "print_pack_at" timestamp with time zone;