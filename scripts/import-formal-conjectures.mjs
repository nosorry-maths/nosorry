// Imports (or re-syncs) problems from a local checkout of google-deepmind/formal-conjectures.
//   node scripts/import-formal-conjectures.mjs <path-to-checkout> [--dry]
//
// Idempotent: problems are matched by slug. If a statement file changed upstream, a new
// problem_version is created and every verified proof of that problem is re-queued for verification
// against the new statement (points are revoked by the worker if it no longer matches).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { FIELDS, CATEGORIES, MSC, COLLECTIONS, COLLECTION_FIELD, categoryForMsc } from "../shared/taxonomy.mjs";
import { parseSource, semanticHash } from "../shared/fc-parse.mjs";
import { upstreamEvent } from "../shared/fc-upstream.mjs";

const root = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!root) { console.error("usage: import-formal-conjectures.mjs <checkout>"); process.exit(1); }
const toolchain = fs.readFileSync(path.join(root, "lean-toolchain"), "utf8").trim();
let commit = null;
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".lean")) yield p;
  }
}

// The parser is shared with the daily upstream watcher (shared/fc-upstream.mjs).
function parseFile(file) {
  return parseSource(fs.readFileSync(file, "utf8"), path.relative(root, file).replaceAll("\\", "/"));
}
const problems = [];
for (const f of walk(path.join(root, "FormalConjectures"))) problems.push(...parseFile(f));
const seen = new Set();
const uniq = problems.filter((p) => (seen.has(p.slug) ? false : seen.add(p.slug)));
const byStatus = uniq.reduce((a, p) => ((a[p.status] = (a[p.status] ?? 0) + 1), a), {});
console.log(`parsed ${uniq.length} declarations`, byStatus, "toolchain", toolchain, "commit", commit?.slice(0, 8));
if (DRY) { for (const p of uniq.filter((x) => x.slug.startsWith("erdos-488") || x.slug.startsWith("erdos-1196") || x.rel.includes("0805.3777")).slice(0, 6)) console.log(p.slug, "|", p.decl, "|", p.status, p.ams, p.tags, "|", (p.doc ?? "").slice(0, 80), "|", p.statement.slice(0, 80)); process.exit(0); }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await client.connect();
await client.query("BEGIN");

// taxonomy
let order = 0;
for (const f of FIELDS) await client.query(
  `INSERT INTO subjects(code,name,parent,level,description,sort_order) VALUES ($1,$2,NULL,1,$3,$4)
   ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description`, [f.code, f.name, f.note ?? null, order++]);
for (const [code, name] of Object.entries(CATEGORIES)) await client.query(
  `INSERT INTO subjects(code,name,parent,level,sort_order) VALUES ($1,$2,$3,2,$4) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name`,
  [code, name, code.split(".")[0], order++]);
for (const [code, [name, cat]] of Object.entries(MSC)) await client.query(
  `INSERT INTO subjects(code,name,parent,level,sort_order) VALUES ($1,$2,$3,3,$4) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, parent=EXCLUDED.parent`,
  [`msc:${code}`, name, cat, Number(code)]);
for (const [slug, name, url] of Object.values(COLLECTIONS)) await client.query(
  `INSERT INTO collections(slug,name,source_url) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name`, [slug, name, url]);

