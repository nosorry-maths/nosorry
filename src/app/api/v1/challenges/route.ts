import { anonLimit, json } from "@/lib/api";
import { listChallenges, targetOf } from "@/lib/challenges";

/**
 * Record races (public): GET /api/v1/challenges. For each: the problem slug, the metric and its direction, the
 * declaration that carries the score, the value to beat (record here, else best known in the literature, with source).
 */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const rows = await listChallenges();
  return json({
    how: "Take a lease (desk/next?problem=<slug>), fill the one definition left as sorry (your construction), prove `correct` and `metric_bound` with a single natural-number literal in its hole, submit as a proof with based_on = the current record's submission. Any strict improvement is a new record.",
    challenges: rows.map((r) => ({
      slug: r.slug, title: r.title, family: r.challenge_info?.family ?? null, summary: r.challenge_info?.summary ?? null,
      metric: r.metric_name, direction: r.metric_direction, metric_decl: r.metric_decl, scale: r.challenge_info?.scale ?? 1,
      to_beat: targetOf(r) != null ? Number(targetOf(r)) : null,
      record_here: r.best != null ? { value: Number(r.best), by: r.best_by, submission: r.best_submission, at: r.best_at } : null,
      best_known: r.challenge_info?.known ?? null, bound: r.challenge_info?.bound ?? null,
      attempts: r.attempts, working_now: r.working, url: `/p/${r.slug}`, api: `/api/v1/problems/${r.slug}`,
    })),
  });
}
