-- Points and proof counts were joined in one query, multiplying ledger rows. Aggregate separately.
DROP MATERIALIZED VIEW leaderboard;
CREATE MATERIALIZED VIEW leaderboard AS
  SELECT u.id AS user_id, u.handle,
         COALESCE(p.points, 0)::int AS points,
         COALESCE(s.proofs, 0)::int AS proofs,
         COALESCE(s.open_solved, 0)::int AS open_solved
  FROM users u
  LEFT JOIN (SELECT user_id, SUM(delta) AS points FROM point_events GROUP BY user_id) p ON p.user_id = u.id
  LEFT JOIN (
    SELECT s.user_id,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified') AS proofs,
           COUNT(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND pr.status='open') AS open_solved
    FROM submissions s JOIN problems pr ON pr.id = s.problem_id GROUP BY s.user_id
  ) s ON s.user_id = u.id
  WHERE u.banned_at IS NULL;
CREATE UNIQUE INDEX ON leaderboard(user_id);
