-- STI-104: enforce the ledger's append-only contract at the database.
--
-- `transaction` is the system of record for the custody chain — the thing that has
-- to stand up as evidence when a tool goes missing. Until now the only assertion of
-- immutability was a source comment (packages/db/src/schema/event.ts); corrections
-- are compensating events (see 0013_backfill_ledger_tostate.sql for the pattern),
-- never edits.
--
-- Trigger, not REVOKE: the app connects as `postgres`, the table OWNER, and an
-- owner holds implicit grant options — `REVOKE UPDATE, DELETE` (SYSTEM_PLAN §6.1)
-- would apply cleanly and enforce nothing. A BEFORE trigger fires for every role,
-- owner and superuser included.
--
-- TRUNCATE: a BEFORE ... FOR EACH ROW trigger does NOT fire on TRUNCATE, which
-- would otherwise be a silent one-line way to destroy the entire custody history,
-- so a separate statement-level trigger blocks it.
--
-- ERRCODE 0A000 (feature_not_supported) so callers can classify the failure on
-- SQLSTATE instead of matching message text.
--
-- Honest limit: the table owner can `ALTER TABLE ... DISABLE TRIGGER` — the seed's
-- SEED_RESET wipe does exactly that, deliberately (packages/db/src/seed.ts). This
-- is a correctness guard against accidental UPDATE/DELETE, not a security boundary
-- against a determined actor. A real boundary needs a separate non-owner
-- application role, which is a deployment change outside Release 1 — follow-up,
-- not implied here.
CREATE OR REPLACE FUNCTION transaction_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '"transaction" is append-only: % blocked. The ledger is the system of record for the custody chain; corrections are compensating events, never edits (STI-104).',
    TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transaction_no_update_delete
  BEFORE UPDATE OR DELETE ON "transaction"
  FOR EACH ROW EXECUTE FUNCTION transaction_append_only();
--> statement-breakpoint
CREATE TRIGGER transaction_no_truncate
  BEFORE TRUNCATE ON "transaction"
  FOR EACH STATEMENT EXECUTE FUNCTION transaction_append_only();
