ALTER TABLE "asset" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "last_used_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_user_sha_uq" ON "asset" USING btree ("user_id","sha256") WHERE "asset"."sha256" is not null;