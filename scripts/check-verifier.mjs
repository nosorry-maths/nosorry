#!/usr/bin/env node
// Read-only check of the verifier sandboxes: for each Lean workspace, compile the CURRENT reference statement of a few
// real problems inside its image, exactly as the worker does (no network, read-only, nobody user). Writes nothing to
// the database, so it is safe while agents are working.
//   node scripts/check-verifier.mjs [--per-workspace 3]
import pg from "pg";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const N = Number(process.argv[process.argv.indexOf("--per-workspace") + 1]) || 3;
const IMAGES = { "formal-conjectures": "nosorry-verifier:fc", core: "nosorry-verifier:core", ...JSON.parse(process.env.VERIFIER_IMAGES ?? "{}") };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
const { rows } = await db.query(`
  SELECT * FROM (
    SELECT p.slug, coalesce(v.workspace, 'formal-conjectures') AS ws, v.challenge_source,
           row_number() OVER (PARTITION BY coalesce(v.workspace, 'formal-conjectures') ORDER BY random()) AS rn
    FROM problems p JOIN problem_versions v ON v.id = p.current_version_id
    WHERE p.formalization = 'formal' AND v.challenge_source IS NOT NULL) x
  WHERE rn <= $1 ORDER BY ws`, [N]);
// Always include a problem that imports another problem file, if any (the image must prebuild those too).
const { rows: extra } = await db.query(`
  SELECT p.slug, coalesce(v.workspace, 'formal-conjectures') AS ws, v.challenge_source FROM problems p JOIN problem_versions v ON v.id = p.current_version_id
  WHERE v.challenge_source ~ 'import FormalConjectures[.]' ORDER BY random() LIMIT 1`);
await db.end();

let failed = 0;
for (const r of [...rows, ...extra]) {
  const image = IMAGES[r.ws];
  if (!image) { console.log(`  FAIL  ${r.ws}/${r.slug}: no image configured for workspace "${r.ws}"`); failed++; continue; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nscheck-"));
  fs.writeFileSync(path.join(dir, "Challenge.lean"), r.challenge_source);
  const t0 = Date.now();
  const res = spawnSync("docker", ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--tmpfs", "/tmp", "--user", "65534:65534",
    "-v", `${dir}:/job/src:ro`, image, "/usr/local/bin/ns-run", "lean", "/job/src/Challenge.lean"],
    { encoding: "utf8", timeout: 600_000, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const out = (res.stdout + res.stderr).trim();
  // A reference statement compiles with "declaration uses 'sorry'" warnings and no error.
  const ok = res.status === 0 && !/error:/.test(out);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${r.ws}/${r.slug} on ${image} (${((Date.now() - t0) / 1000).toFixed(1)} s)${ok ? "" : "\n        " + out.split("\n").slice(0, 4).join("\n        ")}`);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} reference statement(s) do not compile in their sandbox` : "\nall sampled reference statements compile in their sandbox");
process.exit(failed ? 1 : 0);
