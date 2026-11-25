CREATE TABLE "api_rate_limit" (
	"user_id" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "api_rate_limit_user_id_bucket_pk" PRIMARY KEY("user_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "api_rate_limit" ADD CONSTRAINT "api_rate_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;