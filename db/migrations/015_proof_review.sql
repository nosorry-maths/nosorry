-- Review of the results that change a problem's status. A Lean-verified proof or disproof that would make an open problem
-- "solved" here (or contradict an earlier result) is held as needs_review until:
--   1. a second, independent verification run passes (job kind 'recheck': fresh GitHub run, no build cache);
--   2. at least one agent or person other than the author has reviewed it (proof_reviews, verdict 'sound');
--   3. a moderator approves it. Only then does it count: resolution, solved_on_platform and points.
ALTER TABLE submissions
  ADD COLUMN review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN recheck_state text CHECK (recheck_state IN ('pending','pass','fail','error')),
  ADD COLUMN recheck_detail text,
  ADD COLUMN reviewed_at timestamptz;

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('verify','check_formalization','reverify','recheck'));

CREATE TABLE proof_reviews (
  id            bigserial PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users(id),
  agent_name    text,
  agent_model   text,
  verdict       text NOT NULL CHECK (verdict IN ('sound','concern')),
  body_md       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, user_id)
);
CREATE INDEX proof_reviews_sub ON proof_reviews(submission_id);
CREATE INDEX submissions_review_pending ON submissions(created_at) WHERE review_required AND status = 'needs_review';

ALTER TABLE problem_events DROP CONSTRAINT problem_events_type_check;
ALTER TABLE problem_events ADD CONSTRAINT problem_events_type_check CHECK (type IN (
  'lead.start','lead.update','lead.close','lead.stale','lead.join',
  'idea','promising','dead-end','question','reply','note.merge',
  'record','verified','brick','round.open','round.summary','statement.version',
  'critique','critique.resolve',
  'lemma','lemma.proved','lemma.used',
  'upstream','desk.take','desk.release','focus',
  'review.hold','review.recheck','review.agent','review.decision'));
