// nosorry verification worker.
//   node worker/worker.mjs            run forever (start as many as you want, on as many machines as you want)
//   node worker/worker.mjs --once     process the queue until empty, then exit
//
// Jobs are claimed with SELECT … FOR UPDATE SKIP LOCKED, so N workers never take the same job.
// A worker heartbeats while running; jobs whose heartbeat is stale are re-queued by any other worker.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { preflight, fingerprint } from "../shared/preflight.mjs";
import { proofHold } from "../shared/scoring.mjs";
import { rescoreProblem } from "../shared/ledger.mjs";
import { needsStatusReview } from "../shared/review.mjs";
import { checkRecord } from "../shared/records.mjs";
import { creditBookCites } from "../shared/knowledge.mjs";
import { acceptLemmaStatement, rejectLemmaStatement, onLemmaProved, creditLemmaUses, shareOpenLemmas } from "../shared/lemmas.mjs";
import { maybeSyncAixiv } from "../shared/aixiv.mjs";
import { runRemote, githubBackendName } from "./github-backend.mjs";
import { compareProblems, judgeMetric } from "../shared/judge.mjs";
import { maybeCheckUpstream } from "../shared/fc-upstream.mjs";
import { run as runStage, sandboxName } from "./sandbox.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ID = `${os.hostname()}:${process.pid}`;
const JOBS_DIR = process.env.JOBS_DIR ?? path.join(os.tmpdir(), "nosorry-jobs");
const CACHE_DIR = process.env.CACHE_DIR ?? path.join(os.tmpdir(), "nosorry-cache");
const TOOLCHAIN = process.env.LEAN_TOOLCHAIN ?? "leanprover/lean4:v4.33.1";
// Per-workspace toolchains, e.g. LEAN_TOOLCHAINS='{"physlib":"leanprover/lean4:v4.36.0"}'
const TOOLCHAINS = JSON.parse(process.env.LEAN_TOOLCHAINS ?? "{}");
const toolchainFor = (ws) => TOOLCHAINS[ws] ?? TOOLCHAIN;
const KEEP_JOB_DIRS = process.env.KEEP_JOB_DIRS === "true";
const ONCE = process.argv.includes("--once");

// Bounded waits everywhere: a query stuck on a lock must fail (and be logged), not silently freeze heartbeats.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry",
  max: 6, statement_timeout: 120_000, connectionTimeoutMillis: 20_000 });
const log = (...a) => console.log(new Date().toISOString(), `[${WORKER_ID}]`, ...a);

