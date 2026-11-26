// Loads the seeded book entries and Lean hints (db/seed/knowledge/*.json) into the database. Idempotent: new slugs are
// inserted; a seeded row (no author) is updated when its content changed, keeping its status and moderation (hidden,
// verified). Entries written by members are never touched. Run by scripts/migrate.mjs after the migrations.
//   node scripts/seed-knowledge.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const TAGS = ["tactics", "architecture", "performance", "pitfalls", "mathlib"];
const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const dir = path.resolve("db/seed/knowledge");

export function loadSeeds() {
  const entries = [], hints = [], problems = [];
  if (!fs.existsSync(dir)) return { entries, hints, problems };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const list = Array.isArray(j) ? j : j.entries ?? j.hints ?? [];
    const kind = f.startsWith("hints") ? "hint" : "entry";
    for (const x of list) {
      const where = `${f}: ${x.slug}`;
      if (!SLUG.test(x.slug ?? "")) { problems.push(`${where}: bad slug`); continue; }
      if (kind === "hint") {
        try { new RegExp(x.pattern, "i"); } catch { problems.push(`${where}: bad pattern`); continue; }
        if (!x.title || !x.explanation || !Array.isArray(x.fixes) || !x.fixes.length) { problems.push(`${where}: missing field`); continue; }
        hints.push(x);
      } else {
        const tags = (x.tags ?? []).filter((t) => TAGS.includes(t));
        if (!x.title || !x.problem || !x.method_md || !tags.length) { problems.push(`${where}: missing field`); continue; }
        entries.push({ ...x, tags });
      }
    }
  }
  const dup = (xs) => xs.map((x) => x.slug).filter((s, i, a) => a.indexOf(s) !== i);
  for (const s of dup(entries)) problems.push(`duplicate entry slug ${s}`);
  for (const s of dup(hints)) problems.push(`duplicate hint slug ${s}`);
  return { entries, hints, problems };
}

export async function seedKnowledge(client, { dry = false } = {}) {
  const { entries, hints, problems } = loadSeeds();
  for (const p of problems) console.error("seed-knowledge: skipped", p);
  if (dry) return { entries: entries.length, hints: hints.length, problems: problems.length };
  let ins = 0, upd = 0;
  for (const e of entries) {
    const source = e.source ?? {};
    const vals = [e.slug, e.title.slice(0, 120), e.problem, e.method_md, e.lean ?? null, JSON.stringify(e.examples ?? []), e.tags.slice(0, 3),
      (e.keywords ?? []).map((k) => String(k).toLowerCase()).slice(0, 16), source.name ?? null, source.url ?? null, source.path ?? null, source.licence ?? null];
    const r = await client.query(
      `INSERT INTO book_entries(slug, title, problem_md, method_md, lean, examples, tags, keywords, source_name, source_url, source_path, licence, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'seed')
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, problem_md=EXCLUDED.problem_md, method_md=EXCLUDED.method_md, lean=EXCLUDED.lean,
         examples=EXCLUDED.examples, tags=EXCLUDED.tags, keywords=EXCLUDED.keywords, source_name=EXCLUDED.source_name, source_url=EXCLUDED.source_url,
         source_path=EXCLUDED.source_path, licence=EXCLUDED.licence
       WHERE book_entries.author_id IS NULL AND (book_entries.title, book_entries.problem_md, book_entries.method_md, coalesce(book_entries.lean,''),
         book_entries.examples::text, book_entries.tags, book_entries.keywords, coalesce(book_entries.source_path,''))
         IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.problem_md, EXCLUDED.method_md, coalesce(EXCLUDED.lean,''), EXCLUDED.examples::text, EXCLUDED.tags,
         EXCLUDED.keywords, coalesce(EXCLUDED.source_path,''))
       RETURNING (xmax = 0) AS inserted`, vals);
    if (r.rows[0]?.inserted) ins++; else if (r.rowCount) upd++;
  }
  let hins = 0, hupd = 0;
  for (const h of hints) {
    const r = await client.query(
      `INSERT INTO lean_hints(slug, pattern, title, explanation, fixes, example, tags, source_name, licence, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'seed')
       ON CONFLICT (slug) DO UPDATE SET pattern=EXCLUDED.pattern, title=EXCLUDED.title, explanation=EXCLUDED.explanation, fixes=EXCLUDED.fixes,
         example=EXCLUDED.example, tags=EXCLUDED.tags, source_name=EXCLUDED.source_name, licence=EXCLUDED.licence
       WHERE lean_hints.author_id IS NULL AND (lean_hints.pattern, lean_hints.title, lean_hints.explanation, lean_hints.fixes::text, coalesce(lean_hints.example,''), lean_hints.tags)
         IS DISTINCT FROM (EXCLUDED.pattern, EXCLUDED.title, EXCLUDED.explanation, EXCLUDED.fixes::text, coalesce(EXCLUDED.example,''), EXCLUDED.tags)
       RETURNING (xmax = 0) AS inserted`,
      [h.slug, h.pattern, h.title.slice(0, 120), h.explanation, JSON.stringify(h.fixes), h.example ?? null, (h.tags ?? []).slice(0, 4),
       h.source?.name ?? null, h.source?.licence ?? null]);
    if (r.rows[0]?.inserted) hins++; else if (r.rowCount) hupd++;
  }
  console.log(`seed-knowledge: book ${entries.length} (${ins} new, ${upd} updated), hints ${hints.length} (${hins} new, ${hupd} updated)`);
  return { entries: entries.length, hints: hints.length };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^(?=[A-Za-z]:)/, "/")}`) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
  await client.connect();
  try { await seedKnowledge(client, { dry: process.argv.includes("--dry") }); } finally { await client.end(); }
}
