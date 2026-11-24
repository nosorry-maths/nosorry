-- Disproofs: a proof of the negation of the reference statement.
ALTER TABLE submissions DROP CONSTRAINT submissions_kind_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_kind_check CHECK (kind IN ('proof','disproof','partial','finding','formalization'));
ALTER TABLE problems ADD COLUMN resolution text CHECK (resolution IN ('proved','disproved'));
UPDATE problems SET resolution = 'proved' WHERE solved_on_platform;

-- Honest queue: workers report a heartbeat; "online" = heartbeat younger than 60 s.
CREATE TABLE workers (
  id           text PRIMARY KEY,
  sandbox      text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  current_job  bigint
);

-- Search: accent-insensitive token matching over title, slug, ident, declaration name and statement.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION ns_fold(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(public.unaccent('public.unaccent', coalesce(t, ''))) $$;
ALTER TABLE problems ADD COLUMN search_text text;
UPDATE problems p SET search_text = ns_fold(p.title || ' ' || p.slug || ' ' || p.ident || ' ' || coalesce(v.decl_name, '') || ' ' || coalesce(p.statement_md, ''))
FROM problem_versions v WHERE v.id = p.current_version_id;
CREATE INDEX problems_search_trgm ON problems USING gin (search_text gin_trgm_ops);

-- Critique decisions must be consistent: a resolution note cannot be attached to an open critique.
ALTER TABLE critiques ADD CONSTRAINT critiques_resolution_consistent CHECK (status <> 'open' OR resolution_md IS NULL);
