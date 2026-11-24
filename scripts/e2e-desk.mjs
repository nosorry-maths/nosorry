// End-to-end test of the desk and the featured problem against a running site, with a TEMPORARY account that is
// deleted at the end with everything it created (leases, votes, events, the featured-problem rows of the test).
//   node scripts/e2e-desk.mjs [problem slug]        (default: an open formal problem without lemmas)
import crypto from "node:crypto";
import pg from "pg";
import { MIN_CLIENT_VERSION } from "../shared/version.mjs";

const BASE = process.env.NOSORRY_URL ?? "http://localhost:3100";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const handle = `desk-e2e-${crypto.randomBytes(3).toString("hex")}`;
const prefix = crypto.randomBytes(4).toString("hex");
const key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
const { rows: [u] } = await db.query(`INSERT INTO users(handle, password_hash, email, email_verified_at) VALUES ($1,'!',$2, now()) RETURNING id`, [handle, `${handle}@nosorry.invalid`]);
await db.query(`INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,'{read,submit}')`, [u.id, prefix, crypto.createHash("sha256").update(key).digest("hex")]);
const { rows: [before] } = await db.query("SELECT id FROM focus_history WHERE ended_at IS NULL");
const t0 = new Date();
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-nosorry-client": `cli/${MIN_CLIENT_VERSION}` }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, j };
};
let problemId;
try {
  const slug = process.argv[2] ?? (await db.query(`SELECT p.slug FROM problems p WHERE p.status='open' AND p.formalization='formal' AND p.current_version_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM problems l WHERE l.parent_id=p.id) AND p.slug NOT LIKE '%--%' ORDER BY p.id LIMIT 1`)).rows[0].slug;
  problemId = (await db.query("SELECT id FROM problems WHERE slug=$1", [slug])).rows[0].id;
  console.log(`test account ${handle}, problem ${slug}`);

  // No featured problem and no vote yet (unless one exists already)
  let r = await api("GET", "/api/v1/desk/next?model=e2e-model");
  check("desk answers without a featured problem", r.status === 200, JSON.stringify(r.j).slice(0, 120));

  // A vote makes it the featured problem (votes are a browser action; inserted here)
  await db.query("INSERT INTO problem_votes(user_id, problem_id) VALUES ($1,$2)", [u.id, problemId]);
  if (!before) {
    r = await fetch(`${BASE}/api/v1/focus`).then((x) => x.json());
    check("the voted problem becomes featured", r.focus?.slug === slug, r.focus?.slug);
  }
  const focusSlug = before ? null : slug;

  // 1. next: no lemmas → plan task
  r = await api("GET", `/api/v1/desk/next?model=e2e-model&agent=e2e${focusSlug ? "" : `&problem=${slug}`}`);
  check("next gives a task with a lease", r.status === 200 && r.j?.lease?.id && r.j?.gap, JSON.stringify(r.j?.gap ?? r.j).slice(0, 140));
  check("a problem without lemmas gets a planning task first", r.j?.gap?.task === "plan");
  const lease1 = r.j?.lease?.id;
  // 2. asking again without another=1 returns the same task
  r = await api("GET", "/api/v1/desk/next?model=e2e-model");
  check("asking again returns the task you hold", r.j?.lease?.id === lease1);
  // 3. beat
  r = await api("POST", `/api/v1/desk/beat?lease=${lease1}`);
  check("beat renews the lease", r.status === 200 && r.j?.ok, JSON.stringify(r.j));
  // 4. another=1 → a second task (the problem itself, staggering allows: nobody else on it)
  r = await api("GET", `/api/v1/desk/next?model=e2e-model&another=1${focusSlug ? "" : `&problem=${slug}`}`);
  check("another=1 gives a second task", r.j?.lease?.id && r.j.lease.id !== lease1 && r.j?.gap?.task === "prove", JSON.stringify(r.j?.gap ?? r.j).slice(0, 140));
  const lease2 = r.j?.lease?.id;
  // 5. release with a bad reason, then a good one
  r = await api("POST", `/api/v1/desk/release?lease=${lease1}&reason=nope`);
  check("an unknown reason is refused", r.status === 400);
  r = await api("POST", `/api/v1/desk/release?lease=${lease1}&reason=planned`, { note: "split into two lemmas (e2e)" });
  check("release with a reason", r.status === 200 && r.j?.ok);
  r = await api("POST", `/api/v1/desk/beat?lease=${lease1}`);
  check("a released lease answers 410", r.status === 410);
  // 6. the cool-down: the same task is not offered again within the hour
  r = await api("POST", `/api/v1/desk/release?lease=${lease2}&reason=out_of_time`, { note: "e2e" });
  r = await api("GET", `/api/v1/desk/next?model=e2e-model${focusSlug ? "" : `&problem=${slug}`}`);
  check("released tasks are not offered again to the same person", r.j?.gap === null, JSON.stringify(r.j).slice(0, 140));
  // 7. a lease expires: simulate, then beat → 410
  r = await api("GET", `/api/v1/desk/next?model=e2e-model&problem=${slug}&hard=1`);
  // (cooled down: likely null) — create one directly to test expiry
  const tok = crypto.randomBytes(18).toString("base64url");
  await db.query(`INSERT INTO desk_leases(token,user_id,problem_id,task,expires_at) VALUES ($1,$2,$3,'prove', now() - interval '1 minute')`, [tok, u.id, problemId]);
  r = await api("POST", `/api/v1/desk/beat?lease=${tok}`);
  check("an expired lease answers 410", r.status === 410, JSON.stringify(r.j));
  // 8. someone else's lease
  r = await api("POST", `/api/v1/desk/beat?lease=does-not-exist`);
  check("an unknown lease answers 404", r.status === 404);
  // 9. live stats see the test agent
  r = await fetch(`${BASE}/api/v1/focus`).then((x) => x.json());
  check("the live block lists recent joiners", (r.live?.recent ?? []).some((x) => x.handle === handle), JSON.stringify(r.live).slice(0, 160));
  // 10. join.txt
  const jt = await fetch(`${BASE}/join.txt`).then((x) => x.text());
  check("join.txt is served and names the desk", jt.includes("/api/v1/desk/next") && jt.includes("desk/beat"));
} catch (e) {
  fail++; console.log("ERROR", e.message);
} finally {
  // Clean up everything the test created. problem_events is append-only by design (a trigger refuses DELETE): the
  // test's own rows are removed with triggers off for this transaction only.
  await cleanup(db, t0, !before);  const left = (await db.query("SELECT (SELECT count(*) FROM users WHERE handle LIKE 'desk-e2e-%')::int AS users, (SELECT count(*) FROM focus_history)::int AS focus")).rows[0];
  console.log(`cleanup: ${JSON.stringify(left)}`);
  await db.end();
  console.log(`${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

async function cleanup(c, since, focusCreated) {
  await c.query("BEGIN");
  await c.query("SET LOCAL session_replication_role = replica");
  const { rows: us } = await c.query("SELECT id FROM users WHERE handle LIKE 'desk-e2e-%'");
  const ids = us.map((x) => x.id);
  await c.query("DELETE FROM problem_events WHERE user_id = ANY($1::bigint[])", [ids]);
  if (focusCreated) {
    await c.query("DELETE FROM problem_events WHERE type='focus' AND created_at >= $1", [since]);
    await c.query("DELETE FROM focus_history WHERE started_at >= $1", [since]);
  }
  for (const t of ["desk_leases", "problem_votes", "api_keys"]) await c.query(`DELETE FROM ${t} WHERE user_id = ANY($1::bigint[])`, [ids]);
  await c.query("DELETE FROM audit_log WHERE actor_id = ANY($1::bigint[])", [ids]);
  await c.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [ids]);
  await c.query("COMMIT");
}
export { cleanup };