// End-to-end test of the community review of results that change a problem's status, against a running LOCAL site and
// worker (VERIFIER_BACKEND=github), with temporary accounts.
//   node scripts/e2e-review.mjs submit <problem slug> <Solution.lean> [proof|disproof]   author + member accounts, submission
//   node scripts/e2e-review.mjs check       after the worker: held, not counted; votes, comments, a suggestion, applied
//   node scripts/e2e-review.mjs revision    after the worker checked the revision: held again, the old one superseded
//   node scripts/e2e-review.mjs approved    after a moderator approved the revision in the browser: it counts
//   node scripts/e2e-review.mjs cleanup     delete the temporary accounts and everything they created
// State between steps: var/e2e-review.json (var/ is never committed). A local moderator account for the approval step,
// if any, is listed there as "mod" and removed by cleanup too.
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
const save = (st) => fs.writeFileSync(STATE, JSON.stringify(st), { mode: 0o600 });
const subRow = async (id) => (await db.query("SELECT s.*, p.resolution, p.solved_on_platform FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE public_id=$1", [id])).rows[0];
const step = process.argv[2];

try {
  if (step === "submit") {
    const [, , , slug, file, kind = "disproof"] = process.argv;
    const author = await account("author"), member = await account("member"), member2 = await account("member2");
    const r = await api(author.key, "POST", "/api/v1/submissions", { problem: slug, kind, lean_source: fs.readFileSync(file, "utf8"),
      explanation_md: "e2e test of the review flow (a copy of an accepted proof)", agent: { name: "e2e", model: "e2e-model" } });
    check("submission accepted for verification", r.status === 201 || r.status === 202, `${r.status} ${JSON.stringify(r.j).slice(0, 200)}`);
    fs.mkdirSync("var", { recursive: true });
    save({ author, member, member2, slug, id: r.j?.id });
    console.log(`submission ${r.j?.id} by ${author.handle}. Run the worker, then: node scripts/e2e-review.mjs check`);
  } else if (step === "check") {
    const st = load(); const { author, member, member2, id } = st;
    const s = await subRow(id);
    check("held for review (needs_review, review_required)", s.status === "needs_review" && s.review_required, `${s.status} ${s.review_required}`);
    check("the problem is not marked solved", !s.resolution && !s.solved_on_platform, `${s.resolution}`);
    check("no points yet", (await db.query("SELECT 1 FROM point_events WHERE submission_id=$1", [s.id])).rowCount === 0);
    check("no re-run job any more", (await db.query("SELECT 1 FROM jobs WHERE submission_id=$1 AND kind <> 'verify'", [s.id])).rowCount === 0);
    let r = await api(null, "GET", "/api/v1/reviews");
    check("listed in /api/v1/reviews", r.j?.reviews?.some((x) => x.public_id === id));
    r = await api(author.key, "POST", `/api/v1/submissions/${id}/vote`, { value: 1 });
    check("the author cannot vote on their own result", r.status === 403, `${r.status} ${r.j?.error}`);
    r = await api(member.key, "POST", `/api/v1/submissions/${id}/vote`, { value: -1 });
    check("a member downvotes", r.status === 200 && r.j.down === 1, JSON.stringify(r.j));
    r = await api(member.key, "POST", `/api/v1/submissions/${id}/vote`, { value: 1 });
    check("changing a vote replaces it", r.status === 200 && r.j.up === 1 && r.j.down === 0, JSON.stringify(r.j));
    r = await api(member2.key, "POST", `/api/v1/submissions/${id}/vote`, { value: 1 });
    check("a second member upvotes", r.j?.up === 2, JSON.stringify(r.j));
    r = await api(member.key, "POST", `/api/v1/submissions/${id}/comments`, { body_md: "e2e: why this bound on line 3?", line: 3, agent: { name: "e2e", model: "e2e-model" } });
    check("a comment on a line", r.status === 201, `${r.status} ${JSON.stringify(r.j)}`);
    const cid = r.j?.id;
    r = await api(author.key, "POST", `/api/v1/submissions/${id}/comments`, { body_md: "e2e: it is the case k = 1.", reply_to: cid });
    check("the author replies", r.status === 201, `${r.status}`);
    r = await api(member.key, "POST", `/api/v1/submissions/${id}/comments`, { body_md: "x", line: -2 });
    check("a bad line is refused", r.status === 400, `${r.status}`);
    const src = s.lean_source;
    r = await api(member2.key, "POST", `/api/v1/submissions/${id}/suggestions`, { body_md: "e2e: identical", lean_source: src });
    check("an identical suggestion is refused", r.status === 400, `${r.status}`);
    r = await api(member2.key, "POST", `/api/v1/submissions/${id}/suggestions`, { body_md: "e2e: add a comment at the end", lean_source: src + "\n-- reviewed by e2e\n", agent: { name: "e2e", model: "e2e-model" } });
    check("a suggested change", r.status === 201, `${r.status} ${JSON.stringify(r.j)}`);
    const gid = r.j?.id;
    r = await api(member.key, "POST", `/api/v1/submissions/${id}/suggestions/${gid}`, { action: "apply" });
    check("only the author or a moderator applies it", r.status === 403, `${r.status}`);
    r = await api(null, "GET", `/api/v1/submissions/${id}/review`);
    check("the review thread is public", r.j?.votes?.up === 2 && r.j.comments.length === 2 && r.j.suggestions.length === 1, JSON.stringify(r.j?.votes));
    r = await api(author.key, "POST", `/api/v1/submissions/${id}/suggestions/${gid}`, { action: "apply" });
    check("the author applies it: a new revision", r.status === 200 && /^s-/.test(r.j?.revision ?? ""), `${r.status} ${JSON.stringify(r.j)}`);
    const old = await subRow(id);
    check("the original is superseded", old.status === "superseded", old.status);
    save({ ...st, revision: r.j?.revision });
    console.log(`revision ${r.j?.revision}. Let the worker check it, then: node scripts/e2e-review.mjs revision`);
  } else if (step === "revision") {
    const { revision, id, member2 } = load();
    const s = await subRow(revision);
    const { rows: [o] } = await db.query("SELECT id FROM submissions WHERE public_id=$1", [id]);
    check("the revision links to the original", Number(s.revision_of) === Number(o.id));
    check("the revision credits the suggestion", String(s.derived_from).includes(`suggestion #`) && String(s.derived_from).includes(member2.handle), s.derived_from);
    check("the revision is held for review again", s.status === "needs_review" && s.review_required, s.status);
    console.log(`Now approve ${BASE}/s/${revision} as a moderator, then: node scripts/e2e-review.mjs approved`);
  } else if (step === "approved") {
    const { revision } = load();
    const s = await subRow(revision);
    check("approved: verified and reviewed", s.status === "verified" && !!s.reviewed_at, `${s.status} ${s.reviewed_at}`);
    check("the problem now counts as settled here", !!s.resolution && s.solved_on_platform, `${s.resolution}`);
    const { rows: pts } = await db.query("SELECT delta, reason FROM point_events WHERE submission_id=$1", [s.id]);
    check("points awarded", pts.some((p) => p.delta > 0), JSON.stringify(pts));
  } else if (step === "cleanup") {
    const st = load();
    const all = [st.author, st.member, st.member2, st.mod].filter(Boolean).map((x) => x.id);
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica"); // the event log is append-only (triggers)
    const { rows: subs } = await db.query("SELECT id, problem_id, public_id FROM submissions WHERE user_id = ANY($1)", [all]);
    const ids = subs.map((x) => x.id), pids = [...new Set(subs.map((x) => x.problem_id))];
    await db.query("DELETE FROM problem_events WHERE (ref_type='submission' AND ref_id = ANY($1)) OR user_id = ANY($2)", [ids, all]);
    await db.query("DELETE FROM point_events WHERE submission_id = ANY($1) OR user_id = ANY($2)", [ids, all]);
    await db.query("DELETE FROM audit_log WHERE actor_id = ANY($1) OR target = ANY($2)", [all, subs.map((r) => r.public_id)]);
    await db.query("UPDATE submissions SET revision_of=NULL WHERE id = ANY($1)", [ids]);
    await db.query("DELETE FROM submission_suggestions WHERE submission_id = ANY($1) OR user_id = ANY($2)", [ids, all]);
    await db.query("DELETE FROM submission_comments WHERE submission_id = ANY($1) OR user_id = ANY($2)", [ids, all]);
    await db.query("DELETE FROM submission_votes WHERE submission_id = ANY($1) OR user_id = ANY($2)", [ids, all]);
    await db.query("DELETE FROM submissions WHERE id = ANY($1)", [ids]);
    await db.query("DELETE FROM sessions WHERE user_id = ANY($1)", [all]);
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
