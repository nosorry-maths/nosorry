-- Review model informed by docs/veille-ia-maths.md:
-- a wrong *statement* is the main risk, so statements carry their own review state,
-- and "proved in Lean" is split into independent badges.

ALTER TABLE problems
  ADD COLUMN statement_status text NOT NULL DEFAULT 'draft'
    CHECK (statement_status IN ('draft','reviewed','disputed','frozen')),
  ADD COLUMN variant_of bigint REFERENCES problems(id),     -- weak/strong formal variants of one informal problem
  ADD COLUMN variant_label text;                            -- 'main', 'weaker: A finite', …

ALTER TABLE submissions
  ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  ADD COLUMN explanation_md text,          -- short human explanation, required to publish a proof
  ADD COLUMN novelty text NOT NULL DEFAULT 'unknown'
    CHECK (novelty IN ('unknown','novel','literature','rediscovery')),
  ADD COLUMN derived_from text,            -- declared prior work / other submission ids / URLs
  ADD COLUMN proof_fingerprint text,       -- hash of normalized proof source, for duplicate/plagiarism detection
  -- Badges (null = not yet assessed):
  ADD COLUMN badge_compiles boolean,       -- Lean accepts it under the pinned toolchain
  ADD COLUMN badge_axioms boolean,         -- only standard axioms
  ADD COLUMN badge_statement boolean,      -- proves exactly the reference statement (comparator)
  ADD COLUMN badge_faithful boolean;       -- formal statement matches the informal one (human review, per version)

CREATE INDEX ON submissions(proof_fingerprint);

ALTER TABLE transcripts
  ADD COLUMN captured_by text NOT NULL DEFAULT 'client' CHECK (captured_by IN ('client','platform')),
  ADD COLUMN signature text;               -- HMAC over sha256 when captured through our MCP session

-- Statement review is recorded per version.
ALTER TABLE problem_versions
  ADD COLUMN reviewed_by bigint REFERENCES users(id),
  ADD COLUMN reviewed_at timestamptz;
