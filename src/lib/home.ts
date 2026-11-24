import { q, one } from "./db";

const NOT_DEMO = "NOT ('demo' = ANY(p.tags))";

/** Everything the home page charts need, in one round of queries. */
export async function homeCharts() {
  const [standing, daily, fields, recordHistory] = await Promise.all([
    // Where the research problems stand: open / answer known on paper / proved here.
    one<{ open: number; known: number; proved: number }>(`
      SELECT count(*) FILTER (WHERE status='open' AND NOT solved_on_platform)::int AS open,
             count(*) FILTER (WHERE status='solved' AND NOT solved_on_platform)::int AS known,
             count(*) FILTER (WHERE solved_on_platform)::int AS proved
      FROM problems p WHERE status = ANY('{open,solved}') AND variant_of IS NULL AND ${NOT_DEMO}`),
    // Checks run per day, last 30 days (all submissions, verified or not).
    q<{ day: string; checks: number; verified: number }>(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
             count(s.id)::int AS checks,
             count(s.id) FILTER (WHERE s.status IN ('verified','partial'))::int AS verified
      FROM generate_series((now() AT TIME ZONE 'utc')::date - 29, (now() AT TIME ZONE 'utc')::date, interval '1 day') d
      LEFT JOIN submissions s ON (s.created_at AT TIME ZONE 'utc')::date = d::date
      GROUP BY d ORDER BY d`),
    // Biggest research areas.
    q<{ code: string; name: string; n: number; open: number }>(`
      WITH c AS (
        SELECT unnest(subjects) AS code, count(*)::int AS n, count(*) FILTER (WHERE status='open')::int AS open
        FROM problems p WHERE status = ANY('{open,solved}') AND variant_of IS NULL AND ${NOT_DEMO} GROUP BY 1)
      SELECT c.code, s.name, c.n, c.open FROM c JOIN subjects s ON s.code=c.code
      WHERE s.level = 2 ORDER BY c.n DESC LIMIT 8`),
    // Record history of the most active metric challenge.
    q<{ slug: string; title: string; metric_name: string; direction: string; baseline: number | null; value: number; created_at: string; handle: string }>(`
      WITH ch AS (
        SELECT p.id, p.slug, p.title, p.metric_name, p.metric_direction, p.baseline_value
        FROM problems p WHERE p.metric_name IS NOT NULL
        ORDER BY (SELECT count(*) FROM records r WHERE r.problem_id=p.id AND r.revoked_at IS NULL) DESC, p.id LIMIT 1)
      SELECT ch.slug, ch.title, ch.metric_name, ch.metric_direction AS direction, ch.baseline_value::float8 AS baseline,
             r.value::float8 AS value, r.created_at, u.handle
      FROM ch JOIN records r ON r.problem_id=ch.id AND r.revoked_at IS NULL JOIN users u ON u.id=r.user_id ORDER BY r.created_at`),
  ]);
  return { standing: standing ?? { open: 0, known: 0, proved: 0 }, daily, fields, recordHistory };
}
