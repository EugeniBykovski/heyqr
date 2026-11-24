-- HEY-128: the destination's own revision for Change destination. Existing codes start at 0; each actual destination
-- change advances it by one in the same write. Adding a column with a constant default rewrites no rows.
ALTER TABLE "qr_code" ADD COLUMN "destination_revision" integer DEFAULT 0 NOT NULL;
