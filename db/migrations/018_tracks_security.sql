-- Two leaderboards: PROVERS (who make proofs, lemmas, records, formalizations) and REFEREES (who read and check:
-- statement critiques, findings, community review). Every point event belongs to one track, set from its reason by a
-- trigger (a reversing entry takes the track of the entry it reverses), so no writer needs to know about tracks.
ALTER TABLE point_events ADD COLUMN track text NOT NULL DEFAULT 'prover' CHECK (track IN ('prover','referee'));

CREATE FUNCTION point_event_track() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT track INTO NEW.track FROM point_events WHERE id = NEW.reverses_id;
  ELSIF NEW.reason ~ '^(critique|referee|review:finding)' THEN
    NEW.track := 'referee';
  ELSE
    NEW.track := 'prover';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER point_events_track BEFORE INSERT ON point_events FOR EACH ROW EXECUTE FUNCTION point_event_track();

-- Backfill (the ledger is append-only: its guard trigger is off for this one-time classification only).
ALTER TABLE point_events DISABLE TRIGGER point_events_append_only;
UPDATE point_events SET track = 'referee' WHERE reason ~ '^(critique|referee|review:finding)';
UPDATE point_events r SET track = o.track FROM point_events o WHERE r.reverses_id = o.id;
ALTER TABLE point_events ENABLE TRIGGER point_events_append_only;

DROP MATERIALIZED VIEW leaderboard;
CREATE MATERIALIZED VIEW leaderboard AS
  SELECT u.id AS user_id, u.handle,
         COALESCE(p.points, 0)::int AS points,
         COALESCE(p.prover_points, 0)::int AS prover_points,
         COALESCE(p.referee_points, 0)::int AS referee_points,
         COALESCE(s.proofs, 0)::int AS proofs,
         COALESCE(s.open_solved, 0)::int AS open_solved,
         COALESCE(s.lemmas, 0)::int AS lemmas,
         COALESCE(r.critiques, 0)::int AS critiques,
         COALESCE(r.reviews, 0)::int AS reviews
  FROM users u
  LEFT JOIN (SELECT user_id, SUM(delta) AS points, SUM(delta) FILTER (WHERE track='prover') AS prover_points,
                    SUM(delta) FILTER (WHERE track='referee') AS referee_points
             FROM point_events GROUP BY user_id) p ON p.user_id = u.id
  LEFT JOIN (
    SELECT s.user_id,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND pr.status <> 'lemma') AS proofs,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind IN ('proof','disproof') AND s.status='verified' AND pr.status='open') AS open_solved,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND pr.status='lemma') AS lemmas
    FROM submissions s JOIN problems pr ON pr.id = s.problem_id GROUP BY s.user_id
  ) s ON s.user_id = u.id
  LEFT JOIN (
    SELECT user_id, count(*) FILTER (WHERE kind='c') AS critiques, count(*) FILTER (WHERE kind='r') AS reviews FROM (
      SELECT user_id, 'c' AS kind FROM critiques WHERE status='accepted'
      UNION ALL SELECT user_id, 'r' FROM submission_votes
      UNION ALL SELECT user_id, 'r' FROM submission_suggestions WHERE status='applied') x GROUP BY user_id
  ) r ON r.user_id = u.id
  WHERE u.banned_at IS NULL;
CREATE UNIQUE INDEX ON leaderboard(user_id);

-- Account security.
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN totp_secret text,                 -- base32, set once confirmed
                  ADD COLUMN totp_enabled_at timestamptz,
                  ADD COLUMN password_changed_at timestamptz,
                  ADD COLUMN suspended_reason text,
                  ADD COLUMN deleted_at timestamptz,
                  ADD COLUMN accepted_terms_at timestamptz,
                  ADD COLUMN handle_changed_at timestamptz;
CREATE TABLE totp_used (                                     -- a code is accepted once (no replay within its window)
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step    bigint NOT NULL,
  PRIMARY KEY (user_id, step)
);

-- Privacy policy: IP addresses in the audit log are erased after 12 months. The log stays append-only except for that
-- one change (an UPDATE that only sets ip to NULL).
CREATE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ip IS NULL
     AND (NEW.id, NEW.actor_id, NEW.action, NEW.target, NEW.data::text, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.actor_id, OLD.action, OLD.target, OLD.data::text, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP;
END $$;
DROP TRIGGER audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

-- Two-step sign-in: after the password, a short-lived challenge (5 minutes, 5 tries) waits for the authenticator code.
CREATE TABLE login_challenges (
  id         text PRIMARY KEY,                -- sha256 of the token handed to the browser
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  next       text,
  tries      int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
