-- A problem settled by a result verified on another platform counts as settled here too, with its origin shown.
-- Today the only such platform is Left to Solve (lefttosolve.com): a proof merged there against the SAME statement
-- (same formal-conjectures declaration, same semantic fingerprint of its statement) settles our problem.
--   external_resolution: proved | disproved, set by the mirror (shared/lefttosolve.mjs), cleared if the result goes away;
--   external_origin: { site, url (pull request), problem_url, handle, model, at, commit } for display and credit;
--   resolution / solved_on_platform keep their meaning "settled", and are coalesce(local proof, external result).
ALTER TABLE problems
  ADD COLUMN external_resolution text CHECK (external_resolution IN ('proved', 'disproved')),
  ADD COLUMN external_origin jsonb;

-- Statement comparison cache: does the statement pinned there (formal-conjectures at `commit`) have the same semantic
-- fingerprint as our statement version? Computed once per (version, commit).
CREATE TABLE lts_statement_checks (
  problem_version_id bigint NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
  commit      text NOT NULL,
  same        boolean,                 -- null: could not be compared (file or declaration not found there)
  note        text,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_version_id, commit)
);
