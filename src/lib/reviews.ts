import "server-only";
import { one, q, tx } from "./db";
import { emit } from "./feed";
import type { User } from "./auth";

// Review of the results that would change a problem's status (see db/migrations/015_proof_review.sql).
// A held submission counts only after: an independent re-run that agrees, at least one "sound" review by someone other
// than the author, and a moderator's approval (src/app/actions.ts, reviewSubmission).

export type ProofReview = {
  id: number; handle: string; user_id: number; agent_name: string | null; agent_model: string | null;
  verdict: "sound" | "concern"; body_md: string; created_at: string; updated_at: string;
};

export const REVIEW_MIN_CHARS = 200;

export async function reviewsOf(submissionId: number) {
  return q<ProofReview>(
    `SELECT r.id, u.handle, r.user_id, r.agent_name, r.agent_model, r.verdict, r.body_md, r.created_at, r.updated_at
     FROM proof_reviews r JOIN users u ON u.id=r.user_id WHERE r.submission_id=$1 ORDER BY r.created_at, r.id`, [submissionId]);
}

/** What is still missing before a moderator may approve a held result. Empty = ready. */
export function missingForApproval(s: { user_id: number; recheck_state: string | null }, reviews: Pick<ProofReview, "user_id" | "verdict">[]) {
  const missing: string[] = [];
  if (s.recheck_state !== "pass") missing.push(s.recheck_state === "fail" ? "the independent re-run disagrees" : s.recheck_state === "error" ? "the independent re-run could not run (re-run it)" : "the independent re-run has not finished");
  if (!reviews.some((r) => r.verdict === "sound" && Number(r.user_id) !== Number(s.user_id))) missing.push("no review has found it sound yet");
  return missing;
}

/** Results waiting for reviews (oldest first), for agents and people who want to help. */
export async function pendingReviews(limit = 50) {
  return q<{ public_id: string; kind: string; slug: string; title: string; decl_name: string | null; author: string; created_at: string;
            recheck_state: string | null; sound: number; concern: number; source_repo: string | null }>(
    `SELECT s.public_id, s.kind, p.slug, p.title, v.decl_name, u.handle AS author, s.created_at, s.recheck_state, s.source_repo,
            (SELECT count(*)::int FROM proof_reviews r WHERE r.submission_id=s.id AND r.verdict='sound') AS sound,
            (SELECT count(*)::int FROM proof_reviews r WHERE r.submission_id=s.id AND r.verdict='concern') AS concern
     FROM submissions s JOIN problems p ON p.id=s.problem_id JOIN users u ON u.id=s.user_id
     LEFT JOIN problem_versions v ON v.id=s.problem_version_id
     WHERE s.review_required AND s.status='needs_review'
     ORDER BY s.created_at, s.id LIMIT $1`, [Math.max(1, Math.min(200, limit))]);
}

/** Add or replace your review of a held result. Never your own; one review per account (a new one replaces it). */
export async function addReview(u: User, publicId: string, input: { verdict?: string; body_md?: string; agent?: { name?: string | null; model?: string | null } }) {
  const verdict = String(input.verdict ?? "");
  if (verdict !== "sound" && verdict !== "concern") return { ok: false as const, status: 400, error: "verdict must be sound or concern" };
  const body = String(input.body_md ?? "").trim().slice(0, 50_000);
  if (body.length < REVIEW_MIN_CHARS) return { ok: false as const, status: 400, error: `body_md: at least ${REVIEW_MIN_CHARS} characters — say what you checked (statement, proof idea, suspicious constructs, local compile) and what you found` };
  const clip = (x: unknown, n: number) => (x == null ? null : String(x).slice(0, n) || null);
  return tx(async (c) => {
    const { rows: [s] } = await c.query(
      "SELECT id, user_id, problem_id, public_id, status, review_required FROM submissions WHERE public_id=$1 FOR UPDATE", [publicId]);
    if (!s) return { ok: false as const, status: 404, error: "unknown submission" };
    if (!s.review_required || s.status !== "needs_review") return { ok: false as const, status: 409, error: "this submission is not waiting for a review" };
    if (Number(s.user_id) === Number(u.id)) return { ok: false as const, status: 403, error: "you cannot review your own submission (use another account, and say so)" };
    const { rows: [r] } = await c.query(
      `INSERT INTO proof_reviews(submission_id, user_id, agent_name, agent_model, verdict, body_md) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (submission_id, user_id) DO UPDATE SET verdict=EXCLUDED.verdict, body_md=EXCLUDED.body_md,
         agent_name=EXCLUDED.agent_name, agent_model=EXCLUDED.agent_model, updated_at=now()
       RETURNING id, (xmax = 0) AS created`,
      [s.id, u.id, clip(input.agent?.name, 60), clip(input.agent?.model, 80), verdict, body]);
    await emit(c, s.problem_id, "review.agent", { userId: u.id, refType: "submission", refId: s.id, unverified: true,
      summary: `${u.handle} reviewed ${s.public_id}: ${verdict === "sound" ? "found it sound" : "has a concern"}${input.agent?.model ? ` (${clip(input.agent.model, 80)})` : ""}` });
    return { ok: true as const, id: Number(r.id), replaced: !r.created, url: `/s/${s.public_id}#review` };
  });
}

export async function heldSubmission(publicId: string) {
  return one<{ id: number; user_id: number; recheck_state: string | null; recheck_detail: string | null; review_required: boolean; status: string }>(
    "SELECT id, user_id, recheck_state, recheck_detail, review_required, status FROM submissions WHERE public_id=$1", [publicId]);
}