let created = 0, updated = 0, reverify = 0;
for (const p of uniq) {
  const cats = [...new Set(p.ams.map(categoryForMsc))];
  const override = COLLECTION_FIELD[p.coll[0]];
  const subjects = [...(override ? [override.primary] : []), ...cats, ...p.ams.filter((a) => MSC[a]).map((a) => `msc:${a}`)];
  const primary = override?.primary ?? cats[0] ?? "math.GM";
  const field = override?.field ?? "math";
  const hash = sha(p.src);
  const sem = semanticHash(p.src, p.decl);
  const tags = [...p.tags, ...(p.needsAnswer ? ["answer-required"] : [])];
  const { rows: [ex] } = await client.query(
    `SELECT pr.id, pr.status AS old_status, v.statement_hash, v.semantic_hash, v.version FROM problems pr LEFT JOIN problem_versions v ON v.id = pr.current_version_id WHERE pr.slug=$1`, [p.slug]);
  let pid;
  if (!ex) {
    const { rows: [r] } = await client.query(
      `INSERT INTO problems(ident, slug, collection, title, statement_md, status, primary_subject, subjects, tags, source_url, source_path, needs_answer, statement_status, field, license, attribution)
       VALUES ('tmp-'||md5(random()::text), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reviewed',$12,'Apache-2.0','google-deepmind/formal-conjectures contributors') RETURNING id`,
      [p.slug, p.coll[0], p.title, p.doc, p.status, primary, subjects, tags, p.refUrl, p.rel, p.needsAnswer, field]);
    pid = r.id;
    await client.query(`UPDATE problems SET ident = 'NS.' || lpad(id::text, 5, '0') WHERE id=$1`, [pid]);
    created++;
  } else {
    pid = ex.id;
    await client.query(
      `UPDATE problems SET title=$2, statement_md=$3, status = CASE WHEN status='withdrawn' THEN status ELSE $4 END,
         primary_subject=$5, subjects=$6, tags=$7, source_url=$8, source_path=$9, needs_answer=$10, field=$11,
         license='Apache-2.0', attribution='google-deepmind/formal-conjectures contributors', updated_at=now() WHERE id=$1`,
      [pid, p.title, p.doc, p.status, primary, subjects, tags, p.refUrl, p.rel, p.needsAnswer, field]);
    if (ex.old_status !== p.status && ex.old_status !== "withdrawn") await upstreamEvent(client, pid, ex.old_status, p.status, commit);
    // A new statement version only when what the statement depends on changed (not a comment, a status, a variant).
    if (ex.statement_hash === hash || (sem && ex.semantic_hash === sem)) {
      if (sem && !ex.semantic_hash) await client.query("UPDATE problem_versions v SET semantic_hash=$2 FROM problems p WHERE p.id=$1 AND v.id=p.current_version_id", [pid, sem]);
      continue;
    }
    updated++;
  }
  const version = (ex?.version ?? 0) + 1;
  const { rows: [v] } = await client.query(
    `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, semantic_hash, toolchain, upstream_commit, change_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [pid, version, p.decl, p.src, p.statement, hash, sem, toolchain, commit, ex ? "upstream statement changed" : "initial import"]);
  await client.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [pid, v.id]);
  if (ex) {
    // Re-check proofs of the old statement against the new one.
    const { rows } = await client.query(
      `UPDATE submissions SET problem_version_id=$2, status='queued'
       WHERE problem_id=$1 AND kind IN ('proof','disproof','partial') AND status IN ('verified','partial','needs_review') RETURNING id`, [pid, v.id]);
    if (rows.length) await client.query("UPDATE problems SET statement_status='disputed', recheck_pending=true WHERE id=$1", [pid]);
    for (const s of rows) await client.query("INSERT INTO jobs(kind, submission_id, priority) VALUES ('reverify',$1,50)", [s.id]);
    reverify += rows.length;
  }
}
// variants point at their main problem
await client.query(`UPDATE problems c SET variant_of = m.id, variant_label = split_part(c.slug, '--', 2)
                    FROM problems m WHERE c.slug LIKE m.slug || '--%' AND c.variant_of IS NULL`);
await client.query(`UPDATE problems p SET search_text = ns_fold(p.title || ' ' || p.slug || ' ' || p.ident || ' ' || coalesce(v.decl_name, '') || ' ' || coalesce(p.statement_md, ''))
                    FROM problem_versions v WHERE v.id = p.current_version_id`);
await client.query(`UPDATE problems SET search = setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                    setweight(to_tsvector('english', coalesce(statement_md,'')), 'B') ||
                    setweight(to_tsvector('simple', coalesce(slug,'')), 'A')`);
// This commit is now the base the daily watcher compares main with; its pending list is recomputed on the next check.
if (commit) {
  await client.query(`INSERT INTO fc_upstream(id, base_commit, base_toolchain, checked_at, ok) VALUES (1,$1,$2,NULL,NULL)
    ON CONFLICT (id) DO UPDATE SET base_commit=$1, base_toolchain=$2, checked_at=NULL, ok=NULL`, [commit, toolchain]);
  await client.query("DELETE FROM fc_pending");
}
await client.query("COMMIT");
await client.query("REFRESH MATERIALIZED VIEW leaderboard");
await client.end();
console.log({ created, updated, reverify });
