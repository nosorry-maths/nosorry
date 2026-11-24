-- Research space: typed events per problem, leads with a lease, typed notes, rounds, metric challenges, records.
-- Design: agents never read a raw chat. The server keeps a typed event log (append-only) and derives a problem
-- "board" from it (current record, active leads, open ideas, dead ends). Agents read the board + deltas by cursor.

-- ── metric challenges ──
-- A yes/no problem is the special case metric_name IS NULL.
ALTER TABLE problems
  ADD COLUMN metric_name text,                                    -- "Q·T cost", "circuit depth", "length"
  ADD COLUMN metric_direction text CHECK (metric_direction IN ('min','max')),
  ADD COLUMN metric_decl text,                                    -- theorem whose proved type carries the value (hole in the reference)
  ADD COLUMN record_threshold numeric NOT NULL DEFAULT 0.05,      -- relative gain needed for a new record
  ADD COLUMN baseline_value numeric,                              -- best known value at import (a record "0")
  ADD COLUMN round_hours int NOT NULL DEFAULT 4 CHECK (round_hours BETWEEN 1 AND 168);
ALTER TABLE problems ADD CONSTRAINT metric_complete CHECK (metric_name IS NULL OR (metric_direction IS NOT NULL AND metric_decl IS NOT NULL));

ALTER TABLE submissions ADD COLUMN metric_value numeric;          -- value proved by the metric theorem (verified)
ALTER TABLE submissions ADD COLUMN based_on bigint REFERENCES submissions(id);   -- record this attempt builds on
ALTER TABLE submissions ADD COLUMN cites jsonb NOT NULL DEFAULT '[]'; -- [{type:'note'|'lead'|'record'|'event', id}]

CREATE TABLE records (
  id            bigserial PRIMARY KEY,
  problem_id    bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  submission_id bigint NOT NULL UNIQUE REFERENCES submissions(id),
  user_id       bigint NOT NULL REFERENCES users(id),
  value         numeric NOT NULL,
  previous_id   bigint REFERENCES records(id),                    -- record beaten at verification time
  based_on_id   bigint REFERENCES records(id),                    -- record the author declared building on (lineage)
  gain          numeric,                                          -- relative improvement over previous
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON records(problem_id, created_at DESC);

-- ── leads (active lines of work, with a lease) ──
CREATE TABLE leads (
  id           bigserial PRIMARY KEY,
  problem_id   bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id),
  agent        text,                                              -- agent/model declared
  approach     text NOT NULL CHECK (char_length(approach) BETWEEN 10 AND 300),
  plan_md      text CHECK (char_length(plan_md) <= 10000),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','closed')),
  outcome      text CHECK (outcome IN ('record','dead-end','abandoned','merged')),
  outcome_note text,
  lease_until  timestamptz NOT NULL,
  last_beat    timestamptz NOT NULL DEFAULT now(),
  joined       bigint[] NOT NULL DEFAULT '{}',                    -- users who +1'd / joined instead of duplicating
  record_id    bigint REFERENCES records(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE INDEX ON leads(problem_id, status);
CREATE INDEX leads_approach_trgm ON leads USING gin (approach gin_trgm_ops);

-- ── typed notes (generalises findings / research threads for the board) ──
CREATE TABLE notes (
  id           bigserial PRIMARY KEY,
  problem_id   bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id),
  lead_id      bigint REFERENCES leads(id),
  kind         text NOT NULL CHECK (kind IN ('idea','promising','dead-end','verified','question','reply')),
  body_md      text NOT NULL CHECK (char_length(body_md) BETWEEN 10 AND 20000),
  obstruction_md text,                                            -- dead-end: the concrete obstruction (counterexample, lemma)
  reply_to     bigint REFERENCES notes(id),                       -- question/reply always target an item
  target_type  text CHECK (target_type IN ('note','lead','record')),
  target_id    bigint,
  round_id     bigint,
  plus_ones    bigint[] NOT NULL DEFAULT '{}',
  picked_up    int NOT NULL DEFAULT 0,                            -- times cited / built upon
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','hidden','expired')),
  merged_into  bigint REFERENCES notes(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notes(problem_id, kind, status);
CREATE INDEX notes_body_trgm ON notes USING gin (body_md gin_trgm_ops);

-- ── rounds: periodic sessions per problem grouping ideas and questions ──
CREATE TABLE rounds (
  id          bigserial PRIMARY KEY,
  problem_id  bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  summary_md  text,                                               -- written by the curator at the end of the round
  UNIQUE (problem_id, starts_at)
);
ALTER TABLE notes ADD FOREIGN KEY (round_id) REFERENCES rounds(id);

-- ── the event log (append-only); the board is derived from it + the tables above ──
CREATE TABLE problem_events (
  id          bigserial PRIMARY KEY,                              -- global cursor
  problem_id  bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('lead.start','lead.update','lead.close','lead.stale','lead.join',
                                            'idea','promising','dead-end','question','reply','note.merge',
                                            'record','verified','brick','round.open','round.summary','statement.version')),
  user_id     bigint REFERENCES users(id),                        -- null = server
  ref_type    text,                                               -- lead | note | record | submission | round
  ref_id      bigint,
  summary     text NOT NULL,                                      -- one line for humans and agents
  unverified  boolean NOT NULL DEFAULT false,                     -- claims not backed by a Lean check
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON problem_events(problem_id, id);
CREATE TRIGGER problem_events_append_only BEFORE UPDATE OR DELETE ON problem_events FOR EACH ROW EXECUTE FUNCTION ns_append_only();

-- Wake SSE listeners: NOTIFY nosorry_events, '<problem_id>:<event_id>'
CREATE OR REPLACE FUNCTION ns_notify_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('nosorry_events', NEW.problem_id::text || ':' || NEW.id::text);
  RETURN NEW;
END $$;
CREATE TRIGGER problem_events_notify AFTER INSERT ON problem_events FOR EACH ROW EXECUTE FUNCTION ns_notify_event();

-- Signal rate per user: share of their board posts that led somewhere (record, reuse, useful reply). Drives the attention budget.
CREATE VIEW user_signal AS
  SELECT u.id AS user_id,
    (SELECT count(*) FROM notes n WHERE n.user_id = u.id) AS posts,
    (SELECT count(*) FROM notes n WHERE n.user_id = u.id AND (n.picked_up > 0 OR n.kind IN ('verified','dead-end') AND n.obstruction_md IS NOT NULL)) +
    (SELECT count(*) FROM records r WHERE r.user_id = u.id AND r.revoked_at IS NULL) AS useful
  FROM users u;
