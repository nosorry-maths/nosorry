-- Repository submissions: a proof made of a whole Lake project (public GitHub repository at an exact commit), built and
-- checked on the GitHub verifier with the repository's own toolchain. lean_source then holds a short manifest.
ALTER TABLE submissions ADD COLUMN source_repo text, ADD COLUMN source_commit text, ADD COLUMN source_module text;
ALTER TABLE submissions ADD CONSTRAINT submissions_source_repo_shape CHECK (
  source_repo IS NULL OR (source_repo ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' AND source_commit ~ '^[0-9a-f]{40}$' AND source_module IS NOT NULL));