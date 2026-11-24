// End-to-end test: a proof submitted under a desk lease, once Lean accepts it, releases the lease and closes the leads
// opened under it. Against a running LOCAL site and worker, with a temporary account.
//   node scripts/e2e-lease-worker.mjs submit     copy of a verified proof (with a comment line), under a lease, + a lead
//   node scripts/e2e-lease-worker.mjs check      after the worker: lease released ("submitted"), lead closed
//   node scripts/e2e-lease-worker.mjs cleanup    delete the temporary account and everything it created
// State between steps: var/e2e-lease.json (var/ is never committed).
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { MIN_CLIENT_VERSION } from "../shared/version.mjs";

const BASE = process.env.NOSORRY_URL ?? "http://localhost:3000";
const STATE = "var/e2e-lease.json";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const step = process.argv[2];
try {
  if (step === "submit") {
    const handle = `lease-e2e-${crypto.randomBytes(3).toString("hex")}`, prefix = crypto.randomBytes(4).toString("hex");
    const key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
    const { rows: [u] } = await db.query(`INSERT INTO users(handle, password_hash, email, email_verified_at, created_at) VALUES ($1,'!',$2, now(), now() - interval '2 days') RETURNING id`, [handle, `${handle}@nosorry.invalid`]);
    await db.query(`INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,'{read,submit}')`, [u.id, prefix, crypto.createHash("sha256").update(key).digest("hex")]);
    fs.mkdirSync("var", { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ userId: Number(u.id) }), { mode: 0o600 });
    const { rows: [p] } = await db.query(`SELECT s.lean_source, p.slug FROM submissions s JOIN problems p ON p.id=s.problem_id
      WHERE s.status='verified' AND s.kind='proof' AND p.status <> 'lemma' AND s.source_repo IS NULL AND length(s.lean_source) < 20000 ORDER BY s.id DESC LIMIT 1`);
    const api = async (method, path, body) => {
      const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-nosorry-client": `cli/${MIN_CLIENT_VERSION}` }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, j: await r.json().catch(() => null) };
    };
    let r = await api("GET", `/api/v1/desk/next?model=e2e-model&agent=e2e&problem=${p.slug}`);
    check("lease on a solved problem (another proof)", !!r.j?.lease?.id, `${r.status} ${JSON.stringify(r.j).slice(0, 100)}`);
    const lease = r.j?.lease?.id;
    r = await api("POST", `/api/v1/problems/${p.slug}/leads`, { approach: "e2e lease: a second proof of a solved problem", model: "e2e-model", force: true });
    check("lead under the lease", r.status === 201, `${r.status}`);
    r = await api("POST", "/api/v1/submissions", { problem: p.slug, kind: "proof", lean_source: p.lean_source + `\ntheorem e2e_lease_marker_${crypto.randomBytes(3).toString("hex")} : (2:ℕ) + 2 = 4 := by norm_num\n`, explanation_md: "e2e lease test (copy of an accepted proof)", agent: { name: "e2e", model: "e2e-model" } });
    check("proof submitted under the lease", r.status === 202, `${r.status} ${JSON.stringify(r.j).slice(0, 120)}`);
    fs.writeFileSync(STATE, JSON.stringify({ userId: Number(u.id), key, lease, id: r.j?.id, slug: p.slug }), { mode: 0o600 });
    console.log(`submission ${r.j?.id} on ${p.slug}: ${BASE}/s/${r.j?.id} — run the worker, then: node scripts/e2e-lease-worker.mjs check`);
  } else if (step === "check") {
    const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
    const { rows: [s] } = await db.query("SELECT id, status FROM submissions WHERE public_id=$1", [st.id]);
    check("Lean accepted the proof", ["verified", "needs_review"].includes(s.status), s.status);
    const { rows: [l] } = await db.query("SELECT state, reason, submission_id FROM desk_leases WHERE token=$1", [st.lease]);
    check("the lease was released as submitted, with the submission", l.state === "released" && l.reason === "submitted" && Number(l.submission_id) === Number(s.id), JSON.stringify(l));
    const { rows: leads } = await db.query("SELECT status, outcome_note FROM leads WHERE user_id=$1", [st.userId]);
    check("the lead was closed with it", leads.length === 1 && leads[0].status === "closed" && /accepted by Lean/.test(leads[0].outcome_note ?? ""), JSON.stringify(leads));
    const { rows: [run] } = await db.query("SELECT stages FROM verification_runs WHERE submission_id=$1 ORDER BY id DESC LIMIT 1", [s.id]);
    check("stages that ran carry their start time", (run?.stages ?? []).length > 0 && run.stages.filter((x) => x.ms != null).every((x) => !!x.started), JSON.stringify(run?.stages?.map((x) => x.started)).slice(0, 120));
  } else if (step === "cleanup") {
    const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    const ids = (await db.query("SELECT id FROM submissions WHERE user_id=$1", [st.userId])).rows.map((x) => x.id);
    await db.query("DELETE FROM verification_runs WHERE submission_id = ANY($1)", [ids]);
    await db.query("DELETE FROM jobs WHERE submission_id = ANY($1)", [ids]);
    await db.query("DELETE FROM point_events WHERE submission_id = ANY($1) OR user_id=$2", [ids, st.userId]);
    await db.query("DELETE FROM problem_events WHERE user_id=$1 OR (ref_type='submission' AND ref_id = ANY($2))", [st.userId, ids]);
    for (const t of ["leads", "notes", "desk_leases", "api_idempotency", "audit_log"]) await db.query(`DELETE FROM ${t} WHERE ${t === "audit_log" ? "actor_id" : "user_id"}=$1`, [st.userId]);
    await db.query("DELETE FROM transcripts WHERE submission_id = ANY($1)", [ids]);
    await db.query("DELETE FROM submissions WHERE id = ANY($1)", [ids]);
    await db.query("DELETE FROM api_keys WHERE user_id=$1", [st.userId]);
    await db.query("DELETE FROM users WHERE id=$1", [st.userId]);
    await db.query("COMMIT");
    fs.rmSync(STATE, { force: true });
    console.log("cleaned up");
  }
} catch (e) { fail++; console.error(e); await db.query("ROLLBACK").catch(() => {}); }
finally { await db.end(); if (step !== "cleanup") console.log(`${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0; }
