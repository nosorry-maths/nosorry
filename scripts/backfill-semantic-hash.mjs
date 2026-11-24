// Fill problem_versions.semantic_hash for formal-conjectures statements (see shared/fc-parse.mjs).
//   node scripts/backfill-semantic-hash.mjs [--dry] [--all]   fills empty ones (--all: recompute every one, after a
//   change of the fingerprint's definition in shared/fc-parse.mjs); safe to re-run
import pg from "pg";
import { semanticHash } from "../shared/fc-parse.mjs";

const DRY = process.argv.includes("--dry");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
const { rows } = await db.query(`SELECT v.id, v.decl_name, v.challenge_source FROM problem_versions v JOIN problems p ON p.id=v.problem_id
  WHERE (v.semantic_hash IS NULL OR $1) AND p.source_path LIKE 'FormalConjectures/%' AND v.challenge_source IS NOT NULL`, [process.argv.includes("--all")]);
let done = 0; const missing = [];
for (const r of rows) {
  const h = semanticHash(r.challenge_source, r.decl_name);
  if (!h) { missing.push(r.decl_name); continue; }
  if (!DRY) await db.query("UPDATE problem_versions SET semantic_hash=$2 WHERE id=$1", [r.id, h]);
  done++;
}
console.log({ versions: rows.length, hashed: done, not_found: missing.length, examples: missing.slice(0, 8) });
await db.end();
