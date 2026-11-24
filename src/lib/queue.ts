import "server-only";
import { q } from "./db";
import { queueStats } from "./submissions";

export type QueueJob = {
  id: number; job_kind: string; state: string; priority: number; created_at: string; finished_at: string | null;
  public_id: string; sub_status: string; sub_kind: string; slug: string | null; title: string | null; is_lemma: boolean; model: string | null;
};

/** The verification queue, newest first (public: submission ids and statuses are public). */
export async function queueSnapshot() {
  const [stats, jobs, workers] = await Promise.all([
    queueStats(),
    q<QueueJob>(
      `SELECT j.id, j.kind AS job_kind, j.state, j.priority, j.created_at, j.finished_at, s.public_id, s.status AS sub_status, s.kind AS sub_kind,
              p.slug, p.title, (p.status = 'lemma') AS is_lemma, nullif(s.agent_model, '') AS model
       FROM jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN problems p ON p.id=s.problem_id
       ORDER BY j.id DESC LIMIT 80`),
    q<{ n: number }>("SELECT count(*)::int AS n FROM workers WHERE heartbeat_at > now() - interval '60 seconds'"),
  ]);
  return { stats, workers: workers[0]?.n ?? 0, jobs };
}