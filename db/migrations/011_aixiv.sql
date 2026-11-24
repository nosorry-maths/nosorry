-- Cross-reference with aiXiv (aixiv.online): what that archive records about our problems (claims, partial results,
-- Lean formalizations). Rebuilt by the daily sync (shared/aixiv.mjs); these are claims, not nosorry verifications.
CREATE TABLE aixiv_links (
  problem_id  bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  aixiv_slug  text NOT NULL,
  match       text NOT NULL CHECK (match IN ('erdos', 'name')),
  name        text NOT NULL,
  url         text NOT NULL,
  status      text,
  status_text text,
  tracker     jsonb,
  results     jsonb NOT NULL DEFAULT '[]',
  settled     boolean NOT NULL DEFAULT false,
  latest      date,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, aixiv_slug)
);
CREATE INDEX aixiv_links_slug ON aixiv_links (aixiv_slug);
CREATE INDEX aixiv_links_settled ON aixiv_links (problem_id) WHERE settled;

CREATE TABLE aixiv_sync (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  started_at  timestamptz,
  finished_at timestamptz,
  ok          boolean,
  summary     jsonb
);
