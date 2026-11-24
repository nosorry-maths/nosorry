import "server-only";
import { one, q, tx } from "./db";
import { emit } from "./feed";
import { createSubmission } from "./submissions";
import { isModerator, type User } from "./auth";

// Community review of the results that would change a problem's status (db/migrations/016_community_review.sql).
// A held submission is discussed by registered members — votes, comments (optionally on a line), suggested changes to
// its Lean file — and a moderator decides (src/app/actions.ts). Moderators have every power here.

export type Comment = { id: number; handle: string; user_id: number; reply_to: number | null; line: number | null; body_md: string;
  agent_name: string | null; agent_model: string | null; hidden: boolean; created_at: string };
export type Suggestion = { id: number; handle: string; user_id: number; body_md: string; lean_source: string; agent_name: string | null;
  agent_model: string | null; status: "open" | "applied" | "closed"; decided_by: string | null; decided_at: string | null;
  revision: string | null; created_at: string };
type Agent = { name?: string | null; model?: string | null } | undefined;
type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const clip = (x: unknown, n: number) => (x == null ? null : String(x).slice(0, n) || null);
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

/** The submission under review, if it can still be discussed (held, not yet decided). */
async function heldFor(c: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, publicId: string) {
  const { rows: [s] } = await c.query(
    `SELECT id, user_id, problem_id, public_id, kind, status, review_required, source_repo, lean_source, explanation_md, derived_from
     FROM submissions WHERE public_id=$1 FOR UPDATE`, [publicId]);
  return s as { id: number; user_id: number; problem_id: number; public_id: string; kind: string; status: string; review_required: boolean;
    source_repo: string | null; lean_source: string; explanation_md: string | null; derived_from: string | null } | undefined;
}

export async function scoreOf(submissionId: number, viewerId?: number | null) {
  const r = await one<{ up: number; down: number; mine: number | null }>(
    `SELECT count(*) FILTER (WHERE value=1)::int AS up, count(*) FILTER (WHERE value=-1)::int AS down,
            max(value) FILTER (WHERE user_id=$2)::int AS mine FROM submission_votes WHERE submission_id=$1`, [submissionId, viewerId ?? 0]);
  return { up: r?.up ?? 0, down: r?.down ?? 0, score: (r?.up ?? 0) - (r?.down ?? 0), mine: r?.mine ?? 0 };
}

export async function threadOf(submissionId: number) {
  const [comments, suggestions] = await Promise.all([
    q<Comment>(`SELECT c.id, u.handle, c.user_id, c.reply_to, c.line, c.body_md, c.agent_name, c.agent_model, c.hidden_by IS NOT NULL AS hidden, c.created_at
                FROM submission_comments c JOIN users u ON u.id=c.user_id WHERE c.submission_id=$1 ORDER BY c.id`, [submissionId]),
    q<Suggestion>(`SELECT g.id, u.handle, g.user_id, g.body_md, g.lean_source, g.agent_name, g.agent_model, g.status, d.handle AS decided_by,
                          g.decided_at, r.public_id AS revision, g.created_at
                   FROM submission_suggestions g JOIN users u ON u.id=g.user_id LEFT JOIN users d ON d.id=g.decided_by
                   LEFT JOIN submissions r ON r.id=g.revision_id WHERE g.submission_id=$1 ORDER BY g.id`, [submissionId]),
  ]);
  return { comments, suggestions };
}

/** Results waiting for review (oldest first), for members and agents who want to help. */
export async function pendingReviews(limit = 50) {
  return q<{ public_id: string; kind: string; slug: string; title: string; decl_name: string | null; author: string; created_at: string;
            up: number; down: number; comments: number; open_suggestions: number; source_repo: string | null }>(
    `SELECT s.public_id, s.kind, p.slug, p.title, v.decl_name, u.handle AS author, s.created_at, s.source_repo,
            (SELECT count(*)::int FROM submission_votes x WHERE x.submission_id=s.id AND x.value=1) AS up,
            (SELECT count(*)::int FROM submission_votes x WHERE x.submission_id=s.id AND x.value=-1) AS down,
            (SELECT count(*)::int FROM submission_comments x WHERE x.submission_id=s.id AND x.hidden_by IS NULL) AS comments,
            (SELECT count(*)::int FROM submission_suggestions x WHERE x.submission_id=s.id AND x.status='open') AS open_suggestions
     FROM submissions s JOIN problems p ON p.id=s.problem_id JOIN users u ON u.id=s.user_id
     LEFT JOIN problem_versions v ON v.id=s.problem_version_id
     WHERE s.review_required AND s.status='needs_review'
     ORDER BY s.created_at, s.id LIMIT $1`, [Math.max(1, Math.min(200, limit))]);
}

