-- Following formal-conjectures automatically.
--  * problem_versions.semantic_hash: fingerprint of what the statement depends on (shared/fc-parse.mjs statementKey),
--    used instead of the whole-file hash to decide whether an upstream edit is a new statement version.
--    Filled by scripts/backfill-semantic-hash.mjs.
--  * fc_upstream: state of the daily watcher (shared/fc-upstream.mjs).
--  * fc_pending: upstream changes that need a verifier image built from the newer commit (new problems, changed
--    statements, removed problems, toolchain bump). They are applied by the batch update, never by the watcher.
ALTER TABLE problem_versions ADD COLUMN semantic_hash text;

CREATE TABLE fc_upstream (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_commit   text,          -- the commit our statements and the verifier image come from
  head_commit   text,          -- formal-conjectures main at the last check
  head_date     timestamptz,
  ahead_by      int,
  base_toolchain text,
  head_toolchain text,
  checked_at    timestamptz,
  ok            boolean,
  summary       jsonb
);

CREATE TABLE fc_pending (
  slug        text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('new', 'statement', 'removed')),
  problem_id  bigint REFERENCES problems(id) ON DELETE CASCADE,
  path        text NOT NULL,
  title       text,
  status      text,
  detail      text,
  head_commit text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  seen_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE problem_events DROP CONSTRAINT problem_events_type_check;
ALTER TABLE problem_events ADD CONSTRAINT problem_events_type_check CHECK (type IN (
  'lead.start','lead.update','lead.close','lead.stale','lead.join',
  'idea','promising','dead-end','question','reply','note.merge',
  'record','verified','brick','round.open','round.summary','statement.version',
  'critique','critique.resolve',
  'lemma','lemma.proved','lemma.used',
  'upstream'));
