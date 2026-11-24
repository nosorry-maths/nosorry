-- Intermediate lemmas ("bricks").
-- A lemma is a problem with status 'lemma' attached to a parent problem. Reusing `problems` means submissions,
-- verification, the board, the stream and the ledger work for lemmas unchanged; status 'lemma' keeps them out of the
-- research lists (which only show open/solved). Its statement is machine-checked (it must compile and be stated with
-- sorry) and needs no human review: a lemma only matters if a kernel-checked proof uses it.

ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_status_check;
ALTER TABLE problems ADD CONSTRAINT problems_status_check
  CHECK (status IN ('open','solved','textbook','test','api','withdrawn','lemma'));

ALTER TABLE problems
  ADD COLUMN parent_id bigint REFERENCES problems(id),
  ADD COLUMN lemma_state text CHECK (lemma_state IN ('checking','open','proved','invalid')),
  ADD COLUMN lemma_origin text CHECK (lemma_origin IN ('proposed','partial')),
  ADD COLUMN origin_submission_id bigint REFERENCES submissions(id),
  ADD COLUMN proposed_by bigint REFERENCES users(id),
  ADD COLUMN lemma_note text,                      -- why it helps (proposals) or why it was refused (invalid)
  ADD COLUMN lemma_name text,                      -- short Lean name, unique per parent (it lives in the parent's namespace)
  ADD COLUMN lemma_signature text;                 -- binders and type, as proposed: "(n : ℕ) (h : 0 < n) : n ≤ n ^ 2"
ALTER TABLE problems ADD CONSTRAINT lemma_has_parent CHECK ((status = 'lemma') = (parent_id IS NOT NULL));
CREATE INDEX ON problems(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX ON problems(lemma_state) WHERE status = 'lemma';
CREATE UNIQUE INDEX problems_lemma_name_per_parent ON problems(parent_id, lemma_name) WHERE status = 'lemma' AND lemma_state <> 'invalid';

-- The statement check of a lemma is a 'formalization' submission; the worker accepts it automatically.
ALTER TABLE submissions ADD COLUMN share_lemmas boolean NOT NULL DEFAULT false;

-- Which accepted proofs used which proved lemma (credit flows to the lemma's authors once per using proof).
CREATE TABLE lemma_uses (
  lemma_id      bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lemma_id, submission_id)
);

ALTER TABLE problem_events DROP CONSTRAINT problem_events_type_check;
ALTER TABLE problem_events ADD CONSTRAINT problem_events_type_check CHECK (type IN (
  'lead.start','lead.update','lead.close','lead.stale','lead.join',
  'idea','promising','dead-end','question','reply','note.merge',
  'record','verified','brick','round.open','round.summary','statement.version',
  'critique','critique.resolve',
  'lemma','lemma.proved','lemma.used'));

-- Leaderboard: lemma proofs are counted apart, not as "problems proved".
DROP MATERIALIZED VIEW leaderboard;
CREATE MATERIALIZED VIEW leaderboard AS
  SELECT u.id AS user_id, u.handle,
         COALESCE(p.points, 0)::int AS points,
         COALESCE(s.proofs, 0)::int AS proofs,
         COALESCE(s.open_solved, 0)::int AS open_solved,
         COALESCE(s.lemmas, 0)::int AS lemmas
  FROM users u
  LEFT JOIN (SELECT user_id, SUM(delta) AS points FROM point_events GROUP BY user_id) p ON p.user_id = u.id
  LEFT JOIN (
    SELECT s.user_id,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND pr.status <> 'lemma') AS proofs,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND pr.status='open') AS open_solved,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND pr.status='lemma') AS lemmas
    FROM submissions s JOIN problems pr ON pr.id = s.problem_id GROUP BY s.user_id
  ) s ON s.user_id = u.id
  WHERE u.banned_at IS NULL;
CREATE UNIQUE INDEX ON leaderboard(user_id);
