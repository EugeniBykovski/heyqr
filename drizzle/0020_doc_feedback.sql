CREATE TABLE "doc_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"page" text NOT NULL,
	"helpful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "doc_feedback_page_idx" ON "doc_feedback" USING btree ("page","created_at");