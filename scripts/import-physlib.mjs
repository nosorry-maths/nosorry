// Imports Physlib's informal lemmas and its "prove / show" TODO items as physics problems *awaiting formalization*.
//   node scripts/import-physlib.mjs <path-to-physlib-checkout> [--dry]
//
// Physlib (github.com/leanprover-community/physlib, Apache-2.0) keeps its main branch sorry-free; statements it has not
// formalized yet are written as `informal_lemma name where tag := … deps := […]` with a docstring, or as
// `TODO "…"` notes. Each becomes a problem with formalization='informal' and statement_status='draft':
// someone must first submit a formalization (a Lean statement ending in sorry), which a reviewer with physics
// background checks (units, idealisations, model) before proofs earn points.
// Idempotent: problems are matched by slug; text and links are refreshed.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { PHYSLIB_CATEGORY } from "../shared/taxonomy.mjs";

const root = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!root) { console.error("usage: import-physlib.mjs <physlib checkout>"); process.exit(1); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const toolchain = fs.readFileSync(path.join(root, "lean-toolchain"), "utf8").trim();
const REPO = "https://github.com/leanprover-community/physlib";

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".lean")) yield p;
  }
}
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const humanize = (name) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const firstSentence = (s) => (s.split(/(?<=[.!?])\s/)[0] ?? s).replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + " …");
const clean = (doc) => doc.split("\n").map((l) => l.replace(/^\s{0,4}/, "")).join("\n").trim();

const items = [];
for (const file of walk(path.join(root, "Physlib"))) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const top = rel.split("/")[1];
  const category = PHYSLIB_CATEGORY[top] ?? "physics.math-ph";
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const ns = [];
  lines.forEach((line, i) => {
    const n = line.match(/^namespace\s+(\S+)/); if (n) ns.push(n[1]);
    if (/^end\s+\S+\s*$/.test(line) && ns.length) ns.pop();
    // informal lemmas
    const il = line.match(/^\s*informal_lemma\s+([\w.']+)\s+where/);
    if (il) {
      const before = lines.slice(0, i).join("\n");
      // the docstring immediately above (search backwards, not from the first /-- of the file)
      const start = before.lastIndexOf("/--");
      const d = start >= 0 && /-\/\s*$/.test(before) ? [null, before.slice(start + 3).replace(/-\/\s*$/, "")] : null;
      const body = lines.slice(i + 1, i + 8).join("\n");
      const tag = body.match(/tag\s*:=\s*"([^"]+)"/)?.[1] ?? null;
      const deps = [...(body.match(/deps\s*:=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/``?([\w.']+)/g)].map((m) => m[1]);
      const doc = d ? clean(d[1]) : null;
      if (!doc) return;
      const qual = [...ns, il[1]].join(".");
      items.push({ kind: "informal-lemma", name: qual, tag, deps, doc, rel, line: i + 1, category,
        slug: `physlib-${slugify(tag ?? qual)}`, title: `${humanize(il[1])} — ${clip(firstSentence(doc), 110)}` });
    }
    // TODO "Prove …" / "Show …"
    const td = line.match(/^\s*TODO\s+"/);
    if (td) {
      let text = line.slice(line.indexOf('"') + 1), j = i;
      while (!/(?<!\\)"/.test(text) && j < lines.length - 1) text += "\n" + lines[++j];
      text = text.replace(/(?<!\\)"[\s\S]*$/, "").replace(/\s+/g, " ").trim();
      // keep mathematical statements to establish, not engineering tasks ("Add a constructor…", "Create a file…")
      if (!/^(prove|show|derive|verify)\b/i.test(text) && !/\bprove that\b/i.test(text)) return;
      const h = crypto.createHash("sha1").update(rel + text).digest("hex").slice(0, 8);
      items.push({ kind: "todo", name: null, tag: null, deps: [], doc: text, rel, line: i + 1, category,
        slug: `physlib-todo-${slugify(text.split(" ").slice(0, 6).join(" "))}-${h}`, title: clip(firstSentence(text), 140) });
    }
  });
}
const seen = new Set();
const uniq = items.filter((x) => (seen.has(x.slug) ? false : seen.add(x.slug)));
const byKind = uniq.reduce((a, x) => ((a[x.kind] = (a[x.kind] ?? 0) + 1), a), {});
const byCat = uniq.reduce((a, x) => ((a[x.category] = (a[x.category] ?? 0) + 1), a), {});
console.log(`physlib ${commit.slice(0, 8)} (${toolchain}):`, byKind, byCat);
if (DRY) { for (const x of uniq.slice(0, 4)) console.log(x.slug, "|", x.title, "|", x.category); process.exit(0); }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();
await c.query("BEGIN");
await c.query(`INSERT INTO collections(slug,name,description,source_url) VALUES ('physlib','Physlib','Physics statements from Physlib (ex-PhysLean) awaiting formalization',$1)
               ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description`, [REPO]);
let created = 0, updated = 0;
for (const x of uniq) {
  const where = `${REPO}/blob/${commit}/${x.rel}#L${x.line}`;
  const md = [
    x.doc,
    "",
    x.kind === "informal-lemma"
      ? `*Physlib informal lemma* \`${x.name}\`${x.tag ? ` (tag \`${x.tag}\`)` : ""}${x.deps.length ? `, depends on ${x.deps.map((d) => `\`${d}\``).join(", ")}` : ""}.`
      : "*Physlib TODO item.*",
    `Source: [${x.rel}:${x.line}](${where}). No formal statement yet: submit a formalization (Lean statement ending in \`sorry\`, against Physlib) to make it provable here.`,
  ].join("\n");
  const subjects = [x.category];
  const tags = ["physlib", x.kind, "needs-formalization"];
  const r = await c.query(
    `INSERT INTO problems(ident, slug, collection, title, statement_md, status, field, primary_subject, subjects, tags, source_url, source_path,
       statement_status, formalization, verification, license, attribution)
     VALUES ('tmp-'||md5(random()::text), $1,'physlib',$2,$3,'solved','physics',$4,$5,$6,$7,$8,'draft','informal','lean-kernel','Apache-2.0',$9)
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, statement_md=EXCLUDED.statement_md, primary_subject=EXCLUDED.primary_subject,
       subjects=EXCLUDED.subjects, source_url=EXCLUDED.source_url, source_path=EXCLUDED.source_path, updated_at=now()
     RETURNING id, (xmax = 0) AS created`,
    [x.slug, x.title, md, x.category, subjects, tags, where, x.rel, `Physlib contributors (leanprover-community/physlib @ ${commit.slice(0, 8)})`]);
  if (r.rows[0].created) { created++; await c.query("UPDATE problems SET ident='NS.' || lpad(id::text,5,'0') WHERE id=$1", [r.rows[0].id]); }
  else updated++;
}
await c.query(`UPDATE problems SET search_text = ns_fold(title || ' ' || slug || ' ' || ident || ' ' || coalesce(statement_md,'')) WHERE collection='physlib'`);
await c.query("COMMIT");
await c.end();
console.log({ created, updated });
