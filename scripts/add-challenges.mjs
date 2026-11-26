// Record challenges posed on nosorry: build a bundle from challenge folders, then apply it to a database.
//   node scripts/add-challenges.mjs build <dir> > bundle.json
//       <dir>/<slug>/Challenge.lean + <dir>/<slug>/challenge.json, where challenge.json is
//       { "title", "statement_md", "metric_name", "metric_direction": "min"|"max", "metric_decl", "decl_name",
//         "baseline_value", "record_threshold", "primary_subject", "subjects": [], "tags": [], "source_url", "collection",
//         (no metric_name: an ordinary yes/no problem, e.g. a lower bound that goes with a race)
//         "info": { family, summary, known: {value, by, url}, bound, scale, unit, order } }
//   node scripts/add-challenges.mjs apply < bundle.json        (DATABASE_URL; runs where `pg` is installed)
// Idempotent: an existing challenge (same slug) gets its metadata updated and, if Challenge.lean changed, a new version.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TOOLCHAIN = "leanprover/lean4:v4.33.1";
const FC_COMMIT = "f9b3868d5ca994a7bf95039bcec05338c0c21e2f";
const [mode, dir] = process.argv.slice(2);

if (mode === "build") {
  const out = [];
  for (const slug of fs.readdirSync(dir).sort()) {
    const meta = path.join(dir, slug, "challenge.json"), lean = path.join(dir, slug, "Challenge.lean");
    if (!fs.existsSync(meta) || !fs.existsSync(lean)) continue;
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    const src = fs.readFileSync(lean, "utf8").replace(/\r\n/g, "\n");
    const decl = m.decl_name.split(".").pop();
    const i = src.search(new RegExp(`\\btheorem\\s+${decl}\\b`));
    const statement = i >= 0 ? src.slice(i).split(/:=\s*(?:by\s+)?sorry/)[0].trim() : m.decl_name;
    out.push({ slug, ...m, challenge_source: src, statement_lean: statement });
  }
  process.stdout.write(JSON.stringify(out));
} else if (mode === "apply") {
  const { default: pg } = await import("pg");
  const bundle = JSON.parse(fs.readFileSync(0, "utf8"));
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
  await c.connect();
  await c.query("BEGIN");
  try {
    for (const ch of bundle) {
      const hash = crypto.createHash("sha256").update(ch.challenge_source).digest("hex");
      const fields = [ch.title, ch.statement_md, ch.primary_subject, ch.subjects ?? [ch.primary_subject], ch.tags ?? ["challenge"], ch.source_url ?? null,
        ch.metric_name ?? null, ch.metric_name ? ch.metric_direction : null, ch.metric_decl ?? null,
        ch.metric_name ? ch.record_threshold ?? 0.000001 : 0.05, ch.baseline_value ?? null, JSON.stringify(ch.info ?? {}), ch.collection ?? "records"];
      let { rows: [p] } = await c.query("SELECT id, current_version_id FROM problems WHERE slug=$1", [ch.slug]);
      if (!p) {
        ({ rows: [p] } = await c.query(
          `INSERT INTO problems(ident, slug, collection, title, statement_md, status, primary_subject, subjects, tags, source_url,
             statement_status, formalization, verification, field, license, attribution,
             metric_name, metric_direction, metric_decl, record_threshold, baseline_value, challenge_info)
           VALUES ('tmp-' || md5(random()::text), $14, $13, $1, $2, 'open', $3, $4, $5, $6,
             'reviewed', 'formal', 'lean-kernel', 'math', 'Apache-2.0', 'nosorry record challenges (formalized with AI agents, refereed)',
             $7, $8, $9, $10, $11, $12::jsonb) RETURNING id, current_version_id`, [...fields, ch.slug]));
        await c.query("UPDATE problems SET ident = 'NS.' || lpad(id::text, 5, '0') WHERE id=$1", [p.id]);
        console.log(`created ${ch.slug}`);
      } else {
        await c.query(
          `UPDATE problems SET title=$1, statement_md=$2, primary_subject=$3, subjects=$4, tags=$5, source_url=$6, metric_name=$7,
             metric_direction=$8, metric_decl=$9, record_threshold=$10, baseline_value=$11, challenge_info=$12::jsonb, collection=$13, updated_at=now() WHERE id=$14`,
          [...fields, p.id]);
        console.log(`updated ${ch.slug}`);
      }
      const { rows: [cur] } = await c.query("SELECT statement_hash, version FROM problem_versions WHERE id=$1", [p.current_version_id ?? 0]);
      if (!cur || cur.statement_hash !== hash) {
        const { rows: [v] } = await c.query(
          `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, upstream_commit, workspace, change_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'formal-conjectures', $9) RETURNING id`,
          [p.id, (cur?.version ?? 0) + 1, ch.decl_name, ch.challenge_source, ch.statement_lean, hash, TOOLCHAIN, FC_COMMIT,
           cur ? "challenge statement updated" : "record challenge posed on nosorry"]);
        await c.query("UPDATE problems SET current_version_id=$2, search_text = ns_fold(title || ' ' || coalesce(statement_md, '') || ' challenge record') WHERE id=$1", [p.id, v.id]);
        console.log(`  version ${(cur?.version ?? 0) + 1}`);
      }
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { await c.end(); }
} else {
  console.log("usage: see the header of this file");
}