// ─────────── queue ───────────
async function claim() {
  const { rows } = await pool.query(
    `UPDATE jobs SET state='running', locked_by=$1, locked_at=now(), heartbeat_at=now(), attempts=attempts+1
     WHERE id = (
       SELECT j.id FROM jobs j JOIN submissions s ON s.id = j.submission_id
       WHERE j.state='queued' AND j.run_after <= now()
         AND (SELECT count(*) FROM jobs r JOIN submissions rs ON rs.id=r.submission_id
              WHERE r.state='running' AND rs.user_id = s.user_id) < $2
       ORDER BY j.priority,
                (SELECT count(*) FROM jobs q JOIN submissions qs ON qs.id=q.submission_id
                 WHERE q.state='queued' AND qs.user_id = s.user_id AND q.id < j.id),
                j.id
       FOR UPDATE OF j SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [WORKER_ID, Number(process.env.MAX_RUNNING_PER_USER ?? 2)],
  );
  return rows[0] ?? null;
}

async function reapStale() {
  await pool.query(
    `UPDATE jobs SET state = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
            locked_by=NULL, run_after = now() + interval '30 seconds', last_error='worker heartbeat lost'
     WHERE state='running' AND heartbeat_at < now() - interval '5 minutes'`,
  );
  // A run whose job is no longer running (reaped, re-claimed, worker gone) will never finish: close it as abandoned
  // so its submission page does not show it "in progress" forever. The job's next run carries the verdict.
  await pool.query(
    `UPDATE verification_runs r SET finished_at = now(), result = 'abandoned'
     WHERE r.finished_at IS NULL AND r.started_at < now() - interval '5 minutes'
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = r.job_id AND j.state = 'running' AND j.locked_by = r.worker_id)`,
  );
}

// ─────────── pipeline ───────────
class Stages {
  constructor(onStart) { this.list = []; this.onStart = onStart; }
  async step(name, fn) {
    const t0 = Date.now();
    const s = { name, status: "running", started: new Date(t0).toISOString() };
    this.list.push(s);
    this.onStart?.();
    try {
      const r = await fn();
      Object.assign(s, { status: r?.status ?? "pass", detail: r?.detail ?? null, ms: Date.now() - t0 });
      return r;
    } catch (e) {
      Object.assign(s, { status: "error", detail: String(e.message ?? e).slice(0, 4000), ms: Date.now() - t0 });
      throw e;
    }
  }
}
class Reject extends Error { constructor(result, msg) { super(msg); this.result = result; } }

/** Copy <name>.olean/.ilean (and module-system siblings) by exact name; regular files only. True if the .olean was copied. */
function copyModule(fromDir, toDir, name) {
  fs.mkdirSync(toDir, { recursive: true });
  let ok = false;
  for (const ext of [".olean", ".ilean", ".olean.server", ".olean.private", ".ir"]) {
    const src = path.join(fromDir, name + ext);
    let st; try { st = fs.lstatSync(src); } catch { continue; }
    if (!st.isFile() || st.size > 512 * 1024 * 1024) continue;
    fs.copyFileSync(src, path.join(toDir, name + ext));
    if (ext === ".olean") ok = true;
  }
  return ok;
}

const tail = (s, n = 6000) => (s.length > n ? "…" + s.slice(-n) : s);

// VERIFIER_BACKEND=github: Lean runs on GitHub Actions (worker/github-backend.mjs), not in a local sandbox.
const REMOTE = process.env.VERIFIER_BACKEND === "github";
let repoInFlight = 0;
// Local Lean commands run one at a time even when several jobs are in flight (Docker memory).
let localQueue = Promise.resolve();
const localLean = (fn) => { const p = localQueue.then(fn, fn); localQueue = p.catch(() => {}); return p; };

async function verify(job) {
  const { rows: [sub] } = await pool.query(
    `SELECT s.*, v.challenge_source, v.decl_name, v.statement_hash, v.version AS statement_version, v.toolchain AS ref_toolchain,
            p.status AS problem_status, p.statement_status, p.needs_answer, p.id AS pid, p.metric_decl, p.metric_name,
            COALESCE(v.workspace, CASE WHEN p.collection = 'physlib' THEN 'physlib' ELSE 'formal-conjectures' END) AS workspace
     FROM submissions s LEFT JOIN problem_versions v ON v.id = s.problem_version_id
     LEFT JOIN problems p ON p.id = s.problem_id WHERE s.id = $1`,
    [job.submission_id],
  );
  if (!sub) { await pool.query("UPDATE jobs SET state='done', finished_at=now(), last_error='submission gone' WHERE id=$1", [job.id]); return; }
  // Repository submissions build for hours on GitHub: one at a time, the others wait their turn in the queue.
  const isRepo = !!sub.source_repo;
  if (isRepo && repoInFlight >= 1) {
    await pool.query("UPDATE jobs SET state='queued', locked_by=NULL, attempts=greatest(attempts-1,0), run_after=now()+interval '3 minutes' WHERE id=$1", [job.id]);
    return;
  }
  if (isRepo) repoInFlight++;
  try { await verifyOne(job, sub, isRepo); } finally { if (isRepo) repoInFlight--; }
}

async function verifyOne(job, sub, isRepo) {
  await pool.query("UPDATE submissions SET status='running' WHERE id=$1", [sub.id]);
  const { rows: [vr] } = await pool.query(
    "INSERT INTO verification_runs(submission_id, job_id, worker_id, toolchain, sandbox) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [sub.id, job.id, WORKER_ID, toolchainFor(sub.workspace), REMOTE && sub.workspace !== "physlib" ? githubBackendName() : sandboxName(sub.workspace)],
  );
  // The page shows a live timer on the running stage: publish each stage as soon as it starts.
  const st = new Stages(() => { flush().catch(() => {}); });
  const flush = () => pool.query("UPDATE verification_runs SET stages=$2 WHERE id=$1", [vr.id, JSON.stringify(st.list)]);
  const hb = setInterval(() => {
    pool.query("UPDATE jobs SET heartbeat_at=now() WHERE id=$1", [job.id]).catch((e) => log(`job ${job.id} heartbeat failed:`, e.message));
    flush().catch((e) => log(`job ${job.id} stage flush failed:`, e.message));
  }, 15_000);

  const jobDir = path.join(JOBS_DIR, `job-${job.id}-${Date.now()}`);
  // Every stage of this job runs in the Lean workspace of the statement (its own image / toolchain / libraries).
  const run = (dir, tool, args, opts = {}) => localLean(() => runStage(dir, tool, args, { ...opts, workspace: sub.workspace }));
  let result = "error", verdict = {};
  try {
  pipeline: {
    const isFormalization = sub.kind === "formalization";
    const challengeSrc = isFormalization ? sub.lean_source : sub.challenge_source;
    const target = isFormalization ? sub.verdict?.decl_name : sub.decl_name;
    if (!target) throw new Reject("rejected", "no target declaration");

    // 1. static checks
    await st.step("preflight", async () => {
      if (isRepo) {
        if (!REMOTE) throw new Reject("error", "repository submissions are checked on the GitHub verifier, which is not enabled on this worker");
        return { detail: `repository ${sub.source_repo} @ ${String(sub.source_commit).slice(0, 12)}, module ${sub.source_module}: the static rules do not apply; every declaration of the repository that the proof uses is replayed in the kernel` };
      }
      // A lemma statement is checked inside its problem's Challenge.lean: what it inherits from that reference is exempt.
      let refForRules = isFormalization ? undefined : challengeSrc;
      if (isFormalization && sub.problem_status === "lemma" && sub.pid) {
        const { rows: [par] } = await pool.query(
          `SELECT v.challenge_source FROM problems l JOIN problems p ON p.id=l.parent_id JOIN problem_versions v ON v.id=p.current_version_id WHERE l.id=$1`, [sub.pid]);
        refForRules = par?.challenge_source ?? undefined;
      }
      const pf = preflight(sub.lean_source, { kind: sub.kind, challenge: refForRules });
      if (!pf.ok) throw new Reject("rejected", pf.errors.map((e) => e.message).join("; "));
      return { detail: pf.warnings.join("\n") || `imports: ${pf.imports.join(", ") || "none"}` };
    });

    // 2. duplicate / plagiarism
    const fp = fingerprint(sub.lean_source);
    await st.step("originality", async () => {
      await pool.query("UPDATE submissions SET proof_fingerprint=$2 WHERE id=$1", [sub.id, fp]);
      const { rows } = await pool.query(
        // Per problem: one file may legitimately settle several statements (e.g. the parts of a problem).
        `SELECT public_id, user_id FROM submissions WHERE proof_fingerprint=$1 AND id < $2
         AND status IN ('verified','partial','accepted','needs_review')
         AND (kind = 'formalization') = $3 AND problem_id = $4 ORDER BY id LIMIT 1`, [fp, sub.id, sub.kind === "formalization", sub.problem_id]);
      if (rows[0] && Number(rows[0].user_id) !== Number(sub.user_id)) throw new Reject("duplicate", `identical to earlier submission ${rows[0].public_id} on this problem`);
      return { detail: rows[0] ? `same as your own ${rows[0].public_id}` : "no identical earlier submission" };
    });

    // Lean on GitHub Actions (VERIFIER_BACKEND=github): every Lean command of this job runs in ONE remote run, with the
    // same commands as below; the stages that follow then read their results instead of running Lean here.
    let remote = null;
    if (REMOTE) {
      await st.step("github run", async () => {
        remote = await runRemote({ jobId: isRepo ? `repo-${job.id}` : job.id, kind: sub.kind, target, metricDecl: sub.metric_decl, challenge: challengeSrc,
          solution: isFormalization || isRepo ? null : sub.lean_source,
          repo: isRepo ? { url: sub.source_repo, commit: sub.source_commit, module: sub.source_module } : null },
          (m) => log(`job ${job.id}: ${m}`), isRepo ? { timeoutMs: 6.5 * 3600_000 } : undefined);
        if (remote.refused) throw new Reject("rejected", `repository refused: ${remote.refused}`);
        return { detail: `${remote.run_url} · ${remote.toolchain} · ${remote.run_seconds} s` };
      });
    }
    const exec = (key, dir, tool, args, opts) => remote
      ? Promise.resolve(remote.stages[key] ?? { code: -3, out: "not run (an earlier Lean stage failed on GitHub)", ms: 0, timedOut: false })
      : run(dir, tool, args, opts);

    // Three separate directories, so that code running while the submission compiles can never touch
    // the reference, the checker, or what the checker loads:
    //   ref/  reference statement (compiled once per statement hash, then cached)
    //   sub/  the untrusted submission: the only stage with a writable mount
    //   chk/  fresh dir: trusted Compare.lean + Challenge.* from ref/cache + Solution.olean/.ilean copied by exact name.
    //         Checker stages mount it read-only.
    const refDir = path.join(jobDir, "ref"), subDir = path.join(jobDir, "sub"), chkDir = path.join(jobDir, "chk");
    for (const d of [refDir, subDir, chkDir]) { fs.mkdirSync(path.join(d, "src"), { recursive: true }); fs.mkdirSync(path.join(d, "out"), { recursive: true }); }
    // Sandboxes run as an unprivileged uid: they may write only to the out/ of ref/ and sub/ (chk/ is mounted read-only).
    if (process.env.VERIFIER_SANDBOX === "docker") for (const d of [refDir, subDir]) fs.chmodSync(path.join(d, "out"), 0o777);
    fs.writeFileSync(path.join(refDir, "src", "Challenge.lean"), challengeSrc);
    if (!isFormalization) fs.writeFileSync(path.join(subDir, "src", "Solution.lean"), sub.lean_source);
    fs.copyFileSync(path.join(here, "lean", "Compare.lean"), path.join(chkDir, "src", "Compare.lean"));

    // 3. reference statement (cached by hash — compiled once per statement version)
    await st.step("compile reference statement", async () => {
      const cache = path.join(CACHE_DIR, "challenge", `${sub.workspace}-${sub.statement_hash ?? fp}`);
      if (!remote && !isFormalization && fs.existsSync(path.join(cache, "Challenge.olean"))) {
        copyModule(cache, path.join(chkDir, "out"), "Challenge");
        return { detail: "from cache" };
      }
      const r = await exec("ref", refDir, "lean", ["src/Challenge.lean", "-o", "out/Challenge.olean", "-i", "out/Challenge.ilean"]);
      if (r.code !== 0) throw new Reject(isFormalization ? "rejected" : "error", `reference does not compile:\n${tail(r.out)}`);
      if (!remote) {
        copyModule(path.join(refDir, "out"), path.join(chkDir, "out"), "Challenge");
        if (!isFormalization) copyModule(path.join(refDir, "out"), cache, "Challenge");
      }
      return {};
    });

    if (isFormalization) {
      // A formalization must compile and its target must be stated with `sorry` (it is a problem, not a proof).
      const r = await st.step("inspect statement", async () => {
        const c = await exec("inspect", chkDir, "lean", ["--run", "src/Compare.lean", "inspect", "Challenge", target], { timeoutMs: 10 * 60_000, readOnly: true });
        let j; try { j = JSON.parse(c.out.trim().split("\n").pop() || "{}"); } catch { j = {}; }
        if (!j.target) throw new Reject("rejected", `target ${target} not found`);
        if (!j.is_theorem) throw new Reject("rejected", `${target} must be a theorem`);
        if (!j.has_sorry || !(j.open_lemmas ?? []).includes(j.target)) throw new Reject("rejected", `${target} must be stated with sorry as its proof: a formalization is a problem, not a proof`);
        const bad = (j.axioms ?? []).filter((a) => !["propext", "Classical.choice", "Quot.sound", "sorryAx"].includes(a));
        if (bad.length) throw new Reject("rejected", `the statement introduces axioms: ${bad.join(", ")}`);
        return { detail: `axioms: ${(j.axioms ?? []).join(", ")}`, j };
      });
      verdict = { decl_name: target, compiles: true, ...r.j };
      result = "needs_review";
      // Leave the pipeline (proof stages do not apply) but still go through finish() below — a `return` here used to
      // skip it, leaving every accepted formalization "running" forever.
      break pipeline;
    }

    // 4. the submission itself (untrusted → sandbox)
    await st.step("compile submission", async () => {
      const r = await exec("sub", subDir, "lean", ["src/Solution.lean", "-o", "out/Solution.olean", "-i", "out/Solution.ilean"]);
      if (r.timedOut) throw new Reject("rejected", "compilation timed out");
      if (r.code !== 0) throw new Reject("rejected", `does not compile:\n${tail(r.out)}`);
      // Only the expected artefacts leave the untrusted directory, by exact name, regular files only.
      if (remote ? r.no_olean : !copyModule(path.join(subDir, "out"), path.join(chkDir, "out"), "Solution")) throw new Reject("rejected", "compilation produced no Solution.olean");
      return {};
    });
    await pool.query("UPDATE submissions SET badge_compiles=true WHERE id=$1", [sub.id]);

    // 5. statement + axioms (separate environments)
    const cmp = await st.step("statement & axioms", async () => {
      const args = ["--run", "src/Compare.lean", "Challenge", "Solution", target, ...(sub.kind === "disproof" ? ["neg"] : [])];
      const r = await exec("compare", chkDir, "lean", args, { timeoutMs: 10 * 60_000, readOnly: true });
      let j;
      try { j = JSON.parse(r.out.trim().split("\n").pop()); } catch { throw new Error(`checker output unreadable:\n${tail(r.out, 2000)}`); }
      if (j.error) {
        // Say exactly which name a disproof must use (the reference name with its last part prefixed by not_).
        const expected = target.replace(/\.([^.]+)$/, ".not_$1").replace(/^([^.]+)$/, "not_$1");
        throw new Reject("rejected", sub.kind === "disproof" && /not found in the submission/.test(j.error)
          ? `${j.error}. A disproof must declare \`theorem ${expected} : ¬ (<the reference statement>)\` — the reference name with its last part prefixed by not_.`
          : j.error);
      }
      const problems = compareProblems(j, { kind: sub.kind, needsAnswer: !!sub.needs_answer });
      const detail = `axioms: [${j.axioms.join(", ")}]` + (j.open_lemmas.length ? `\nopen lemmas: ${j.open_lemmas.join(", ")}` : "");
      if (problems.length) throw new Reject("rejected", problems.join("; ") + "\n" + detail);
      return { detail, j };
    });
    verdict = cmp.j;
    if (remote) {
      verdict = { ...verdict, toolchain: remote.toolchain };
      // A repository may use its own Lean/Mathlib: the statement was compiled with the same versions, and the verdict says so.
      if (remote.toolchain && sub.ref_toolchain && remote.toolchain !== sub.ref_toolchain)
        verdict = { ...verdict, foreign_toolchain: true, reference_toolchain: sub.ref_toolchain };
    }

    // 5b. metric challenges: the cost theorem must also be proved; its value (the hole in the reference) is extracted.
    if (sub.metric_decl && sub.kind === "proof") {
      const m = await st.step("metric", async () => {
        const r = await exec("metric", chkDir, "lean", ["--run", "src/Compare.lean", "Challenge", "Solution", sub.metric_decl], { timeoutMs: 10 * 60_000, readOnly: true });
        let j;
        try { j = JSON.parse(r.out.trim().split("\n").pop()); } catch { throw new Error(`checker output unreadable:\n${tail(r.out, 2000)}`); }
        const v = judgeMetric(j, sub.metric_decl);
        if (!v.ok) throw new Reject("rejected", v.error);
        return { detail: `${sub.metric_name} = ${v.value} (proved)`, value: v.value };
      });
      verdict = { ...verdict, metric_value: m.value };
      await pool.query("UPDATE submissions SET metric_value=$2 WHERE id=$1", [sub.id, m.value]);
    }
    await pool.query("UPDATE submissions SET badge_statement=true, badge_axioms=$2, axioms=$3, open_lemmas=$4 WHERE id=$1",
      [sub.id, !cmp.j.has_sorry, cmp.j.axioms, cmp.j.open_lemmas]);

    // 6. kernel replay of everything the submission produced
    await st.step("kernel replay", async () => {
      const r = await exec("kernel", chkDir, "leanchecker", ["Solution"], { timeoutMs: 30 * 60_000, readOnly: true });
      if (r.code !== 0) throw new Reject("rejected", `kernel replay failed:\n${tail(r.out)}`);
      return {};
    });

    // 7. optional: leanprover/comparator as the final authority
    if (process.env.COMPARATOR_BIN && sub.kind !== "disproof") {
      await st.step("comparator", async () => {
        fs.writeFileSync(path.join(chkDir, "comparator.json"), JSON.stringify({
          challenge_module: "Challenge", solution_module: "Solution", theorem_names: [target],
          definition_names: cmp.j.checked_definitions ?? [], permitted_axioms: ["propext", "Quot.sound", "Classical.choice"],
          enable_nanoda: process.env.COMPARATOR_NANODA === "true",
        }));
        const r = await run(chkDir, "comparator", ["comparator.json"], { timeoutMs: 30 * 60_000, readOnly: true });
        if (r.code !== 0) throw new Reject("rejected", `comparator rejected:\n${tail(r.out)}`);
        return {};
      });
    } else {
      st.list.push({ name: "comparator", status: "skipped", detail: sub.kind === "disproof" ? "not applicable to disproofs" : "not configured on this worker (COMPARATOR_BIN)" });
    }

    if (cmp.j.has_sorry) result = "partial";
    else if (cmp.j.answer_filled) result = "needs_review";
    else result = "verified";
    if (sub.kind === "partial" && !cmp.j.has_sorry) {
      // A "partial" proof with nothing left open is a complete proof.
      sub.kind = "proof";
      await pool.query("UPDATE submissions SET kind='proof', open_lemmas='{}' WHERE id=$1", [sub.id]);
    }
  } // end pipeline
  } catch (e) {
    if (e instanceof Reject) {
      result = e.result;
      if (!st.list.some((s) => s.status === "error")) st.list.push({ name: "verdict", status: "fail", detail: e.message.slice(0, 4000) });
      else st.list[st.list.length - 1].status = "fail";
    } else {
      result = "error";
      log("job", job.id, "error", e);
    }
  } finally {
    clearInterval(hb);
    if (!KEEP_JOB_DIRS) fs.rmSync(jobDir, { recursive: true, force: true });
  }

  await finish(sub, vr.id, st.list, result, verdict, job);
}

