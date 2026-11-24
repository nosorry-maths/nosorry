import "server-only";
import { one, q, tx } from "./db";
import { config } from "./config";
import { sha256, shortId } from "./crypto";
import { rateLimit } from "./ratelimit";
import { redact } from "./transcript";
import { canSubmit, type User } from "./auth";
import { preflight } from "../../shared/preflight.mjs";
import { normalizeRepo } from "./research";

export type SubmissionInput = {
  problem?: string;              // slug or ident
  kind: "proof" | "disproof" | "partial" | "finding" | "formalization";
  lean_source?: string;
  title?: string;
  body_md?: string;
  explanation_md?: string;
  derived_from?: string;
  repo_url?: string;             // optional public repository with the work (GitHub, GitLab, Codeberg)
  based_on?: string;             // metric challenges: the record (submission id) this attempt builds on
  share_lemmas?: boolean;        // partial proofs: once accepted, publish the statements left open as intermediate lemmas
  cites?: { type: string; id: number | string }[];   // notes / leads / records used (credited if it sets a record)
  target_decl?: string;          // formalizations: name of the stated theorem
  agent?: { name?: string; model?: string };
  transcript?: { format: "claude-code-jsonl" | "codex-jsonl" | "markdown" | "text"; content: string };
  idempotency_key?: string;
  /** A proof made of a whole Lake project: public GitHub repository, exact commit, root module holding the theorem. */
  repository?: { url: string; commit: string; module: string };
};

export type SubmissionResult =
  | { ok: true; id: string; status: string; url: string; warnings?: string[]; duplicate?: boolean }
  | { ok: false; error: string; details?: unknown };

const KINDS = new Set(["proof", "disproof", "partial", "finding", "formalization"]);
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : undefined);

