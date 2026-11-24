// Lean stages on GitHub Actions (repository nosorry-maths/nosorry-verify, workflow verify.yml).
// The worker keeps the JavaScript stages and the verdict; this module only runs the Lean commands remotely:
//   1. one commit on a fresh branch jobs/<id> with job/Challenge.lean, job/Solution.lean, job/plan.json
//   2. workflow_dispatch of verify.yml on main with that branch
//   3. wait for the run, read its log, take the last "NOSORRY-RESULT <base64>" line, check its nonce
//   4. delete the branch
// Results have the same shape as the local sandbox: { stages: { ref|sub|compare|metric|kernel|inspect: {code,out,ms,timedOut} } }.
import fs from "node:fs";
import crypto from "node:crypto";

const REPO = process.env.GITHUB_VERIFY_REPO ?? "nosorry-maths/nosorry-verify";
const WORKFLOW = process.env.GITHUB_VERIFY_WORKFLOW ?? "verify.yml";
const API = "https://api.github.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  if (process.env.GITHUB_VERIFY_TOKEN) return process.env.GITHUB_VERIFY_TOKEN.trim();
  const f = process.env.GITHUB_VERIFY_TOKEN_FILE ?? "var/github-token.txt";
  return fs.readFileSync(f, "utf8").trim();
}

async function gh(method, p, body, { raw = false, okStatuses = [] } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(p.startsWith("http") ? p : `${API}${p}`, {
      method,
      headers: { authorization: `Bearer ${token()}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "nosorry-worker", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "follow",
    });
    if (r.ok || okStatuses.includes(r.status)) return raw ? r.text() : r.status === 204 || r.status === 205 ? null : r.json().catch(() => null);
    // Transient: rate limits and server errors — back off and retry a few times.
    if ((r.status === 429 || r.status >= 500 || r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") && attempt < 5) { await sleep(5000 * (attempt + 1)); continue; }
    const text = await r.text().catch(() => "");
    throw new Error(`GitHub ${method} ${p.replace(API, "")}: HTTP ${r.status} ${text.slice(0, 300)}`);
  }
}

export const githubBackendName = () => `github:${REPO}`;

/**
 * Run the Lean stages of one job remotely.
 * @param {{jobId:number|string, kind:string, target:string, metricDecl?:string|null, challenge:string, solution?:string|null, repo?:{url:string,commit:string,module:string}|null}} job
 * @param {(msg:string)=>void} log
 */
export async function runRemote(job, log = () => {}, { timeoutMs = 130 * 60_000 } = {}) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const branch = `jobs/${String(job.jobId).replace(/[^0-9a-z-]/gi, "").toLowerCase()}-${Date.now().toString(36)}`;
  const plan = { nonce, kind: job.kind, target: job.target, metric_decl: job.metricDecl ?? null, ...(job.repo ? { repo: job.repo } : {}) };
  // 1. the job commit (orphan: the branch holds only the job's files)
  const files = { "job/plan.json": JSON.stringify(plan), "job/Challenge.lean": job.challenge, ...(job.solution != null ? { "job/Solution.lean": job.solution } : {}) };
  const tree = [];
  for (const [p, content] of Object.entries(files)) {
    const b = await gh("POST", `/repos/${REPO}/git/blobs`, { content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" });
    tree.push({ path: p, mode: "100644", type: "blob", sha: b.sha });
  }
  const t = await gh("POST", `/repos/${REPO}/git/trees`, { tree });
  const c = await gh("POST", `/repos/${REPO}/git/commits`, { message: `job ${job.jobId}`, tree: t.sha, parents: [], author: { name: "nosorry verifier", email: "verifier@nosorry.invalid" } /* no GitHub account has this address */ });
  await gh("POST", `/repos/${REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: c.sha });
  try {
    // 2. dispatch, then find the run by its name ("verify <branch>")
    const since = Date.now() - 60_000;
    await gh("POST", `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { ref: "main", inputs: { branch } });
    let run = null;
    for (let i = 0; i < 40 && !run; i++) {
      await sleep(i === 0 ? 4000 : 6000);
      const list = await gh("GET", `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`);
      run = (list.workflow_runs ?? []).find((r) => r.display_title === `verify ${branch}` && new Date(r.created_at).getTime() >= since) ?? null;
    }
    if (!run) throw new Error("the GitHub run did not start");
    log(`github run ${run.html_url}`);
    // 3. wait
    const t0 = Date.now();
    while (run.status !== "completed") {
      if (Date.now() - t0 > timeoutMs) throw new Error(`the GitHub run did not finish in time (${run.html_url})`);
      await sleep(20_000);
      run = await gh("GET", `/repos/${REPO}/actions/runs/${run.id}`);
    }
    const jobs = await gh("GET", `/repos/${REPO}/actions/runs/${run.id}/jobs`);
    const j = (jobs.jobs ?? [])[0];
    if (!j) throw new Error(`no job in run ${run.html_url}`);
    let text = null;
    for (let i = 0; i < 6 && text == null; i++) { // logs can take a few seconds to be available after completion
      text = await gh("GET", `/repos/${REPO}/actions/jobs/${j.id}/logs`, null, { raw: true }).catch((e) => (i === 5 ? Promise.reject(e) : null));
      if (text == null) await sleep(5000);
    }
    // The result line is printed by the last, trusted step; take the last one and check it carries our nonce.
    const lines = text.split("\n").filter((l) => /^\S+\s+NOSORRY-RESULT\s+/.test(l));
    if (!lines.length) throw new Error(`no result in the log of ${run.html_url} (conclusion: ${run.conclusion})`);
    const b64 = lines[lines.length - 1].replace(/^\S+\s+NOSORRY-RESULT\s+/, "").trim();
    const result = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (result.error) throw new Error(`verifier run failed: ${result.error} (${run.html_url})`);
    // A repository refused by the trusted setup (lakefile.lean, dependency not allowed, …): a verdict, not a fault.
    if (result.refused) return { ...result, refused: String(result.refused).slice(0, 2000), run_url: run.html_url, stages: {} };
    if (result.nonce !== nonce) throw new Error(`result does not belong to this job (${run.html_url})`);
    return { ...result, run_url: run.html_url, run_seconds: Math.round((new Date(run.updated_at) - new Date(run.run_started_at ?? run.created_at)) / 1000) };
  } finally {
    // 4. the branch is not needed anymore (the run log keeps everything)
    await gh("DELETE", `/repos/${REPO}/git/refs/heads/${branch}`, null, { okStatuses: [404, 422] }).catch(() => {});
  }
}
