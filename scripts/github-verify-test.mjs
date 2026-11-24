// Run the Lean stages of an existing submission on GitHub Actions and compare with its local verdict. Read-only on our DB.
//   node scripts/github-verify-test.mjs <submission public id>
import pg from "pg";
import { runRemote } from "../worker/github-backend.mjs";

const id = process.argv[2];
if (!id) { console.error("usage: github-verify-test.mjs <s-…>"); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
const { rows: [s] } = await db.query(`SELECT s.id, s.public_id, s.kind, s.status, s.lean_source, v.challenge_source, v.decl_name, p.metric_decl
  FROM submissions s JOIN problem_versions v ON v.id=s.problem_version_id JOIN problems p ON p.id=s.problem_id WHERE s.public_id=$1`, [id]);
await db.end();
if (!s) { console.error("unknown submission"); process.exit(1); }
console.log(`${s.public_id}: ${s.kind}, local verdict ${s.status}, target ${s.decl_name}`);
const t0 = Date.now();
const r = await runRemote({ jobId: `test-${s.id}`, kind: s.kind, target: s.decl_name, metricDecl: s.metric_decl, challenge: s.challenge_source, solution: s.lean_source }, console.log);
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min (run ${r.run_seconds} s) — ${r.toolchain} fc ${String(r.fc_rev).slice(0, 8)}`);
for (const [k, v] of Object.entries(r.stages)) {
  console.log(`  ${k.padEnd(8)} exit ${v.code} ${(v.ms / 1000).toFixed(0)} s, memory peak ${v.mem_peak ?? "?"}${v.swap_peak ? `, swap peak ${v.swap_peak}` : ""}${v.timedOut ? " TIMEOUT" : ""}`);
  if (k === "compare" || v.code !== 0) console.log("    " + v.out.trim().split("\n").slice(-3).join("\n    ").slice(0, 1500));
}