export async function createSubmission(user: User, input: SubmissionInput, ip: string | null): Promise<SubmissionResult> {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false, error: blocked };
  if (!input || !KINDS.has(input.kind)) return { ok: false, error: "kind must be proof | disproof | partial | finding | formalization" };

  const L = config.limits;
  if ((input.lean_source?.length ?? 0) > L.leanSourceBytes) return { ok: false, error: "lean_source too large" };
  if ((input.transcript?.content?.length ?? 0) > L.transcriptBytes) return { ok: false, error: "transcript too large" };
  if ((input.body_md?.length ?? 0) + (input.explanation_md?.length ?? 0) > L.bodyBytes) return { ok: false, error: "text too large" };

  // Idempotency: agents may retry safely. The same key with different content is refused.
  // Repository submissions: validated here, built on the verifier; lean_source becomes a short manifest.
  let source: { url: string; commit: string; module: string } | null = null;
  if (input.repository) {
    if (!["proof", "disproof", "partial"].includes(input.kind)) return { ok: false, error: "a repository can be submitted as a proof, disproof or partial proof" };
    const url = String(input.repository.url ?? "").trim().replace(/\.git$/, "").replace(/\/$/, "");
    const commit = String(input.repository.commit ?? "").trim().toLowerCase();
    const rootModule = String(input.repository.module ?? "").trim();
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)) return { ok: false, error: "repository.url must be a public https://github.com/<owner>/<repo>" };
    if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false, error: "repository.commit must be a full 40-character commit hash" };
    if (!/^[A-Za-z_][A-Za-z0-9_\x27]*(\.[A-Za-z_][A-Za-z0-9_\x27]*)*$/.test(rootModule)) return { ok: false, error: "repository.module must be the Lean module that contains the theorem, e.g. MyProof.Main" };
    source = { url, commit, module: rootModule };
    input.lean_source = `-- Repository submission: the proof is the Lake project below, at this exact commit.\n-- ${url}/tree/${commit}\n-- module: ${rootModule}\n`;
  }
  const requestHash = sha256(JSON.stringify([input.problem, input.kind, input.lean_source, input.body_md, input.target_decl]));
  if (input.idempotency_key) {
    const prev = await one<{ public_id: string; status: string; request_hash: string | null }>(
      "SELECT public_id, status, request_hash FROM submissions WHERE user_id=$1 AND idempotency_key=$2", [user.id, input.idempotency_key.slice(0, 100)]);
    if (prev && prev.request_hash && prev.request_hash !== requestHash) return { ok: false, error: "idempotency_key already used for a different submission" };
    if (prev) return { ok: true, id: prev.public_id, status: prev.status, url: `/s/${prev.public_id}`, duplicate: true };
  }

  const young = Date.now() - new Date(user.created_at).getTime() < 86_400_000;
  if (!(await rateLimit(`sub:${user.id}`, young ? L.newAccountSubmissionsPerHour : L.submissionsPerHour, 3600)))
    return { ok: false, error: "rate limit: too many submissions this hour" };
  const pending = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.user_id=$1 AND j.state IN ('queued','running')`, [user.id]);
  if ((pending?.n ?? 0) >= L.pendingJobsPerUser) return { ok: false, error: "too many submissions waiting for verification" };

  let problem: { id: number; current_version_id: number; challenge_source: string; status: string } | null = null;
  if (input.kind !== "formalization" || input.problem) {
    if (!input.problem) return { ok: false, error: "problem is required" };
    const p = await one<{ id: number; current_version_id: number | null; challenge_source: string | null; status: string; formalization: string; verification: string }>(
      `SELECT p.id, p.current_version_id, v.challenge_source, p.status, p.formalization, p.verification
       FROM problems p LEFT JOIN problem_versions v ON v.id=p.current_version_id WHERE p.slug=$1 OR p.ident=$1`, [input.problem]);
    if (!p) return { ok: false, error: `unknown problem ${input.problem}` };
    if (p.status === "withdrawn") return { ok: false, error: "problem withdrawn" };
    if (input.kind === "formalization" && p.formalization !== "informal")
      return { ok: false, error: "this problem already has a formal statement; propose changes with a critique instead" };
    if (p.formalization === "informal" && input.kind !== "formalization" && input.kind !== "finding")
      return { ok: false, error: "this problem has no formal statement yet: submit a formalization first (kind: formalization)" };
    if (p.verification !== "lean-kernel" && (input.kind === "proof" || input.kind === "disproof" || input.kind === "partial"))
      return { ok: false, error: `this problem is checked by "${p.verification}", which the platform does not support yet; only findings are accepted for now` };
    problem = { id: p.id, current_version_id: input.kind === "formalization" ? null as unknown as number : p.current_version_id!, challenge_source: p.challenge_source ?? "", status: p.status };
  }

  const needsLean = input.kind !== "finding";
  let warnings: string[] = [];
  if (needsLean && !source) {
    const pf = preflight(input.lean_source ?? "", { kind: input.kind as "proof" | "disproof" | "partial" | "formalization", challenge: input.kind === "formalization" ? undefined : problem?.challenge_source });
    if (!pf.ok) return { ok: false, error: "preflight failed", details: pf.errors };
    warnings = pf.warnings;
  } else if (!input.body_md?.trim()) return { ok: false, error: "body_md is required for a finding" };
  const repo = input.repo_url ? normalizeRepo(input.repo_url) : null;
  if (input.repo_url && !repo) return { ok: false, error: "repo_url must be a public https://github.com/, gitlab.com/ or codeberg.org/ repository" };
  if (input.kind === "formalization" && !/^[\w.«»']+$/.test(input.target_decl ?? "")) return { ok: false, error: "target_decl is required for a formalization" };

  let basedOn: number | null = null;
  if (input.based_on) {
    const b = await one<{ id: number }>("SELECT id FROM submissions WHERE public_id=$1 AND problem_id=$2", [String(input.based_on), problem?.id ?? 0]);
    if (!b) return { ok: false, error: "based_on: no submission with this id on this problem" };
    basedOn = b.id;
  }
  const cites = Array.isArray(input.cites)
    ? input.cites.filter((c) => c && ["note", "lead", "record"].includes(String(c.type)) && Number(c.id) > 0).slice(0, 20).map((c) => ({ type: String(c.type), id: Number(c.id) }))
    : [];
  const publicId = shortId("s");
  const inserted = await tx(async (c) => {
    const { rows: [s] } = await c.query(
      `INSERT INTO submissions(public_id, user_id, problem_id, problem_version_id, kind, title, body_md, explanation_md, lean_source,
         source_hash, agent_name, agent_model, status, idempotency_key, client_ip, derived_from, verdict, request_hash, repo_url, based_on, cites, share_lemmas,
         source_repo, source_commit, source_module)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
      [publicId, user.id, problem?.id ?? null, problem?.current_version_id ?? null, input.kind, clip(input.title, 300), input.body_md ?? null,
       input.explanation_md ?? null, input.lean_source ?? null, input.lean_source ? sha256(input.lean_source) : null,
       clip(input.agent?.name, 60), clip(input.agent?.model, 80), needsLean ? "queued" : "needs_review",
       clip(input.idempotency_key, 100) ?? null, ip, clip(input.derived_from, 2000) ?? null,
       input.kind === "formalization" ? JSON.stringify({ decl_name: input.target_decl }) : null, requestHash, repo, basedOn, JSON.stringify(cites),
       input.share_lemmas === true && input.kind === "partial", source?.url ?? null, source?.commit ?? null, source?.module ?? null]);
    if (!s) return null; // concurrent request with the same idempotency key won the race
    if (input.transcript?.content) {
      const r = redact(input.transcript.content);
      await c.query(
        `INSERT INTO transcripts(submission_id, format, content, sha256, byte_size, redactions, captured_by) VALUES ($1,$2,$3,$4,$5,$6,'client')`,
        [s.id, input.transcript.format ?? "text", r.text, sha256(input.transcript.content), input.transcript.content.length, r.count]);
    }
    if (needsLean) {
      // Bulk / new accounts go behind interactive single submissions.
      // Repository builds are long: they go behind single files.
      const priority = (input.kind === "formalization" ? 150 : source ? 160 : 100) + (young ? 20 : 0);
      await c.query("INSERT INTO jobs(kind, submission_id, priority) VALUES ($1,$2,$3)",
        [input.kind === "formalization" ? "check_formalization" : "verify", s.id, priority]);
      await c.query("NOTIFY nosorry_jobs");
    }
    return s.id as number;
  });
  if (inserted === null) {
    const prev = await one<{ public_id: string; status: string }>(
      "SELECT public_id, status FROM submissions WHERE user_id=$1 AND idempotency_key=$2", [user.id, clip(input.idempotency_key, 100)]);
    return prev ? { ok: true, id: prev.public_id, status: prev.status, url: `/s/${prev.public_id}`, duplicate: true } : { ok: false, error: "conflict, retry" };
  }
  return { ok: true, id: publicId, status: needsLean ? "queued" : "needs_review", url: `/s/${publicId}`, warnings };
}

