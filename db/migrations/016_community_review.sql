-- Community review replaces the independent re-run of 015: a result held for review (it would change a problem's
-- status) is discussed by registered members — votes, comments, suggested changes to its Lean file, like a pull
-- request — and a moderator decides (moderators have every power: approve, reject, apply or close suggestions,
-- hide comments).
ALTER TABLE submissions DROP COLUMN recheck_state, DROP COLUMN recheck_detail,
  ADD COLUMN revision_of bigint REFERENCES submissions(id);
DROP TABLE proof_reviews;
DELETE FROM verification_runs WHERE job_id IN (SELECT id FROM jobs WHERE kind = 'recheck');
DELETE FROM jobs WHERE kind = 'recheck';
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('verify','check_formalization','reverify'));

-- One vote per member and submission: +1 or -1 (removing a vote deletes the row). Never on your own submission.
CREATE TABLE submission_votes (
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users(id),
  value         smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, user_id)
);

-- Discussion, optionally anchored to a line of the Lean file (like a review comment on a diff).
CREATE TABLE submission_comments (
  id            bigserial PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users(id),
  reply_to      bigint REFERENCES submission_comments(id) ON DELETE SET NULL,
  line          int CHECK (line IS NULL OR line > 0),
  body_md       text NOT NULL,
  agent_name    text,
  agent_model   text,
  hidden_by     bigint REFERENCES users(id),     -- a moderator hid it (kept for the record)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submission_comments_sub ON submission_comments(submission_id, id);

-- A suggested change: a revised Lean file with a description. Applying it (author or moderator) submits the revised
-- file as a new revision of the submission (verified by Lean, held for review again); the old one is superseded.
CREATE TABLE submission_suggestions (
  id            bigserial PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users(id),
  body_md       text NOT NULL,
  lean_source   text NOT NULL,
  agent_name    text,
  agent_model   text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','closed')),
  decided_by    bigint REFERENCES users(id),
  decided_at    timestamptz,
  revision_id   bigint REFERENCES submissions(id),  -- the submission created when it was applied
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submission_suggestions_sub ON submission_suggestions(submission_id, id);

ALTER TABLE problem_events DROP CONSTRAINT problem_events_type_check;
ALTER TABLE problem_events ADD CONSTRAINT problem_events_type_check CHECK (type IN (
  'lead.start','lead.update','lead.close','lead.stale','lead.join',
  'idea','promising','dead-end','question','reply','note.merge',
  'record','verified','brick','round.open','round.summary','statement.version',
  'critique','critique.resolve',
  'lemma','lemma.proved','lemma.used',
  'upstream','desk.take','desk.release','focus',
  'review.hold','review.recheck','review.agent','review.decision',
  'review.comment','review.suggestion'));
