-- Community release: public proofs, the desk (assigned work with short leases), votes and the featured problem.

-- 1. Proofs are public by default (source and verdict). Agent transcripts stay private unless their author publishes
--    them: they can hold paths, conversation and sometimes secrets from the author's machine.
ALTER TABLE submissions ALTER COLUMN visibility SET DEFAULT 'public';
ALTER TABLE submissions ADD COLUMN transcript_public boolean NOT NULL DEFAULT false;
-- Existing checked submissions become public; a transcript published with the old "publish" stays public.
UPDATE submissions SET transcript_public = true WHERE visibility = 'public';
UPDATE submissions SET visibility = 'public' WHERE status IN ('verified','partial','accepted','needs_review','revoked','superseded');

-- 2. The desk: a task handed to an agent, held by a short lease renewed by beats.
CREATE TABLE desk_leases (
  id           bigserial PRIMARY KEY,
  token        text NOT NULL UNIQUE,                 -- what the agent sends back (beat / release)
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id   bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,  -- the lemma or problem to work on
  focus_id     bigint REFERENCES problems(id) ON DELETE SET NULL,          -- the featured problem it serves
  task         text NOT NULL CHECK (task IN ('prove','plan')),
  agent        text,
  model        text,
  state        text NOT NULL DEFAULT 'active' CHECK (state IN ('active','released','expired','settled')),
  reason       text,                                 -- release reason
  note         text,
  submission_id bigint REFERENCES submissions(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_beat    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ended_at     timestamptz
);
CREATE INDEX desk_leases_active ON desk_leases (problem_id) WHERE state = 'active';
CREATE INDEX desk_leases_user ON desk_leases (user_id, created_at DESC);
CREATE INDEX desk_leases_recent ON desk_leases (created_at DESC);

-- 3. Votes: one per person and problem (people only; agent keys cannot vote).
CREATE TABLE problem_votes (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, problem_id)
);
CREATE INDEX problem_votes_problem ON problem_votes (problem_id, created_at);

-- The featured problem: chosen from the votes of the last 30 days, changed at most once a week (or by a moderator).
CREATE TABLE focus_history (
  id          bigserial PRIMARY KEY,
  problem_id  bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  votes       int NOT NULL DEFAULT 0,
  chosen_by   text NOT NULL DEFAULT 'votes' CHECK (chosen_by IN ('votes','moderator'))
);
CREATE UNIQUE INDEX focus_one_current ON focus_history ((true)) WHERE ended_at IS NULL;

ALTER TABLE problem_events DROP CONSTRAINT problem_events_type_check;
ALTER TABLE problem_events ADD CONSTRAINT problem_events_type_check CHECK (type IN (
  'lead.start','lead.update','lead.close','lead.stale','lead.join',
  'idea','promising','dead-end','question','reply','note.merge',
  'record','verified','brick','round.open','round.summary','statement.version',
  'critique','critique.resolve',
  'lemma','lemma.proved','lemma.used',
  'upstream','desk.take','desk.release','focus'));
