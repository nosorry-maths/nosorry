-- After a statement correction, proofs are re-checked; points stay frozen until the last re-check finishes.
ALTER TABLE problems ADD COLUMN recheck_pending boolean NOT NULL DEFAULT false;

-- Append-only ledger and audit log: fail loudly instead of the silent DO INSTEAD NOTHING rules.
DROP RULE IF EXISTS point_events_no_update ON point_events;
DROP RULE IF EXISTS point_events_no_delete ON point_events;
CREATE OR REPLACE FUNCTION ns_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP;
END $$;
CREATE TRIGGER point_events_append_only BEFORE UPDATE OR DELETE ON point_events FOR EACH ROW EXECUTE FUNCTION ns_append_only();
CREATE TRIGGER point_events_no_truncate BEFORE TRUNCATE ON point_events FOR EACH STATEMENT EXECUTE FUNCTION ns_append_only();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ns_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION ns_append_only();
-- A reversal can only be reversed once.
CREATE UNIQUE INDEX point_events_one_reversal ON point_events(reverses_id) WHERE reverses_id IS NOT NULL;

-- Idempotency: store a hash of the request so a reused key with different content is refused.
ALTER TABLE submissions ADD COLUMN request_hash text;

-- Production note: run the app with a role that is NOT the owner of these tables and has only INSERT/SELECT on
-- point_events and audit_log (see docs/ARCHITECTURE.md). The owner can still disable triggers; the app role cannot.
