// Local development seed: a demo problem that needs no Mathlib, an admin and a contributor with an API key.
//   node scripts/seed-demo.mjs        (prints the generated test credentials; dev only)
import crypto from "node:crypto";
import pg from "pg";

if (process.env.NODE_ENV === "production") { console.error("refusing to seed in production"); process.exit(1); }
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const N = 2 ** 15, r = 8, p = 1;
const hash = (pw) => { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${h.toString("base64")}`; };

const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();

const challenge = `/-! Demo problem (core Lean only, no Mathlib): the sum of two even numbers is even. -/
namespace Demo

/-- \`n\` is even. -/
def IsEven (n : Nat) : Prop := ∃ k, n = 2 * k

theorem even_add : ∀ a b, IsEven a → IsEven b → IsEven (a + b) := by
  sorry

end Demo
`;
const creds = {};
// Test accounts get fresh random passwords on every run (printed below; local development only).
for (const [handle, role] of [["demo-admin", "admin"], ["demo-alice", "user"]]) {
  const pw = crypto.randomBytes(9).toString("base64url");
  const { rows: [u] } = await c.query(
    `INSERT INTO users(handle, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT (handle) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`,
    [handle, hash(pw), role]);
  creds[handle] = { password: pw, id: u.id };
}
const prefix = crypto.randomBytes(4).toString("hex");
const key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
await c.query("INSERT INTO api_keys(user_id, name, prefix, key_hash) VALUES ($1,'seed',$2,$3)", [creds["demo-alice"].id, prefix, sha(key)]);

const { rows: [ex] } = await c.query("SELECT id FROM problems WHERE slug='demo-even-add'");
if (ex) await c.query("UPDATE problems SET status='test', tags='{demo}' WHERE id=$1", [ex.id]);
if (!ex) {
  const { rows: [pr] } = await c.query(
    `INSERT INTO problems(ident, slug, collection, title, statement_md, status, primary_subject, subjects, statement_status)
     VALUES ('tmp-demo','demo-even-add','other','Demo · the sum of two even numbers is even',
     'Show that if $a$ and $b$ are even then $a+b$ is even. A pipeline test that compiles without Mathlib; it is not a research problem.','test','math.NT','{math.NT,msc:11}','reviewed') RETURNING id`);
  await c.query("UPDATE problems SET tags='{demo}' WHERE id=$1", [pr.id]);
  await c.query("UPDATE problems SET ident='NS.' || lpad(id::text,5,'0') WHERE id=$1", [pr.id]);
  const { rows: [v] } = await c.query(
    `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, change_reason)
     VALUES ($1,1,'Demo.even_add',$2,'theorem even_add : ∀ a b, IsEven a → IsEven b → IsEven (a + b)',$3,'leanprover/lean4:v4.33.1','demo seed') RETURNING id`,
    [pr.id, challenge, sha(challenge)]);
  await c.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [pr.id, v.id]);
}
await c.end();
console.log(JSON.stringify({ users: Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v.password])), alice_api_key: key }, null, 2));
