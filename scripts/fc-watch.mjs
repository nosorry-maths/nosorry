// Check formal-conjectures main now (the worker does it once a day): apply metadata/status changes, list the rest.
//   node scripts/fc-watch.mjs            check and apply
//   node scripts/fc-watch.mjs --report   show the stored state, no network
import pg from "pg";
import { checkUpstream } from "../shared/fc-upstream.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry", max: 2 });
try {
  if (!process.argv.includes("--report")) await checkUpstream(pool, console.log);
  const { rows: [s] } = await pool.query("SELECT base_commit, head_commit, ahead_by, base_toolchain, head_toolchain, checked_at, ok, summary FROM fc_upstream");
  console.log(s);
  console.table((await pool.query("SELECT kind, slug, detail FROM fc_pending ORDER BY kind, slug LIMIT 60")).rows);
} finally { await pool.end(); }
