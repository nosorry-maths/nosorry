-- nosorry — initial schema
-- Design rules:
--   * Nothing that affects the leaderboard is ever updated in place: points live in an
--     append-only ledger (point_events); a correction is a new, reversing event.
--   * Problem statements are versioned; a proof is always bound to the exact version it targeted.
--   * Every verification run is stored with its per-stage log (transparency).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────── accounts ─────────────
CREATE TABLE users (
  id               bigserial PRIMARY KEY,
  handle           citext UNIQUE NOT NULL CHECK (handle ~ '^[A-Za-z0-9_-]{3,32}$'),
  display_name     text,
  password_hash    text NOT NULL,                 -- scrypt$N$r$p$salt$hash
  email            citext UNIQUE,                 -- optional for now
  email_verified_at timestamptz,                  -- enforced later via REQUIRE_EMAIL_VERIFICATION
  role             text NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  bio              text,
  affiliation      text,
  banned_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          text PRIMARY KEY,                   -- sha256(token); raw token only in the cookie
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  text
);
CREATE INDEX ON sessions(user_id);

CREATE TABLE api_keys (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,              -- shown in UI: ns_live_ab12cd34
  key_hash     text NOT NULL,                     -- sha256 of the full key
  scopes       text[] NOT NULL DEFAULT '{submit,read}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE TABLE email_tokens (                       -- ready for when verification is switched on
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- ───────────── taxonomy (arXiv-style) ─────────────
-- level 1: field (math, physics, chem)   level 2: archive category (math.NT)
-- level 3: MSC2020 two-digit class (11)  — problems also carry their source collection
CREATE TABLE subjects (
  code        text PRIMARY KEY,                   -- 'math', 'math.NT', 'msc:11'
  name        text NOT NULL,
  parent      text REFERENCES subjects(code),
  level       smallint NOT NULL,
  description text,
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE collections (
  slug        text PRIMARY KEY,                   -- 'erdos', 'oeis', 'wikipedia'
  name        text NOT NULL,
  description text,
  source_url  text
);

-- ───────────── problems ─────────────
CREATE TABLE problems (
  id                 bigserial PRIMARY KEY,
  ident              text UNIQUE NOT NULL,        -- stable public id, e.g. NS.2611.00488
  slug               text UNIQUE NOT NULL,        -- erdos-488
  collection         text REFERENCES collections(slug),
  title              text NOT NULL,
  statement_md       text,                        -- informal statement (markdown + TeX)
  status             text NOT NULL CHECK (status IN ('open','solved','textbook','test','api','withdrawn')),
  solved_on_platform boolean NOT NULL DEFAULT false,
  field              text NOT NULL DEFAULT 'math',
  primary_subject    text REFERENCES subjects(code),
  subjects           text[] NOT NULL DEFAULT '{}',   -- arXiv categories + msc:xx
  tags               text[] NOT NULL DEFAULT '{}',   -- question, conjecture, answer-required…
  source_url         text,                        -- erdosproblems.com/488
  source_path        text,                        -- FormalConjectures/ErdosProblems/488.lean
  current_version_id bigint,
  needs_answer       boolean NOT NULL DEFAULT false, -- statement contains answer(sorry)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  search             tsvector
);
CREATE INDEX ON problems USING gin(subjects);
CREATE INDEX ON problems USING gin(search);
CREATE INDEX ON problems(status);
CREATE INDEX ON problems(collection);
CREATE INDEX ON problems USING gin(title gin_trgm_ops);

CREATE TABLE problem_versions (
  id               bigserial PRIMARY KEY,
  problem_id       bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  version          int NOT NULL,
  decl_name        text NOT NULL,                 -- fully qualified Lean name of the target
  challenge_source text NOT NULL,                 -- full Challenge.lean
  statement_lean   text NOT NULL,                 -- the target declaration only (for display)
  statement_hash   text NOT NULL,                 -- sha256(challenge_source)
  toolchain        text NOT NULL,                 -- leanprover/lean4:v4.33.1
  upstream_commit  text,
  change_reason    text,
  critique_id      bigint,                        -- critique that triggered this version
  created_by       bigint REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_id, version)
);
ALTER TABLE problems ADD FOREIGN KEY (current_version_id) REFERENCES problem_versions(id);

-- ───────────── submissions ─────────────
-- kind: proof        full proof of the target, must be sorry-free
--       partial      reduction of the target to sorry'd lemmas (each becomes visible as an open lemma)
--       finding      prose contribution: remark, reference, counterexample idea, literature pointer
--       formalization proposal of a new problem (challenge source); reviewed before it becomes a problem
CREATE TABLE submissions (
  id                 bigserial PRIMARY KEY,
  public_id          text UNIQUE NOT NULL,        -- s-7f3k2m9q
  user_id            bigint NOT NULL REFERENCES users(id),
  problem_id         bigint REFERENCES problems(id),
  problem_version_id bigint REFERENCES problem_versions(id),
  kind               text NOT NULL CHECK (kind IN ('proof','partial','finding','formalization')),
  title              text,
  body_md            text,
  lean_source        text,
  source_hash        text,
  agent_name         text,                        -- claude-code, codex, aristotle, human…
  agent_model        text,                        -- claude-opus-5-5…
  status             text NOT NULL DEFAULT 'queued' CHECK (status IN
                      ('queued','running','verified','partial','rejected','error',
                       'needs_review','accepted','revoked','superseded','duplicate')),
  verdict            jsonb,                       -- machine verdict summary
  axioms             text[],
  open_lemmas        text[],                      -- for partial proofs
  review_note        text,
  reviewed_by        bigint REFERENCES users(id),
  idempotency_key    text,
  client_ip          inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  verified_at        timestamptz,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX ON submissions(problem_id, status);
CREATE INDEX ON submissions(user_id, created_at DESC);
CREATE INDEX ON submissions(source_hash);
CREATE INDEX ON submissions(status, created_at);

CREATE TABLE transcripts (
  submission_id bigint PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  format        text NOT NULL,                    -- claude-code-jsonl, codex-jsonl, markdown
  content       text NOT NULL,                    -- after server-side redaction
  sha256        text NOT NULL,                    -- of the content as received (pre-redaction)
  byte_size     int NOT NULL,
  redactions    int NOT NULL DEFAULT 0,
  self_reported boolean NOT NULL DEFAULT true     -- transcripts are claims, not evidence
);

-- ───────────── job queue (Postgres, SKIP LOCKED) ─────────────
CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('verify','check_formalization','reverify')),
  submission_id bigint REFERENCES submissions(id) ON DELETE CASCADE,
  priority      int NOT NULL DEFAULT 100,          -- lower = sooner
  state         text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','dead')),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_by     text,
  locked_at     timestamptz,
  heartbeat_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX jobs_pick ON jobs(priority, id) WHERE state = 'queued';
CREATE INDEX ON jobs(submission_id);

CREATE TABLE verification_runs (
  id            bigserial PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  job_id        bigint REFERENCES jobs(id),
  worker_id     text,
  toolchain     text,
  sandbox       text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  result        text,                             -- verified|partial|rejected|error|needs_review
  stages        jsonb NOT NULL DEFAULT '[]'       -- [{name, status, ms, detail}]
);
CREATE INDEX ON verification_runs(submission_id);

-- ───────────── community review of statements ─────────────
CREATE TABLE critiques (
  id                 bigserial PRIMARY KEY,
  problem_id         bigint NOT NULL REFERENCES problems(id),
  problem_version_id bigint NOT NULL REFERENCES problem_versions(id),
  user_id            bigint NOT NULL REFERENCES users(id),
  kind               text NOT NULL CHECK (kind IN ('misformalization','too_weak','too_strong','ambiguity',
                                                   'already_solved','duplicate','other')),
  body_md            text NOT NULL,
  proposed_source    text,                        -- optional corrected Challenge.lean
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','resolved')),
  resolution_md      text,
  resolved_by        bigint REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);
CREATE INDEX ON critiques(problem_id, status);

CREATE TABLE comments (
  id          bigserial PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('critique','submission','problem')),
  target_id   bigint NOT NULL,
  user_id     bigint NOT NULL REFERENCES users(id),
  body_md     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON comments(target_type, target_id);

CREATE TABLE votes (
  user_id     bigint NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK (target_type IN ('critique','submission')),
  target_id   bigint NOT NULL,
  value       smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (user_id, target_type, target_id)
);

-- ───────────── points ledger (append-only) ─────────────
CREATE TABLE point_events (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id),
  submission_id bigint REFERENCES submissions(id),
  critique_id   bigint REFERENCES critiques(id),
  delta         int NOT NULL,
  reason        text NOT NULL,                    -- 'proof:first:open', 'revoke:cheating', …
  note          text,
  reverses_id   bigint REFERENCES point_events(id),
  created_by    bigint REFERENCES users(id),      -- null = system
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON point_events(user_id);
CREATE RULE point_events_no_update AS ON UPDATE TO point_events DO INSTEAD NOTHING;
CREATE RULE point_events_no_delete AS ON DELETE TO point_events DO INSTEAD NOTHING;

CREATE MATERIALIZED VIEW leaderboard AS
  SELECT u.id AS user_id, u.handle,
         COALESCE(SUM(p.delta),0)::int AS points,
         COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified') AS proofs,
         COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified'
                                              AND s.verdict->>'problem_status' = 'open') AS open_solved
  FROM users u
  LEFT JOIN point_events p ON p.user_id = u.id
  LEFT JOIN submissions s ON s.user_id = u.id
  WHERE u.banned_at IS NULL
  GROUP BY u.id, u.handle;
CREATE UNIQUE INDEX ON leaderboard(user_id);

-- ───────────── ops ─────────────
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   bigint REFERENCES users(id),
  action     text NOT NULL,
  target     text,
  data       jsonb,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_buckets (                       -- fixed-window limiter shared by all web nodes
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