/** +1, -1, or 0 to remove your vote. Registered members only, never on your own submission. */
export async function vote(u: User, publicId: string, value: number): Promise<Result<{ up: number; down: number; score: number; mine: number }>> {
  if (![1, -1, 0].includes(value)) return fail(400, "value must be 1, -1 or 0");
  const r = await tx(async (c) => {
    const s = await heldFor(c, publicId);
    if (!s) return fail(404, "unknown submission");
    if (!s.review_required || s.status !== "needs_review") return fail(409, "this submission is not in review");
    if (Number(s.user_id) === Number(u.id)) return fail(403, "you cannot vote on your own submission");
    if (value === 0) await c.query("DELETE FROM submission_votes WHERE submission_id=$1 AND user_id=$2", [s.id, u.id]);
    else await c.query(`INSERT INTO submission_votes(submission_id, user_id, value) VALUES ($1,$2,$3)
      ON CONFLICT (submission_id, user_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [s.id, u.id, value]);
    return { ok: true as const, sid: Number(s.id) };
  });
  if (!r.ok) return r;
  return { ok: true, ...(await scoreOf(r.sid, u.id)) };
}

/** A comment (optionally on a line of the Lean file, or a reply). The author may answer; anyone registered may comment. */
export async function comment(u: User, publicId: string, input: { body_md?: string; line?: number | null; reply_to?: number | null; agent?: Agent }): Promise<Result<{ id: number; url: string }>> {
  const body = String(input.body_md ?? "").trim().slice(0, 20_000);
  if (body.length < 2) return fail(400, "body_md required");
  const line = input.line == null || input.line === 0 ? null : Math.trunc(Number(input.line));
  if (line != null && !(line > 0)) return fail(400, "line must be a positive line number of the Lean file");
  return tx(async (c) => {
    const s = await heldFor(c, publicId);
    if (!s) return fail(404, "unknown submission");
    if (!s.review_required) return fail(409, "only results in review have a discussion");
    if (input.reply_to) {
      const { rows } = await c.query("SELECT 1 FROM submission_comments WHERE id=$1 AND submission_id=$2", [input.reply_to, s.id]);
      if (!rows.length) return fail(400, "reply_to: no such comment on this submission");
    }
    const { rows: [r] } = await c.query(
      `INSERT INTO submission_comments(submission_id, user_id, reply_to, line, body_md, agent_name, agent_model) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [s.id, u.id, input.reply_to ?? null, line, body, clip(input.agent?.name, 60), clip(input.agent?.model, 80)]);
    await emit(c, s.problem_id, "review.comment", { userId: u.id, refType: "submission", refId: s.id, unverified: true,
      summary: `${u.handle} on ${s.public_id}${line ? ` (line ${line})` : ""}: ${body.replace(/\s+/g, " ")}` });
    return { ok: true as const, id: Number(r.id), url: `/s/${s.public_id}#c${r.id}` };
  });
}

