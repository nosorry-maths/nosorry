-- The book also lists RESULTS: notable theorems proved in external Lean repositories (statement, declaration, file,
-- commit, Lean/Mathlib version, port status to the verifier's toolchain). It is the searchable start of a shared
-- library; nothing here is compiled into the verifier.
ALTER TABLE book_entries ADD COLUMN kind text NOT NULL DEFAULT 'method' CHECK (kind IN ('method','result')),
                         ADD COLUMN meta jsonb NOT NULL DEFAULT '{}';
CREATE INDEX book_entries_kind ON book_entries (kind);

CREATE OR REPLACE FUNCTION book_entry_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := ns_fold(NEW.slug || ' ' || NEW.title || ' ' || NEW.problem_md || ' ' || NEW.method_md || ' ' ||
    coalesce(NEW.lean, '') || ' ' || array_to_string(NEW.tags, ' ') || ' ' || array_to_string(NEW.keywords, ' ') || ' ' ||
    coalesce(NEW.meta->>'decl', '') || ' ' || coalesce(NEW.meta->>'repo', '') || ' ' || coalesce(NEW.source_name, ''));
  NEW.updated_at := now();
  RETURN NEW;
END $$;
UPDATE book_entries SET slug = slug;