/** Queue position (1-based) of a queued submission, using the same order as the workers. */
export async function queuePosition(submissionId: number) {
  return one<{ pos: number; workers: number }>(
    `SELECT (SELECT count(*)::int FROM jobs j2 WHERE j2.state='queued' AND (j2.priority, j2.id) <= (j.priority, j.id)) AS pos,
            (SELECT count(*)::int FROM workers WHERE heartbeat_at > now() - interval '60 seconds') AS workers
     FROM jobs j WHERE j.submission_id=$1 AND j.state='queued' ORDER BY j.id DESC LIMIT 1`, [submissionId]);
}

export async function queueStats() {
  return one<{ queued: number; running: number; done_1h: number; avg_wait_s: number | null; dead: number; workers: number }>(
    `SELECT (SELECT count(*)::int FROM workers WHERE heartbeat_at > now() - interval '60 seconds') AS workers,
            count(*) FILTER (WHERE state='queued')::int AS queued,
            count(*) FILTER (WHERE state='running')::int AS running,
            count(*) FILTER (WHERE state='done' AND finished_at > now() - interval '1 hour')::int AS done_1h,
            count(*) FILTER (WHERE state='dead')::int AS dead,
            (avg(extract(epoch from (finished_at - created_at))) FILTER (WHERE state='done' AND finished_at > now() - interval '1 day'))::int AS avg_wait_s
     FROM jobs`);
}
export { q };
