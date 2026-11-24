// Community review of the results that would change a problem's status (db/migrations/015 and 016), worker side: which
// Lean-verified results are held. Votes, comments and suggested changes: src/lib/reviews.ts; the decision: moderators.

export const REVIEW_HOLD = "status review"; // marker only: the submission page explains the review

/** Would this verified proof/disproof change what the site says about the problem? Then it is reviewed first. */
export async function needsStatusReview(c, sub) {
  if (!sub.pid || (sub.kind !== "proof" && sub.kind !== "disproof") || sub.metric_decl) return false;
  // Already held once and not yet decided (e.g. re-checked after a statement correction): still held.
  const { rows: [me] } = await c.query("SELECT review_required, reviewed_at FROM submissions WHERE id=$1", [sub.id]);
  if (me?.review_required && !me.reviewed_at) return true;
  if (me?.review_required) return false; // approved before
  if (sub.problem_status !== "open") return false;
  const { rows: [p] } = await c.query("SELECT resolution FROM problems WHERE id=$1", [sub.pid]);
  return !p?.resolution || p.resolution !== (sub.kind === "proof" ? "proved" : "disproved");
}
