-- Community research: each person can attach one public research thread (a repository + a progress summary)
-- to a problem, and keep it up to date. Not scored: it is about sharing directions, not points.
CREATE TABLE research_threads (
  id          bigserial PRIMARY KEY,
  problem_id  bigint NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id),
  repo_url    text NOT NULL CHECK (repo_url ~ '^https://(github\.com|gitlab\.com|codeberg\.org)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[^\s]*)?$'),
  summary_md  text NOT NULL CHECK (char_length(summary_md) BETWEEN 30 AND 20000),
  approach    text CHECK (char_length(approach) <= 200),       -- one line: "computer search up to 10^9", "reduction to Lemma 3"…
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','abandoned','done','hidden')),
  open_to_collaborators boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  hidden_by   bigint REFERENCES users(id),
  UNIQUE (problem_id, user_id)
);
CREATE INDEX ON research_threads(problem_id, status);
CREATE INDEX ON research_threads(updated_at DESC);

-- Optional repository link on any submission (findings especially).
ALTER TABLE submissions ADD COLUMN repo_url text
  CHECK (repo_url IS NULL OR repo_url ~ '^https://(github\.com|gitlab\.com|codeberg\.org)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[^\s]*)?$');
