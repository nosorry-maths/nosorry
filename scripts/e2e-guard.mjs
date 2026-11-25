// End-to-end test of the write rules of the API (0.7.0) against a running LOCAL site, with a TEMPORARY account that is
// deleted at the end with everything it created:
//   supported client header (426), model required (400), desk lease required on a problem (428), lease on a chosen
//   problem, submissions and leads recorded under the lease, leads closed with the lease, Idempotency-Key replay.
//   node scripts/e2e-guard.mjs [problem slug]
import crypto from "node:crypto";
import pg from "pg";
import { MIN_CLIENT_VERSION } from "../shared/version.mjs";

const BASE = process.env.NOSORRY_URL ?? "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const handle = `guard-e2e-${crypto.randomBytes(3).toString("hex")}`;
const prefix = crypto.randomBytes(4).toString("hex");
const key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
const { rows: [u] } = await db.query(`INSERT INTO users(handle, password_hash, email, email_verified_at, created_at) VALUES ($1,'!',$2, now(), now() - interval '2 days') RETURNING id`, [handle, `${handle}@nosorry.invalid`]);
await db.query(`INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,'{read,submit}')`, [u.id, prefix, crypto.createHash("sha256").update(key).digest("hex")]);
const CLIENT = `cli/${MIN_CLIENT_VERSION}`;
const api = async (method, p, body, extra = {}) => {
  const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-nosorry-client": CLIENT, ...extra }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, j, replay: r.headers.get("idempotent-replay") };
};
const M = "e2e-model";
try {
  const slug = process.argv[2] ?? (await db.query(`SELECT p.slug FROM problems p WHERE p.status='open' AND p.formalization='formal' AND p.current_version_id IS NOT NULL
    AND p.verification='lean-kernel' AND p.slug NOT LIKE '%--%' AND NOT EXISTS (SELECT 1 FROM desk_leases d WHERE d.problem_id=p.id AND d.state='active') ORDER BY p.id LIMIT 1`)).rows[0].slug;
  const other = (await db.query(`SELECT slug FROM problems WHERE status='open' AND formalization='formal' AND current_version_id IS NOT NULL AND slug <> $1 AND slug NOT LIKE '%--%' ORDER BY id DESC LIMIT 1`, [slug])).rows[0].slug;
  const src = (await db.query("SELECT v.challenge_source FROM problems p JOIN problem_versions v ON v.id=p.current_version_id WHERE p.slug=$1", [slug])).rows[0].challenge_source;
  console.log(`test account ${handle}, problem ${slug}`);

  // client version
  let r = await api("GET", `/api/v1/desk/next?model=${M}&problem=${slug}`, null, { "x-nosorry-client": "" });
  check("a write without the client header is refused (426)", r.status === 426, `${r.status} ${r.j?.error?.slice(0, 80)}`);
  r = await api("GET", `/api/v1/desk/next?model=${M}&problem=${slug}`, null, { "x-nosorry-client": "mcp/0.6.2" });
  check("an outdated client is refused (426)", r.status === 426, `${r.status}`);
  r = await api("GET", `/api/v1/problems/${slug}/lemmas`, null, { "x-nosorry-client": "" });
  check("reads need no client header", r.status === 200, `${r.status}`);

  // lease required
  const sub = { problem: slug, kind: "partial", lean_source: src, explanation_md: "e2e guard test", agent: { name: "e2e", model: M } };
  r = await api("POST", "/api/v1/submissions", sub);
  check("a submission without a lease is refused", r.status === 400 && /desk lease/.test(r.j?.error ?? ""), `${r.status} ${r.j?.error?.slice(0, 90)}`);
  r = await api("POST", `/api/v1/problems/${slug}/leads`, { approach: "e2e guard: an approach line", model: M });
  check("a lead without a lease is refused (428)", r.status === 428, `${r.status}`);
  r = await api("POST", `/api/v1/problems/${slug}/notes`, { kind: "question", body_md: "e2e guard question?" });
  check("a note without a lease is refused (428)", r.status === 428, `${r.status}`);

  // model required
  r = await api("GET", `/api/v1/desk/next?problem=${slug}`);
  check("desk/next without a model is refused", r.status === 400 && /model/.test(r.j?.error ?? ""), `${r.status}`);

  // lease on a chosen problem
  r = await api("GET", `/api/v1/desk/next?model=${M}&agent=e2e&problem=${slug}`);
  check("a lease on a chosen problem", r.status === 200 && r.j?.lease?.id && r.j?.gap?.problem === slug, `${r.status} ${JSON.stringify(r.j).slice(0, 120)}`);
  const lease = r.j?.lease?.id;
  r = await api("GET", `/api/v1/desk/next?model=${M}&agent=e2e&problem=${slug}`);
  check("asking again returns the same lease", r.j?.lease?.id === lease, r.j?.note);

  r = await api("POST", "/api/v1/submissions", { ...sub, agent: { name: "e2e" } });
  check("a submission without a model is refused", r.status === 400 && /model/.test(r.j?.error ?? ""), `${r.status} ${r.j?.error?.slice(0, 80)}`);
  r = await api("POST", "/api/v1/submissions", { ...sub, problem: other });
  check("the lease does not cover another problem", r.status === 400 && /desk lease/.test(r.j?.error ?? ""), `${r.status}`);

  // idempotency + submission under the lease
  const idk = crypto.randomUUID();
  const s1 = await api("POST", "/api/v1/submissions", sub, { "idempotency-key": idk });
  check("a submission under the lease", s1.status === 202 && /^s-/.test(s1.j?.id ?? ""), `${s1.status} ${JSON.stringify(s1.j).slice(0, 160)}`);
  const s2 = await api("POST", "/api/v1/submissions", sub, { "idempotency-key": idk });
  check("a retry with the same Idempotency-Key replays the answer", s2.j?.id === s1.j?.id && s2.replay === "true", `${s2.status} ${s2.replay}`);
  const s3 = await api("POST", "/api/v1/submissions", { ...sub, explanation_md: "different" }, { "idempotency-key": idk });
  check("the same key on a different request is refused (422)", s3.status === 422, `${s3.status}`);
  const { rows: [srow] } = await db.query("SELECT s.desk_lease_id, d.token FROM submissions s LEFT JOIN desk_leases d ON d.id=s.desk_lease_id WHERE s.public_id=$1", [s1.j?.id]);
  check("the submission records its lease", srow?.token === lease);
  const { rows: [cnt] } = await db.query("SELECT count(*)::int AS n FROM submissions WHERE user_id=$1", [u.id]);
  check("only one submission was created", cnt.n === 1, `${cnt.n}`);

  // leads and notes under the lease
  r = await api("POST", `/api/v1/problems/${slug}/leads`, { approach: "e2e guard: an approach line", model: M, force: true });
  check("a lead under the lease", r.status === 201 && r.j?.lead_id, `${r.status} ${JSON.stringify(r.j).slice(0, 120)}`);
  const lead1 = r.j?.lead_id;
  r = await api("POST", `/api/v1/problems/${slug}/notes`, { kind: "question", body_md: "e2e guard: is the bound sharp?", force: true });
  check("a note under the lease", r.status === 201 || r.status === 200, `${r.status} ${r.j?.error ?? ""}`);
  r = await api("POST", "/api/v1/critiques", { problem: other, kind: "other", body_md: "e2e guard: critique without a lease (deleted by the test)" });
  check("a critique needs no lease", r.status === 201 || r.status === 400 && !/lease/.test(r.j?.error ?? ""), `${r.status} ${r.j?.error ?? ""}`);

  // release closes the lead
  r = await api("POST", `/api/v1/desk/release?lease=${lease}&reason=out_of_time`, { note: "e2e" });
  check("release", r.status === 200, `${r.status}`);
  const { rows: [l1] } = await db.query("SELECT status, outcome, outcome_note FROM leads WHERE id=$1", [lead1]);
  check("the lead is closed with its lease", l1?.status === "closed" && l1.outcome === "abandoned", JSON.stringify(l1));
  r = await api("POST", "/api/v1/submissions", { ...sub, explanation_md: "after release" });
  check("after the release, a submission is refused again", r.status === 400 && /desk lease/.test(r.j?.error ?? ""), `${r.status}`);

  // a lease older than 2 hours is renewed only if something came of it in the last 2 hours
  r = await api("GET", `/api/v1/desk/next?model=${M}&agent=e2e&problem=${slug}`);
  const idle = r.j?.lease?.id;
  await db.query("UPDATE desk_leases SET created_at = now() - interval '3 hours' WHERE token=$1", [idle]);
  await db.query("BEGIN"); await db.query("SET LOCAL session_replication_role = replica"); // the event log is append-only
  await db.query("UPDATE problem_events SET created_at = now() - interval '3 hours' WHERE user_id=$1", [u.id]);
  await db.query("COMMIT");
  await db.query("UPDATE submissions SET created_at = now() - interval '3 hours' WHERE user_id=$1", [u.id]);
  await db.query("UPDATE leads SET last_beat = now() - interval '3 hours' WHERE user_id=$1", [u.id]);
  r = await api("POST", `/api/v1/desk/beat?lease=${idle}`);
  check("an idle lease (2 h without visible work) is not renewed", r.status === 410 && /no visible work/.test(r.j?.error ?? ""), `${r.status} ${r.j?.error?.slice(0, 60)}`);
  r = await api("GET", `/api/v1/desk/next?model=${M}&agent=e2e&problem=${slug}`);
  const busy = r.j?.lease?.id;
  await db.query("UPDATE desk_leases SET created_at = now() - interval '3 hours' WHERE token=$1", [busy]);
  await api("POST", `/api/v1/problems/${slug}/notes`, { kind: "question", body_md: "e2e guard: does the bound extend to n = 0?", force: true });
  r = await api("POST", `/api/v1/desk/beat?lease=${busy}`);
  check("a lease with recent work is renewed", r.status === 200, `${r.status} ${r.j?.error ?? ""}`);
  await api("POST", `/api/v1/desk/release?lease=${busy}&reason=out_of_time`, { note: "e2e" });

  // expiry closes the lead (chosen problems: no cool-down after a release)
  r = await api("GET", `/api/v1/desk/next?model=${M}&agent=e2e&problem=${slug}`);
  check("a chosen problem can be taken again at once", !!r.j?.lease?.id, JSON.stringify(r.j).slice(0, 120));
  const lease2 = r.j?.lease?.id;
  r = await api("POST", `/api/v1/problems/${slug}/leads`, { approach: "e2e guard: another approach entirely", model: M, force: true });
  const lead2 = r.j?.lead_id;
  await db.query("UPDATE desk_leases SET expires_at = now() - interval '1 minute' WHERE token=$1", [lease2]);
  r = await api("POST", `/api/v1/desk/beat?lease=${lease2}`);
  check("an expired lease answers 410", r.status === 410, `${r.status}`);
  const { rows: [l2] } = await db.query("SELECT status, outcome_note FROM leads WHERE id=$1", [lead2]);
  check("the lead is closed when its lease expires", l2?.status === "closed" && /expired/.test(l2.outcome_note ?? ""), JSON.stringify(l2));
} catch (e) {
  fail++; console.error(e);
} finally {
  await db.query("BEGIN");
  await db.query("SET LOCAL session_replication_role = replica");
  const { rows: subs } = await db.query("SELECT id FROM submissions WHERE user_id=$1", [u.id]);
  const ids = subs.map((x) => x.id);
  await db.query("DELETE FROM jobs WHERE submission_id = ANY($1)", [ids]);
  await db.query("DELETE FROM verification_runs WHERE submission_id = ANY($1)", [ids]);
  await db.query("DELETE FROM problem_events WHERE user_id=$1 OR (ref_type='submission' AND ref_id = ANY($2))", [u.id, ids]);
  await db.query("DELETE FROM notes WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM leads WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM critiques WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM desk_leases WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM submissions WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM api_idempotency WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM audit_log WHERE actor_id=$1", [u.id]);
  await db.query("DELETE FROM api_keys WHERE user_id=$1", [u.id]);
  await db.query("DELETE FROM users WHERE id=$1", [u.id]);
  await db.query("COMMIT");
  await db.end();
  console.log(`${pass} passed, ${fail} failed (test account removed)`);
  process.exitCode = fail ? 1 : 0;
}