/** Suggest a change: the full revised Lean file and what it changes. Single-file submissions only. */
export async function suggest(u: User, publicId: string, input: { body_md?: string; lean_source?: string; agent?: Agent }): Promise<Result<{ id: number; url: string }>> {
  const body = String(input.body_md ?? "").trim().slice(0, 20_000);
  const src = String(input.lean_source ?? "");
  if (body.length < 2) return fail(400, "body_md required: what the change does and why");
  if (!src.trim()) return fail(400, "lean_source required: the whole revised file");
  if (src.length > 2_000_000) return fail(400, "lean_source too large");
  return tx(async (c) => {
    const s = await heldFor(c, publicId);
    if (!s) return fail(404, "unknown submission");
    if (!s.review_required || s.status !== "needs_review") return fail(409, "this submission is not in review");
    if (s.source_repo) return fail(400, "a repository submission is changed in its repository: comment instead, with the commit");
    if (src === s.lean_source) return fail(400, "the suggested file is identical to the submission");
    const { rows: [r] } = await c.query(
      `INSERT INTO submission_suggestions(submission_id, user_id, body_md, lean_source, agent_name, agent_model) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [s.id, u.id, body, src, clip(input.agent?.name, 60), clip(input.agent?.model, 80)]);
    await emit(c, s.problem_id, "review.suggestion", { userId: u.id, refType: "submission", refId: s.id, unverified: true,
      summary: `${u.handle} suggests a change to ${s.public_id}: ${body.replace(/\s+/g, " ")}` });
    return { ok: true as const, id: Number(r.id), url: `/s/${s.public_id}#g${r.id}` };
  });
}

/**
 * Apply a suggestion (the submission's author or a moderator): the revised file is submitted as a new revision of the
 * submission, under its author, crediting the suggestion; Lean checks it and it is held for review again. The old
 * submission is superseded. Close: refuse it without applying.
 */
export async function decideSuggestion(u: User, publicId: string, suggestionId: number, action: "apply" | "close", ip: string | null):
  Promise<Result<{ revision?: string; url: string }>> {
  const pre = await tx(async (c) => {
    const s = await heldFor(c, publicId);
    if (!s) return fail(404, "unknown submission");
    if (Number(s.user_id) !== Number(u.id) && !isModerator(u)) return fail(403, "only the author or a moderator can apply or close a suggestion");
    const { rows: [g] } = await c.query("SELECT g.*, x.handle FROM submission_suggestions g JOIN users x ON x.id=g.user_id WHERE g.id=$1 AND g.submission_id=$2 FOR UPDATE", [suggestionId, s.id]);
    if (!g) return fail(404, "no such suggestion on this submission");
    if (g.status !== "open") return fail(409, `this suggestion is already ${g.status}`);
    if (action === "close") {
      await c.query("UPDATE submission_suggestions SET status='closed', decided_by=$2, decided_at=now() WHERE id=$1", [g.id, u.id]);
      return { ok: true as const, closed: true, s, g };
    }
    if (s.status !== "needs_review") return fail(409, "this submission is not in review any more");
    return { ok: true as const, closed: false, s, g };
  });
  if (!pre.ok) return pre;
  if (pre.closed) return { ok: true, url: `/s/${publicId}#g${suggestionId}` };
  const { s, g } = pre;
  const author = await one<User>("SELECT id, handle, display_name, role, email, email_verified_at, created_at, banned_at FROM users WHERE id=$1", [s.user_id]);
  const prob = await one<{ slug: string }>("SELECT slug FROM problems WHERE id=$1", [s.problem_id]);
  if (!author || !prob) return fail(500, "author or problem missing");
  const credit = `Revision of ${s.public_id} applying suggestion #${g.id} by ${g.handle}${Number(author.id) !== Number(u.id) ? ` (applied by ${u.handle})` : ""}: ${String(g.body_md).slice(0, 500)}`;
  const r = await createSubmission({ ...author, banned_at: null }, {
    problem: prob.slug, kind: s.kind as "proof" | "disproof", lean_source: g.lean_source, explanation_md: s.explanation_md ?? undefined,
    derived_from: [s.derived_from, credit].filter(Boolean).join("\n\n"),
    agent: { name: g.agent_name ?? undefined, model: g.agent_model ?? undefined },
  } as Parameters<typeof createSubmission>[1], ip);
  if (!r.ok) return fail(400, `the revision could not be submitted: ${r.error}`);
  await tx(async (c) => {
    await c.query("UPDATE submissions SET revision_of=$2 WHERE public_id=$1", [r.id, s.id]);
    await c.query("UPDATE submissions SET status='superseded', review_note=$2 WHERE id=$1 AND status='needs_review'", [s.id, `Superseded by its revision ${r.id} (suggestion #${g.id} by ${g.handle}).`]);
    await c.query(`UPDATE submission_suggestions SET status='applied', decided_by=$2, decided_at=now(), revision_id=(SELECT id FROM submissions WHERE public_id=$3) WHERE id=$1`, [g.id, u.id, r.id]);
    await emit(c, s.problem_id, "review.suggestion", { userId: u.id, refType: "submission", refId: s.id,
      summary: `${u.handle} applied suggestion #${g.id} by ${g.handle} to ${s.public_id}: the revision ${r.id} is being checked by Lean` });
  });
  return { ok: true, revision: r.id, url: `/s/${r.id}` };
}

/** Moderators: hide a comment (it stays in the database, shown as hidden). */
export async function hideComment(u: User, commentId: number) {
  if (!isModerator(u)) return fail(403, "moderators only");
  const r = await one<{ public_id: string }>(
    `UPDATE submission_comments c SET hidden_by=$2 FROM submissions s WHERE c.id=$1 AND s.id=c.submission_id RETURNING s.public_id`, [commentId, u.id]);
  return r ? { ok: true as const, url: `/s/${r.public_id}#c${commentId}` } : fail(404, "no such comment");
}

/** A short line diff (for suggested changes): common prefix/suffix, then an LCS on the changed middle. */
export function lineDiff(a: string, b: string, context = 3): { kind: " " | "-" | "+" | "…"; text: string; line?: number }[] {
  const A = a.split("\n"), B = b.split("\n");
  let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const am = A.slice(pre, A.length - suf), bm = B.slice(pre, B.length - suf);
  let mid: { kind: " " | "-" | "+"; text: string; ai?: number }[];
  if (am.length * bm.length > 4_000_000) {
    mid = [...am.map((t, i) => ({ kind: "-" as const, text: t, ai: pre + i })), ...bm.map((t) => ({ kind: "+" as const, text: t }))];
  } else {
    const n = am.length, m = bm.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = am[i] === bm[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    mid = []; let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) { mid.push({ kind: " ", text: am[i], ai: pre + i }); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { mid.push({ kind: "+", text: bm[j] }); j++; }
      else { mid.push({ kind: "-", text: am[i], ai: pre + i }); i++; }
    }
  }
  const all = [...A.slice(0, pre).map((t, i) => ({ kind: " " as const, text: t, ai: i })), ...mid,
    ...A.slice(A.length - suf).map((t, i) => ({ kind: " " as const, text: t, ai: A.length - suf + i }))];
  const keep = new Set<number>();
  all.forEach((x, k) => { if (x.kind !== " ") for (let d = -context; d <= context; d++) keep.add(k + d); });
  const out: { kind: " " | "-" | "+" | "…"; text: string; line?: number }[] = [];
  let gap = false;
  all.forEach((x, k) => {
    if (!keep.has(k)) { if (!gap) out.push({ kind: "…", text: "" }); gap = true; return; }
    gap = false; out.push({ kind: x.kind, text: x.text, line: x.ai != null ? x.ai + 1 : undefined });
  });
  return out;
}
