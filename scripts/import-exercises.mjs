// Imports a set of *exercises* (solved, textbook-level statements: physics benchmarks and the like) from a manifest.
//   node scripts/import-exercises.mjs <manifest.json> [--dry]
//
// Manifest:
// {
//   "collection": "leanphysbench", "name": "LeanPhysBench", "source_url": "https://github.com/…",
//   "license": "Apache-2.0",                       // REQUIRED: an open licence that allows redistribution…
//   "permission": "docs/permissions/leanphysbench.md", // …or a file recording the authors' written permission
//   "attribution": "Li et al., Lean4Physics (ICLR 2026)",
//   "field": "physics", "category": "physics.class-ph",
//   "workspace": "leanphysbench",                  // prebuilt Lean workspace (own toolchain + libraries) that verifies them
//   "toolchain": "leanprover/lean4:v4.x.y",
//   "synthetic_needs_review": true,                // machine-generated statements stay draft until reviewed
//   "items": [ { "id": "…", "title": "…", "statement_md": "…", "lean_source": "…", "decl": "Ns.thm", "synthetic": false } ]
// }
// Reference solutions are never imported (they would leak to agents). Items are tagged "exercise" and scored at the
// textbook tier; they are kept out of the research listings.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { CATEGORIES } from "../shared/taxonomy.mjs";

const OPEN_LICENCES = ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "CC-BY-4.0", "CC0-1.0", "LGPL-3.0", "MPL-2.0"];
const file = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!file) { console.error("usage: import-exercises.mjs <manifest.json> [--dry]"); process.exit(1); }
const m = JSON.parse(fs.readFileSync(file, "utf8"));

const fail = (msg) => { console.error(`refused: ${msg}`); process.exit(2); };
if (!m.collection || !/^[a-z0-9-]{2,40}$/.test(m.collection)) fail("collection slug missing or invalid");
const licensed = OPEN_LICENCES.includes(m.license);
const permitted = m.permission && fs.existsSync(path.resolve(m.permission)) && fs.readFileSync(path.resolve(m.permission), "utf8").trim().length > 50;
if (!licensed && !permitted)
  fail(`"${m.collection}" has no open licence (${m.license ?? "none"}) and no recorded permission. Ask the authors first; a dataset without a licence cannot be redistributed.`);
if (!CATEGORIES[m.category]) fail(`unknown category ${m.category}`);
if (!m.workspace || !/^[a-z0-9-]{2,40}$/.test(m.workspace)) fail("workspace missing: exercises must say which prebuilt Lean workspace verifies them");
if (!Array.isArray(m.items) || !m.items.length) fail("no items");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const bad = m.items.filter((x) => !x.id || !x.lean_source || !x.decl || !/\bsorry\b/.test(x.lean_source) || /import\s+SciLean/.test(x.lean_source));
if (bad.length) fail(`${bad.length} items without id/decl/lean_source, without a sorry'd target, or importing SciLean (first: ${bad[0].id ?? "?"})`);
console.log(`${m.name}: ${m.items.length} exercises, licence ${m.license ?? "by permission"}, workspace ${m.workspace}`);
if (DRY) process.exit(0);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();
await c.query("BEGIN");
await c.query(`INSERT INTO collections(slug,name,description,source_url) VALUES ($1,$2,$3,$4)
               ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, source_url=EXCLUDED.source_url`,
  [m.collection, m.name, `Exercises: ${m.attribution ?? m.name}`, m.source_url ?? null]);
let created = 0;
for (const x of m.items) {
  const slug = `${m.collection}-${String(x.id).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 90);
  const draft = x.synthetic && m.synthetic_needs_review !== false;
  const { rows: [p] } = await c.query(
    `INSERT INTO problems(ident, slug, collection, title, statement_md, status, field, primary_subject, subjects, tags, source_url,
       statement_status, verification, license, attribution)
     VALUES ('tmp-'||md5(random()::text), $1,$2,$3,$4,'textbook',$5,$6,$7,$8,$9,$10,'lean-kernel',$11,$12)
     ON CONFLICT (slug) DO NOTHING RETURNING id`,
    [slug, m.collection, x.title ?? x.id, x.statement_md ?? null, m.field ?? "physics", m.category, [m.category],
     ["exercise", ...(x.synthetic ? ["synthetic"] : [])], m.source_url ?? null, draft ? "draft" : "reviewed",
     m.license ?? "by permission", m.attribution ?? m.name]);
  if (!p) continue;
  await c.query("UPDATE problems SET ident='NS.' || lpad(id::text,5,'0') WHERE id=$1", [p.id]);
  const short = x.decl.split(".").pop();
  const i = x.lean_source.search(new RegExp(`\\b(theorem|lemma)\\s+(\\S+\\.)?${short}\\b`));
  const { rows: [v] } = await c.query(
    `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, workspace, change_reason)
     VALUES ($1,1,$2,$3,$4,$5,$6,$7,'initial import') RETURNING id`,
    [p.id, x.decl, x.lean_source, i >= 0 ? x.lean_source.slice(i).split(/:=/)[0].trim() : x.decl, sha(x.lean_source), m.toolchain ?? "unknown", m.workspace]);
  await c.query(`UPDATE problems SET current_version_id=$2, search_text=ns_fold(title || ' ' || slug || ' ' || ident || ' ' || $3 || ' ' || coalesce(statement_md,'')) WHERE id=$1`, [p.id, v.id, x.decl]);
  created++;
}
await c.query("COMMIT");
await c.end();
console.log({ created });
