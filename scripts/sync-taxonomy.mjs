// Upserts fields, categories and MSC classes from shared/taxonomy.mjs, removes categories no longer listed
// (only if no problem uses them), and applies collection → field overrides (e.g. OpenQuantumProblems → physics).
//   node scripts/sync-taxonomy.mjs
import pg from "pg";
import { FIELDS, CATEGORIES, MSC, COLLECTION_FIELD } from "../shared/taxonomy.mjs";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();
await c.query("BEGIN");
let order = 0;
for (const f of FIELDS) await c.query(
  `INSERT INTO subjects(code,name,parent,level,description,sort_order) VALUES ($1,$2,NULL,1,$3,$4)
   ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order`, [f.code, f.name, f.note ?? null, order++]);
for (const [code, name] of Object.entries(CATEGORIES)) await c.query(
  `INSERT INTO subjects(code,name,parent,level,sort_order) VALUES ($1,$2,$3,2,$4)
   ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, parent=EXCLUDED.parent, sort_order=EXCLUDED.sort_order`, [code, name, code.split(".")[0], order++]);
for (const [code, [name, cat]] of Object.entries(MSC)) await c.query(
  `INSERT INTO subjects(code,name,parent,level,sort_order) VALUES ($1,$2,$3,3,$4) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, parent=EXCLUDED.parent`,
  [`msc:${code}`, name, cat, Number(code)]);
const keep = [...FIELDS.map((f) => f.code), ...Object.keys(CATEGORIES)];
const { rowCount } = await c.query(
  `DELETE FROM subjects s WHERE s.level IN (1,2) AND NOT (s.code = ANY($1))
   AND NOT EXISTS (SELECT 1 FROM problems p WHERE s.code = ANY(p.subjects) OR p.primary_subject = s.code)
   AND NOT EXISTS (SELECT 1 FROM subjects k WHERE k.parent = s.code)`, [keep]);
for (const [coll, { field, primary }] of Object.entries(COLLECTION_FIELD)) {
  const r = await c.query(
    `UPDATE problems SET field=$2, primary_subject=$3,
       subjects = ARRAY[$3::text] || array_remove(subjects, $3::text)
     WHERE collection=$1 AND (field <> $2 OR primary_subject <> $3)`, [coll, field, primary]);
  console.log(`collection ${coll}: ${r.rowCount} problems → ${field} / ${primary}`);
}
await c.query("COMMIT");
await c.end();
console.log(`taxonomy synced (${rowCount} obsolete categories removed)`);
