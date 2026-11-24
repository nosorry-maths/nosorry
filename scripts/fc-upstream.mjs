#!/usr/bin/env node
// Policy: nosorry follows formal-conjectures' Lean toolchain (it moves when they move). This read-only check compares
// what we run with formal-conjectures' main branch and the latest stable Lean, and says what an update would involve.
//   node scripts/fc-upstream.mjs
import fs from "node:fs";
import pg from "pg";

const gh = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "nosorry-upstream-check", accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return url.includes("raw.githubusercontent") ? (await r.text()).trim() : r.json();
};

const pinnedRev = fs.readFileSync(new URL("../Dockerfile.verifier", import.meta.url), "utf8").match(/ARG FC_REV=([0-9a-f]{40})/)?.[1];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
const { rows: [ours] } = await db.query(
  `SELECT string_agg(DISTINCT upstream_commit, ', ') AS commits, string_agg(DISTINCT toolchain, ', ') AS toolchains
   FROM problem_versions WHERE workspace = 'formal-conjectures'`);
await db.end();

const [head, fcToolchain, pinnedToolchain, lean] = await Promise.all([
  gh("https://api.github.com/repos/google-deepmind/formal-conjectures/commits/main"),
  gh("https://raw.githubusercontent.com/google-deepmind/formal-conjectures/main/lean-toolchain"),
  pinnedRev ? gh(`https://raw.githubusercontent.com/google-deepmind/formal-conjectures/${pinnedRev}/lean-toolchain`) : null,
  gh("https://api.github.com/repos/leanprover/lean4/releases/latest"),
]);
const behind = pinnedRev && pinnedRev !== head.sha
  ? (await gh(`https://api.github.com/repos/google-deepmind/formal-conjectures/compare/${pinnedRev}...${head.sha}`)).ahead_by : 0;

console.log(`formal-conjectures main : ${head.sha.slice(0, 12)} (${head.commit.committer.date.slice(0, 10)}), ${fcToolchain}`);
console.log(`verifier image pinned   : ${pinnedRev?.slice(0, 12) ?? "?"}, ${pinnedToolchain ?? "?"}  — ${behind} commit(s) behind main`);
console.log(`statements in database  : ${ours.commits?.slice(0, 80) ?? "none"}  (${ours.toolchains ?? "?"})`);
console.log(`latest stable Lean      : ${lean.tag_name} (${lean.published_at.slice(0, 10)})`);
console.log("");
if (fcToolchain !== pinnedToolchain) {
  console.log(`→ formal-conjectures moved to ${fcToolchain}. To follow: set FC_REV=${head.sha} in Dockerfile.verifier,`);
  console.log("  re-import statements (scripts/import-formal-conjectures.mjs: changed statements become new versions and their proofs are re-checked),");
  console.log("  regenerate worker/fc-modules.txt (scripts/fc-modules.mjs), rebuild nosorry-verifier:fc, run scripts/check-verifier.mjs.");
} else if (behind > 0) {
  console.log(`→ Same Lean as us. ${behind} newer commit(s) upstream (new problems, statement fixes): pick them up at the next image build.`);
} else {
  console.log("→ Up to date with formal-conjectures.");
}
if (fcToolchain.split(":")[1] !== lean.tag_name) console.log(`  (formal-conjectures is not on the latest Lean ${lean.tag_name} yet; nosorry waits for them.)`);