async function finish(sub, runId, stages, result, verdict, job) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Exclusivity: if the job was reaped and re-claimed meanwhile, this verdict is discarded.
    const own = await c.query("SELECT 1 FROM jobs WHERE id=$1 AND locked_by=$2 AND state='running' FOR UPDATE", [job.id, WORKER_ID]);
    if (!own.rowCount) {
      await c.query("ROLLBACK");
      // Close our run anyway (the verdict belongs to whoever owns the job now).
      await pool.query("UPDATE verification_runs SET finished_at=now(), result='abandoned', stages=$2 WHERE id=$1 AND finished_at IS NULL",
        [runId, JSON.stringify(stages)]).catch(() => {});
      log(`job ${job.id} no longer ours; verdict discarded, run ${runId} closed as abandoned`);
      return;
    }
    await c.query("UPDATE verification_runs SET finished_at=now(), result=$2, stages=$3 WHERE id=$1", [runId, result, JSON.stringify(stages)]);
    const v = { ...verdict, problem_status: sub.problem_status, statement_version: sub.statement_version };
    if (result === "error" && job.attempts < job.max_attempts) {
      await c.query("UPDATE jobs SET state='queued', run_after=now() + interval '2 minutes', locked_by=NULL WHERE id=$1", [job.id]);
      await c.query("UPDATE submissions SET status='queued' WHERE id=$1", [sub.id]);
    } else {
      await c.query("UPDATE jobs SET state='done', finished_at=now() WHERE id=$1", [job.id]);
      let hold = result === "verified" && sub.kind !== "partial" ? proofHold({ statementStatus: sub.statement_status, answerFilled: v.answer_filled }) : null;
      // A result that changes the problem's status (first proof or disproof of an open problem, or one contradicting the
      // current resolution) counts at once (Lean accepted it) and is opened to community review: members vote, comment and
      // suggest changes, and a moderator confirms it ("human-verified") or revokes it.
      const review = result === "verified" && !hold && await needsStatusReview(c, sub);
      const status = hold && result === "verified" ? "needs_review" : result;
      await c.query(
        `UPDATE submissions SET status=$2, verdict=$3, verified_at = CASE WHEN $2 IN ('verified','partial') OR $5 THEN now() ELSE verified_at END,
         review_required = review_required OR $5,
         review_note = COALESCE($4, review_note),
         visibility = CASE WHEN $2 IN ('verified','partial','needs_review') THEN visibility ELSE 'private' END
         WHERE id=$1`,
        [sub.id, status, JSON.stringify(v), review ? null : hold /* the Review section of the page says it */, !!review],
      );
      if (review) await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary)
          SELECT $1,'review.hold',$2,'submission',$3, 'Lean accepts a ' || $4 || ' by ' || handle || ': it counts now, and is open to community review until a moderator confirms it (human-verified)'
          FROM users WHERE id=$2`, [sub.pid, sub.user_id, sub.id, sub.kind]);
      // A complete proof or disproof made under a desk lease ends the task: the lease is released ("submitted") and the
      // leads opened under it are closed. A rejected attempt keeps the lease, so the agent can fix it and try again.
      if (sub.desk_lease_id && job.kind === "verify" && (sub.kind === "proof" || sub.kind === "disproof") && (status === "verified" || status === "needs_review")) {
        const { rows: rel } = await c.query(
          `UPDATE desk_leases SET state='released', reason='submitted', submission_id=$2, ended_at=now()
           WHERE id=$1 AND state='active' RETURNING id, problem_id, focus_id`, [sub.desk_lease_id, sub.id]);
        if (rel.length) {
          const { rows: leads } = await c.query(
            `UPDATE leads SET status='closed', outcome='abandoned', outcome_note=$2, closed_at=now()
             WHERE desk_lease_id=$1 AND status <> 'closed' RETURNING id, problem_id, approach`,
            [sub.desk_lease_id, `desk task done: ${sub.public_id} accepted by Lean`]);
          for (const l of leads) await c.query(
            `INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary, unverified) VALUES ($1,'lead.close',$2,'lead',$3,$4,true)`,
            [l.problem_id, sub.user_id, l.id, `Lead closed with its desk task (${sub.public_id} accepted by Lean): ${l.approach}`]);
          await c.query(`INSERT INTO problem_events(problem_id, type, user_id, summary) VALUES ($1,'desk.release',$2,$3)`,
            [rel[0].focus_id ?? rel[0].problem_id, sub.user_id, `Desk task done: ${sub.public_id} accepted by Lean (lease released automatically)`]);
        }
      }
      // Lemmas: their statement check is accepted automatically (no human review: a lemma only matters when used).
      if (sub.kind === "formalization" && sub.problem_status === "lemma") {
        if (status === "needs_review") {
          await acceptLemmaStatement(c, { ...sub, verdict: { ...(sub.verdict ?? {}), ...v } });
          await c.query("UPDATE submissions SET status='accepted' WHERE id=$1", [sub.id]);
        } else if (status === "rejected" || status === "duplicate") {
          await rejectLemmaStatement(c, sub, (stages.find((x) => x.status === "fail") ?? {}).detail ?? status);
        }
      }
      // Only a "does not match any more" verdict supersedes a proof; an infrastructure error never costs points.
      if (job.kind === "reverify" && (status === "rejected" || status === "duplicate")) {
        await c.query("UPDATE submissions SET status='superseded' WHERE id=$1", [sub.id]);
      }
      if (job.kind === "reverify" && sub.pid) {
        // Last re-check after a statement correction: the statement is trusted again, points unfreeze.
        await c.query(`UPDATE problems p SET statement_status='reviewed', recheck_pending=false
          WHERE p.id=$1 AND p.recheck_pending AND NOT EXISTS (
            SELECT 1 FROM jobs j JOIN submissions s ON s.id=j.submission_id
            WHERE s.problem_id=p.id AND j.kind='reverify' AND j.state IN ('queued','running') AND j.id<>$2)`, [sub.pid, job.id]);
      }
      if (sub.pid && sub.metric_decl && status === "verified" && v.metric_value != null) {
        // Metric challenges are scored by records (with lineage), not by first-proof bonuses.
        const rec = await checkRecord(c, sub, Number(v.metric_value));
        await c.query("UPDATE submissions SET verdict = verdict || $2::jsonb WHERE id=$1", [sub.id, JSON.stringify({ record: rec })]);
      } else if (sub.pid && (sub.kind === "proof" || sub.kind === "disproof")) {
        await rescoreProblem(c, sub.pid);
        if (status === "verified") await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary)
          SELECT $1,'verified',$2,'submission',$3, 'Verified ' || $4 || ' by ' || handle FROM users WHERE id=$2`, [sub.pid, sub.user_id, sub.id, sub.kind]);
        if (status === "verified" && sub.kind === "proof" && sub.problem_status === "lemma") await onLemmaProved(c, sub);
      }
      // A complete proof that reuses proved lemmas credits their authors (once per proof, never yourself).
      if (sub.pid && status === "verified" && job.kind !== "reverify") {
        const used = await creditLemmaUses(c, sub, v.own_decls);
        if (used.length) await c.query("UPDATE submissions SET verdict = verdict || $2::jsonb WHERE id=$1", [sub.id, JSON.stringify({ lemmas_used: used })]);
      }
      // Book entries cited by an accepted proof or partial proof: recorded, and their authors credited (knowledge.mjs).
      if (sub.pid && (status === "verified" || status === "partial") && job.kind !== "reverify") {
        const cited = await creditBookCites(c, sub);
        if (cited.length) await c.query("UPDATE submissions SET verdict = verdict || $2::jsonb WHERE id=$1", [sub.id, JSON.stringify({ book_cited: cited })]);
      }
      // The author asked to share what is left open: each open lemma becomes an intermediate problem (statements only).
      if (sub.pid && status === "partial" && sub.share_lemmas && job.kind !== "reverify") {
        const shared = await shareOpenLemmas(c, { ...sub, verdict: v }, sub.agent_name);
        await c.query("UPDATE submissions SET verdict = verdict || $2::jsonb WHERE id=$1", [sub.id, JSON.stringify({ lemmas_shared: shared.map((x) => ({ name: x.name, ok: x.ok, slug: x.slug, error: x.error })) })]);
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  log(`submission ${sub.public_id} → ${result}`);
}

