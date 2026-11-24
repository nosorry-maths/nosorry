// End-to-end test of the review of results that change a problem's status, against a running LOCAL site and worker
// (VERIFIER_BACKEND=github), with temporary accounts.
//   node scripts/e2e-review.mjs submit <problem slug> <Solution.lean> [proof|disproof]   author account + submission
//   node scripts/e2e-review.mjs check                    after the worker: held, not counted, re-run, reviews
//   node scripts/e2e-review.mjs approved                 after a moderator approved it in the browser: it counts
// (a local moderator account for that step: var/e2e-review-mod.txt, created by hand; cleanup removes it too)
//   node scripts/e2e-review.mjs cleanup                  delete the temporary accounts and everything they created
// State between steps: var/e2e-review.json (var/ is never committed).
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.NOSORRY_URL ?? "http://localhost:3000";
const STATE = "var/e2e-review.json";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const api = async (key, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, j };
};
async function account(tag) {
  const handle = `rv-${tag}-${crypto.randomBytes(3).toString("hex")}`;
  const prefix = crypto.randomBytes(4).toString("hex");
  const key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
  const { rows: [u] } = await db.query(`INSERT INTO users(handle, password_hash, email, email_verified_at) VALUES ($1,'!',$2, now()) RETURNING id`, [handle, `${handle}@nosorry.invalid`]);
  await db.query(`INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,'{read,submit}')`, [u.id, prefix, crypto.createHash("sha256").update(key).digest("hex")]);
  return { id: Number(u.id), handle, key };
}
const load = () => JSON.parse(fs.readFileSync(STATE, "utf8"));
const step = process.argv[2];

