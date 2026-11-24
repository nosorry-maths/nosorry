// Review of the results that would change a problem's status (db/migrations/015_proof_review.sql), worker side:
// which verified results are held, and how the independent re-run (job kind "recheck") is recorded.
// The rest lives in src/lib/reviews.ts (agent reviews) and src/app/actions.ts (moderator approval).

export const REVIEW_HOLD = "status review"; // marker only: the submission page explains the review

/** Would this verified proof/disproof change what the site says about the problem? Then it is reviewed first. */
export async function needsStatusReview(c, sub) {
  if (!sub.pid || (sub.kind !== "proof" && sub.kind !== "disproof") || sub.metric_decl) return false;
  // Already held once and not yet approved (e.g. re-checked after a statement correction): still held.
  const { rows: [me] } = await c.query("SELECT review_required, reviewed_at FROM submissions WHERE id=$1", [sub.id]);
  if (me?.review_required && !me.reviewed_at) return true;
  if (me?.review_required) return false; // approved before
  if (sub.problem_status !== "open") return false;
  const { rows: [p] } = await c.query("SELECT resolution FROM problems WHERE id=$1", [sub.pid]);
  return !p?.resolution || p.resolution !== (sub.kind === "proof" ? "proved" : "disproved");
}

/** The independent re-run of a held result: record whether it agrees; never changes the submission's status. */
export async function finishRecheck(c, sub, stages, result, job) {
  if (result === "error" && job.attempts < job.max_attempts) {
    await c.query("UPDATE jobs SET state='queued', run_after=now() + interval '2 minutes', locked_by=NULL WHERE id=$1", [job.id]);
    return;
  }
  await c.query("UPDATE jobs SET state='done', finished_at=now() WHERE id=$1", [job.id]);
  const state = result === "verified" || result === "needs_review" ? "pass" : result === "error" ? "error" : "fail";
  const failed = stages.find((x) => x.status === "fail" || x.status === "error");
  const run = stages.find((x) => x.name === "github run");
  const detail = state === "pass" ? (run?.detail ?? "passed") : String(failed?.detail ?? result).slice(0, 4000);
  await c.query("UPDATE submissions SET recheck_state=$2, recheck_detail=$3 WHERE id=$1", [sub.id, state, detail]);
  if (sub.pid) await c.query(`INSERT INTO problem_events(problem_id, type, ref_type, ref_id, summary) VALUES ($1,'review.recheck','submission',$2,$3)`,
    [sub.pid, sub.id, state === "pass" ? `Independent re-run of ${sub.public_id}: Lean agrees` : `Independent re-run of ${sub.public_id}: ${state === "error" ? "could not run (server side)" : "DISAGREES, a moderator must look"}`]);
}