// ─────────── main loop ───────────
let lastRefresh = 0;
async function refreshLeaderboard(force = false) {
  if (!force && Date.now() - lastRefresh < 30_000) return;
  lastRefresh = Date.now();
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard").catch((e) => log("refresh failed", e.message));
}

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

log(`started; ${REMOTE ? `lean on ${githubBackendName()}` : `sandbox=${sandboxName()}`} jobs=${JOBS_DIR}`);
const beat = (jobId = null) => pool.query(
  `INSERT INTO workers(id, sandbox, current_job) VALUES ($1,$2,$3)
   ON CONFLICT (id) DO UPDATE SET heartbeat_at=now(), current_job=$3`, [WORKER_ID, sandboxName(), jobId]).catch(() => {});
await beat();
const beatTimer = setInterval(() => beat(currentJob), 15_000);
// aiXiv cross-reference: once a day, in the background (network only, no Lean; one worker at a time via an advisory lock).
// formal-conjectures watch: same rhythm (metadata/status applied, the rest listed for the batch update).
const aixivTick = async () => {
  // Privacy policy: IP addresses are kept 12 months; ended sessions and burned 2FA codes are removed.
  await pool.query("UPDATE submissions SET client_ip=NULL WHERE client_ip IS NOT NULL AND created_at < now() - interval '12 months'").catch((e) => log("ip purge failed", e.message));
  await pool.query("UPDATE audit_log SET ip=NULL WHERE ip IS NOT NULL AND created_at < now() - interval '12 months'").catch((e) => log("audit ip purge failed", e.message));
  await pool.query("DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - interval '14 days'").catch(() => {});
  await maybeSyncAixiv(pool, (...a) => log(...a)).catch((e) => log("aixiv sync failed", e.message));
  await maybeCheckUpstream(pool, (...a) => log(...a)).catch((e) => log("upstream check failed", e.message));
};
const aixivBoot = setTimeout(aixivTick, 60_000);
const aixivTimer = setInterval(aixivTick, 3600_000);
let currentJob = null;
// With Lean on GitHub a job mostly waits for its remote run, so several run at once (GitHub allows about 20 runs per
// organization). Local Lean stays one job at a time (the Docker VM's memory).
const CONCURRENCY = REMOTE ? Math.max(1, Math.min(20, Number(process.env.WORKER_CONCURRENCY ?? 4))) : 1;
const inflight = new Set();
async function handle(job) {
  currentJob = job.id; beat(job.id);
  try { await verify(job); } catch (e) {
    log("fatal on job", job.id, e);
    await pool.query("UPDATE jobs SET state = CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'queued' END, last_error=$2, locked_by=NULL, run_after=now()+interval '1 minute' WHERE id=$1", [job.id, String(e).slice(0, 2000)]).catch(() => {});
  }
  if (currentJob === job.id) currentJob = null;
  await refreshLeaderboard();
}
while (!stopping) {
  await reapStale().catch(() => {});
  if (inflight.size >= CONCURRENCY) { await Promise.race(inflight); continue; }
  const job = await claim().catch((e) => { log("claim failed", e.message); return null; });
  if (!job) {
    if (!inflight.size) { await refreshLeaderboard(true); if (ONCE) break; }
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  const p = handle(job).finally(() => inflight.delete(p));
  inflight.add(p);
}
await Promise.all(inflight); // a graceful stop lets the jobs in progress finish
clearInterval(beatTimer); clearInterval(aixivTimer); clearTimeout(aixivBoot);
await pool.query("DELETE FROM workers WHERE id=$1", [WORKER_ID]).catch(() => {});
await pool.end();
log("stopped");
