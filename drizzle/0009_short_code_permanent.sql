-- HEY-117: a code's short link is permanent once issued. It is set once, from NULL; it is never changed or cleared.
CREATE OR REPLACE FUNCTION "qr_code_short_code_permanent"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."short_code" IS NOT NULL AND NEW."short_code" IS DISTINCT FROM OLD."short_code" THEN
    RAISE EXCEPTION 'qr_code.short_code is permanent once issued' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "qr_code_short_code_permanent" BEFORE UPDATE OF "short_code" ON "qr_code"
  FOR EACH ROW EXECUTE FUNCTION "qr_code_short_code_permanent"();
