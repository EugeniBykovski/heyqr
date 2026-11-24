-- HEY-126: a permanent registry of every short link ever issued. Only the slug is kept, so a reservation outlives its
-- code (hard deletion) and its account (cascade deletion) without retaining who owned it or where it pointed.
CREATE TABLE "short_code_reservation" (
	"short_code" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
-- No code can be written between the backfill below and the triggers taking over (released at commit).
LOCK TABLE "qr_code" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- Reserving is part of issuing: the same statement that inserts a code with a slug, or assigns a code its first slug,
-- inserts the reservation. A slug reserved before (by a live, soft-deleted, purged or cascade-deleted code) fails that
-- statement with a unique violation on short_code_reservation_pkey, so the code is not written either; a rolled-back
-- issue rolls back its reservation. AFTER triggers: a row skipped by ON CONFLICT DO NOTHING reserves nothing.
CREATE OR REPLACE FUNCTION "qr_code_reserve_short_code"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "short_code_reservation" ("short_code") VALUES (NEW."short_code");
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "qr_code_reserve_short_code_on_insert" AFTER INSERT ON "qr_code"
  FOR EACH ROW WHEN (NEW."short_code" IS NOT NULL) EXECUTE FUNCTION "qr_code_reserve_short_code"();
--> statement-breakpoint
-- First-time assignment only: a changed or cleared slug is already refused by qr_code_short_code_permanent (HEY-117).
CREATE TRIGGER "qr_code_reserve_short_code_on_assign" AFTER UPDATE OF "short_code" ON "qr_code"
  FOR EACH ROW WHEN (OLD."short_code" IS NULL AND NEW."short_code" IS NOT NULL) EXECUTE FUNCTION "qr_code_reserve_short_code"();
--> statement-breakpoint
-- Append-only: a reservation is never released, renamed or wiped.
CREATE OR REPLACE FUNCTION "short_code_reservation_permanent"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'short_code_reservation is append-only' USING ERRCODE = 'integrity_constraint_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER "short_code_reservation_permanent" BEFORE UPDATE OR DELETE ON "short_code_reservation"
  FOR EACH ROW EXECUTE FUNCTION "short_code_reservation_permanent"();
--> statement-breakpoint
CREATE TRIGGER "short_code_reservation_no_truncate" BEFORE TRUNCATE ON "short_code_reservation"
  FOR EACH STATEMENT EXECUTE FUNCTION "short_code_reservation_permanent"();
--> statement-breakpoint
-- Backfill: every slug still on a qr_code row, live or soft-deleted. Slugs whose rows were purged before this migration
-- left no trace in the database and cannot be recovered here.
INSERT INTO "short_code_reservation" ("short_code")
  SELECT "short_code" FROM "qr_code" WHERE "short_code" IS NOT NULL
  ON CONFLICT DO NOTHING;
