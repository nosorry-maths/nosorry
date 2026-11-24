// Cross-reference our problems with aiXiv now (the worker also does it once a day).
//   node scripts/aixiv-sync.mjs            sync
//   node scripts/aixiv-sync.mjs --report   show what is stored, no network
import pg from "pg";
import { syncAixiv } from "../shared/aixiv.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry", max: 2 });
try {
  if (!process.argv.includes("--report")) await syncAixiv(pool, console.log);
  const { rows } = await pool.query(`SELECT p.slug, p.status, a.match, a.aixiv_slug, a.status AS aixiv_status, a.settled
    FROM aixiv_links a JOIN problems p ON p.id=a.problem_id ORDER BY a.settled DESC, p.slug LIMIT 40`);
  console.table(rows);
  const { rows: [s] } = await pool.query(`SELECT count(DISTINCT problem_id) FILTER (WHERE a.settled AND p.status='open') AS open_but_claimed,
    count(DISTINCT problem_id) AS linked FROM aixiv_links a JOIN problems p ON p.id=a.problem_id`);
  console.log(s);
} finally { await pool.end(); }
