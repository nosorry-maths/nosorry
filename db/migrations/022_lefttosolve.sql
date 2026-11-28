-- Mirror of Left to Solve (lefttosolve.com, repository lefttosolve2/open-math-agents): its catalogue of problems and the
-- stream of results merged there (proofs, disproofs, reduction steps, statements found misstated), each with the link to
-- its pull request. Kept by shared/lefttosolve.mjs (stream every 10 minutes, catalogue once a day). These are results
-- checked by THAT site's CI against its own pinned statements, not nosorry verifications; pages say so.

CREATE TABLE lts_items (
  lts_id      text PRIMARY KEY,                 -- their problem id (formal-conjectures decl, oeis-a…, mo-…, X.R1.H2 for steps)
  title       text NOT NULL DEFAULT '',
  source      text,
  kind        text,                             -- open | known | warmup | unformalized … as they classify it
  excerpt     text,
  fields      text[] NOT NULL DEFAULT '{}',
  difficulty  int,
  solved      boolean NOT NULL DEFAULT false,
  claimed     boolean NOT NULL DEFAULT false,
  root_id     text NOT NULL,                    -- for a reduction step, the problem it ultimately serves; else lts_id
  problem_id  bigint REFERENCES problems(id) ON DELETE SET NULL,   -- the nosorry problem root_id maps to, if any
  match       text CHECK (match IN ('decl')),
  in_catalog  boolean NOT NULL DEFAULT false,   -- seen in their public catalogue (steps only appear in the stream)
  first_seen  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lts_items_problem ON lts_items (problem_id) WHERE problem_id IS NOT NULL;
CREATE INDEX lts_items_root ON lts_items (root_id);

CREATE TABLE lts_events (
  id          bigserial PRIMARY KEY,
  lts_id      text NOT NULL,
  outcome     text NOT NULL,                    -- open | known | warmup | step | pending | misstated (their vocabulary)
  polarity    text,                             -- proof | disproof
  handle      text,
  agent       text,
  model       text,
  pr_url      text NOT NULL,
  points      int,
  title       text,
  step        boolean NOT NULL DEFAULT false,
  created_at  timestamptz,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  problem_id  bigint REFERENCES problems(id) ON DELETE SET NULL,
  UNIQUE (lts_id, pr_url, outcome)
);
CREATE INDEX lts_events_problem ON lts_events (problem_id, created_at DESC) WHERE problem_id IS NOT NULL;
CREATE INDEX lts_events_created ON lts_events (created_at DESC);

CREATE TABLE lts_sync (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  stream_at   timestamptz,
  catalog_at  timestamptz,
  ok          boolean,
  summary     jsonb
);