try {
  if (step === "submit") {
    const [, , , slug, file, kind = "disproof"] = process.argv;
    const author = await account("author"), reviewer = await account("reviewer");
    const r = await api(author.key, "POST", "/api/v1/submissions", { problem: slug, kind, lean_source: fs.readFileSync(file, "utf8"),
      explanation_md: "e2e test of the review flow (a copy of an accepted proof)", agent: { name: "e2e", model: "e2e-model" }, transcript: null });
    check("submission accepted for verification", r.status === 201 || r.status === 202, `${r.status} ${JSON.stringify(r.j).slice(0, 200)}`);
    fs.mkdirSync("var", { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ author, reviewer, slug, id: r.j?.id }), { mode: 0o600 });
    console.log(`submission ${r.j?.id} by ${author.handle}; reviewer ${reviewer.handle}. Now run the worker, then: node scripts/e2e-review.mjs check`);
  } else if (step === "check") {
    const { author, reviewer, slug, id } = load();
    const { rows: [s] } = await db.query("SELECT s.*, p.resolution, p.solved_on_platform FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE public_id=$1", [id]);
    check("held for review (needs_review, review_required)", s.status === "needs_review" && s.review_required, `${s.status} ${s.review_required}`);
    check("the problem is not marked solved", !s.resolution && !s.solved_on_platform, `${s.resolution}`);
    const { rows: pts } = await db.query("SELECT delta FROM point_events WHERE submission_id=$1", [s.id]);
    check("no points yet", pts.length === 0, JSON.stringify(pts));
    const { rows: jobs } = await db.query("SELECT kind, state FROM jobs WHERE submission_id=$1 ORDER BY id", [s.id]);
    check("a recheck job was queued", jobs.some((j) => j.kind === "recheck"), JSON.stringify(jobs));
    check("the independent re-run agrees", s.recheck_state === "pass", `${s.recheck_state}: ${s.recheck_detail ?? ""}`);
    let r = await api(null, "GET", "/api/v1/reviews");
    check("listed in /api/v1/reviews", r.j?.reviews?.some((x) => x.public_id === id));
    r = await api(author.key, "POST", `/api/v1/submissions/${id}/reviews`, { verdict: "sound", body_md: "x".repeat(250) });
    check("the author cannot review their own result", r.status === 403, `${r.status} ${r.j?.error}`);
    r = await api(reviewer.key, "POST", `/api/v1/submissions/${id}/reviews`, { verdict: "sound", body_md: "too short" });
    check("a review needs a real body", r.status === 400, `${r.status}`);
    r = await api(reviewer.key, "POST", `/api/v1/submissions/${id}/reviews`, { verdict: "concern", body_md: "e2e: first a concern. " + "I checked the statement and the proof. ".repeat(8), agent: { name: "e2e", model: "e2e-model" } });
    check("a concern is recorded", r.status === 201, `${r.status} ${JSON.stringify(r.j)}`);
    r = await api(reviewer.key, "POST", `/api/v1/submissions/${id}/reviews`, { verdict: "sound", body_md: "e2e: on reflection, sound. " + "I checked the statement and the proof. ".repeat(8), agent: { name: "e2e", model: "e2e-model" } });
    check("a second review by the same account replaces the first", r.status === 200 && r.j?.replaced, `${r.status} ${JSON.stringify(r.j)}`);
    r = await api(null, "GET", `/api/v1/submissions/${id}/reviews`);
    check("one review, nothing missing", r.j?.reviews?.length === 1 && r.j.reviews[0].verdict === "sound" && r.j.missing.length === 0, JSON.stringify(r.j?.missing));
    r = await api(null, "GET", `/api/v1/submissions/${id}`);
    check("the submission API reports the review", r.j?.review?.required === true && r.j.review.recheck === "pass", JSON.stringify(r.j?.review));
    console.log(`Now approve ${BASE}/s/${id} as a moderator, then: node scripts/e2e-review.mjs approved   (problem ${slug})`);
  } else if (step === "approved") {
    const { id } = load();
    const { rows: [s] } = await db.query("SELECT s.*, p.resolution, p.solved_on_platform FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE public_id=$1", [id]);
    check("approved: verified and reviewed", s.status === "verified" && !!s.reviewed_at, `${s.status} ${s.reviewed_at}`);
    check("the problem now counts as settled here", !!s.resolution && s.solved_on_platform, `${s.resolution}`);
    const { rows: pts } = await db.query("SELECT delta, reason FROM point_events WHERE submission_id=$1", [s.id]);
    check("points awarded", pts.some((p) => p.delta > 0), JSON.stringify(pts));
  } else if (step === "cleanup") {
    const { author, reviewer, mod } = load();
    const all = [author.id, reviewer.id, ...(mod ? [mod.id] : [])];
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica"); // the event log is append-only (triggers)
    const { rows: subs } = await db.query("SELECT id, problem_id FROM submissions WHERE user_id = ANY($1)", [[author.id, reviewer.id]]);
    const ids = subs.map((x) => x.id), pids = [...new Set(subs.map((x) => x.problem_id))];
    await db.query("DELETE FROM problem_events WHERE (ref_type='submission' AND ref_id = ANY($1)) OR user_id = ANY($2)", [ids, [author.id, reviewer.id]]);
    await db.query("DELETE FROM point_events WHERE submission_id = ANY($1) OR user_id = ANY($2)", [ids, [author.id, reviewer.id]]);
    await db.query("DELETE FROM audit_log WHERE target = ANY($1)", [(await db.query("SELECT public_id FROM submissions WHERE id = ANY($1)", [ids])).rows.map((r) => r.public_id)]);
    await db.query("DELETE FROM submissions WHERE id = ANY($1)", [ids]);
    await db.query("DELETE FROM audit_log WHERE actor_id = ANY($1)", [all]);
    await db.query("DELETE FROM sessions WHERE user_id = ANY($1)", [all]).catch(() => {});
    await db.query("DELETE FROM api_keys WHERE user_id = ANY($1)", [all]);
    await db.query("DELETE FROM users WHERE id = ANY($1)", [all]);
    for (const pid of pids) await db.query("UPDATE problems SET resolution=NULL, solved_on_platform=false WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM submissions WHERE problem_id=$1 AND status='verified' AND kind IN ('proof','disproof'))", [pid]);
    await db.query("COMMIT");
    fs.rmSync(STATE, { force: true }); fs.rmSync("var/e2e-review-mod.txt", { force: true });
    console.log("cleaned up");
  } else {
    console.log("usage: see the header of this file");
  }
} catch (e) {
  fail++; console.error(e);
  await db.query("ROLLBACK").catch(() => {});
} finally {
  await db.end();
  if (step !== "cleanup") console.log(`${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
