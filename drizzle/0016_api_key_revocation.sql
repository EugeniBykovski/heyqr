-- HEY-154: revocation and last use of API keys. Both nullable: every existing key stays active and valid.
ALTER TABLE "api_key" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "last_used_at" timestamp with time zone;
