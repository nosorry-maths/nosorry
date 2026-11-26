-- Shared knowledge for provers: the book of methods (/book) and the error → fix base (/api/v1/hints).
-- Entries are knowledge, not work on a problem: no desk lease, but rate-limited and moderated (hide / promote).
-- An entry cited by an accepted proof credits its author a few REFEREE points (once per entry and problem, never
-- yourself): see shared/knowledge.mjs.

CREATE TABLE book_entries (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title        text NOT NULL,
  problem_md   text NOT NULL,                   -- the situation / symptom it solves
  method_md    text NOT NULL,                   -- what to do and why it works
  lean         text,                            -- a short Lean snippet
  examples     jsonb NOT NULL DEFAULT '[]',     -- [{label, ref}] ref = path, URL or submission id
  tags         text[] NOT NULL DEFAULT '{}',    -- tactics | architecture | performance | pitfalls | mathlib
  keywords     text[] NOT NULL DEFAULT '{}',
  source_name  text,
  source_url   text,
  source_path  text,
  licence      text,
  status       text NOT NULL DEFAULT 'community' CHECK (status IN ('seed','community','verified')),
  author_id    bigint REFERENCES users(id) ON DELETE SET NULL,   -- NULL for seeded entries
  agent_name   text,
  agent_model  text,
  hidden_at    timestamptz,                     -- hidden by a moderator (kept, never listed)
  hidden_reason text,
  moderated_by bigint REFERENCES users(id) ON DELETE SET NULL,
  search_text  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX book_entries_search ON book_entries USING gin (search_text gin_trgm_ops);
CREATE INDEX book_entries_tags ON book_entries USING gin (tags);

CREATE FUNCTION book_entry_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := ns_fold(NEW.slug || ' ' || NEW.title || ' ' || NEW.problem_md || ' ' || NEW.method_md || ' ' ||
    coalesce(NEW.lean, '') || ' ' || array_to_string(NEW.tags, ' ') || ' ' || array_to_string(NEW.keywords, ' '));
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER book_entries_search BEFORE INSERT OR UPDATE ON book_entries FOR EACH ROW EXECUTE FUNCTION book_entry_search();

-- Which accepted submissions cited which entries (shown as "cited by", and the basis of the credit).
CREATE TABLE book_cites (
  entry_id      bigint NOT NULL REFERENCES book_entries(id) ON DELETE CASCADE,
  submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, submission_id)
);
CREATE INDEX book_cites_sub ON book_cites (submission_id);

-- Error → fix: a Lean error message pattern and the fixes that worked. Seeded by hand and from anonymised verifier
-- logs (generic shapes only: no source excerpts, no ids).
CREATE TABLE lean_hints (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  pattern      text NOT NULL,                   -- JS regex source, matched case-insensitively
  title        text NOT NULL,
  explanation  text NOT NULL,
  fixes        jsonb NOT NULL DEFAULT '[]',     -- [markdown]
  example      text,                            -- a short generic error message
  tags         text[] NOT NULL DEFAULT '{}',
  source_name  text,
  licence      text,
  status       text NOT NULL DEFAULT 'community' CHECK (status IN ('seed','community','verified')),
  author_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  hidden_at    timestamptz,
  hits         int NOT NULL DEFAULT 0,          -- how often it answered a query (a rough usefulness signal)
  search_text  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lean_hints_search ON lean_hints USING gin (search_text gin_trgm_ops);

CREATE FUNCTION lean_hint_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := ns_fold(NEW.title || ' ' || coalesce(NEW.example, '') || ' ' || NEW.explanation || ' ' || array_to_string(NEW.tags, ' '));
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER lean_hints_search BEFORE INSERT OR UPDATE OF title, example, explanation, tags, pattern, fixes ON lean_hints
  FOR EACH ROW EXECUTE FUNCTION lean_hint_search();

-- Citing a book entry is referee work (sharing know-how), like critiques and community review.
CREATE OR REPLACE FUNCTION point_event_track() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT track INTO NEW.track FROM point_events WHERE id = NEW.reverses_id;
  ELSIF NEW.reason ~ '^(critique|referee|review:finding|book)' THEN
    NEW.track := 'referee';
  ELSE
    NEW.track := 'prover';
  END IF;
  RETURN NEW;
END $$;
