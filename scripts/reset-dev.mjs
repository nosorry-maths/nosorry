// DEV ONLY: wipe all activity (submissions, jobs, points, critiques, audit, sessions, keys) but keep users and problems.
// The ledger is append-only by trigger, so this temporarily disables the triggers as the table owner.
//   node scripts/reset-dev.mjs
import pg from "pg";

if (process.env.NODE_ENV === "production") { console.error("refusing to reset in production"); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();
await c.query("BEGIN");
await c.query("ALTER TABLE point_events DISABLE TRIGGER USER");
await c.query("ALTER TABLE audit_log DISABLE TRIGGER USER");
await c.query("TRUNCATE point_events, audit_log, verification_runs, transcripts, jobs, comments, votes, critiques, submissions, sessions, api_keys, rate_buckets, workers RESTART IDENTITY CASCADE");
await c.query("ALTER TABLE point_events ENABLE TRIGGER USER");
await c.query("ALTER TABLE audit_log ENABLE TRIGGER USER");
// demo problem: back to its first statement version
await c.query(`UPDATE problems p SET current_version_id=(SELECT id FROM problem_versions WHERE problem_id=p.id AND version=1),
               solved_on_platform=false, resolution=NULL, statement_status='reviewed', recheck_pending=false WHERE 'demo' = ANY(p.tags)`);
await c.query(`DELETE FROM problem_versions v USING problems p WHERE v.problem_id=p.id AND 'demo' = ANY(p.tags) AND v.version > 1`);
await c.query("UPDATE problems SET solved_on_platform=false, resolution=NULL, recheck_pending=false");
await c.query("COMMIT");
await c.query("REFRESH MATERIALIZED VIEW leaderboard");
await c.end();
console.log("dev data reset (users and problems kept)");
