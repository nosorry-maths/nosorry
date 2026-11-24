// DEV: a toy metric challenge (core Lean, no Mathlib) to exercise records, lineage and the research feed.
//   node scripts/seed-metric-demo.mjs
import crypto from "node:crypto";
import pg from "pg";

const src = `/-! Demo metric challenge (core Lean): write 100 as a sum of positive integers using as few terms as possible.
The list \`answerList\` is yours to fill; \`metric_bound\` must state its length with a number in place of the hole. -/
namespace Sum100

/-- Your list of positive integers summing to 100. -/
def answerList : List Nat := sorry

theorem correct : answerList.sum = 100 ∧ ∀ x ∈ answerList, 0 < x := sorry

/-- The cost you prove: replace the hole by a number. Lower is better. -/
theorem metric_bound : answerList.length ≤ sorry := sorry

end Sum100
`;
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();
const { rows: [ex] } = await c.query("SELECT id FROM problems WHERE slug='demo-sum-100'");
if (!ex) {
  const { rows: [p] } = await c.query(
    `INSERT INTO problems(ident, slug, collection, title, statement_md, status, primary_subject, subjects, statement_status, tags,
       metric_name, metric_direction, metric_decl, record_threshold, baseline_value, round_hours)
     VALUES ('tmp-'||md5(random()::text),'demo-sum-100','other','Demo challenge · 100 as a short sum',
       'Write $100$ as a sum of positive integers with as few terms as possible, and prove the length. A toy challenge to try records and the research feed.',
       'test','math.NT','{math.NT}','reviewed','{demo,challenge}','number of terms','min','Sum100.metric_bound',0.05,100,1) RETURNING id`);
  await c.query("UPDATE problems SET ident='NS.' || lpad(id::text,5,'0') WHERE id=$1", [p.id]);
  const { rows: [v] } = await c.query(
    `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, workspace, change_reason)
     VALUES ($1,1,'Sum100.correct',$2,'theorem correct : answerList.sum = 100 ∧ ∀ x ∈ answerList, 0 < x',$3,'leanprover/lean4:v4.33.1','core','demo seed') RETURNING id`,
    [p.id, src, crypto.createHash("sha256").update(src).digest("hex")]);
  await c.query("UPDATE problems SET current_version_id=$2, search_text=ns_fold(title || ' demo sum 100 challenge') WHERE id=$1", [p.id, v.id]);
  console.log("created demo-sum-100");
} else console.log("demo-sum-100 exists");
await c.end();
