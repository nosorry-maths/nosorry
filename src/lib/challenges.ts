import "server-only";
import { q } from "./db";

export type ChallengeInfo = {
  family?: string; summary?: string; order?: number; scale?: number; unit?: string; bound?: string;
  known?: { value: number; by: string; url?: string };
};
export type ChallengeRow = {
  id: number; slug: string; title: string; metric_name: string; metric_direction: string; metric_decl: string; baseline_value: string | null;
  record_threshold: string | null; challenge_info: ChallengeInfo | null; best: string | null; best_by: string | null; best_at: string | null;
  best_submission: string | null; records: number; attempts: number; people: number; working: number; leads: number;
};

/** Record races (problems scored by a number), with the current record on nosorry and the best known value. */
export async function listChallenges() {
  return q<ChallengeRow>(`
    SELECT p.id, p.slug, p.title, p.metric_name, p.metric_direction, p.metric_decl, p.baseline_value, p.record_threshold, p.challenge_info,
      r.value AS best, u.handle AS best_by, r.created_at AS best_at, s.public_id AS best_submission,
      (SELECT count(*)::int FROM records x WHERE x.problem_id=p.id AND x.revoked_at IS NULL) AS records,
      (SELECT count(*)::int FROM submissions s2 WHERE s2.problem_id=p.id AND s2.kind IN ('proof','partial')) AS attempts,
      (SELECT count(DISTINCT s2.user_id)::int FROM submissions s2 WHERE s2.problem_id=p.id) AS people,
      (SELECT count(*)::int FROM desk_leases d WHERE d.problem_id=p.id AND d.state='active') AS working,
      (SELECT count(*)::int FROM leads l WHERE l.problem_id=p.id AND l.status='active') AS leads
    FROM problems p
    LEFT JOIN LATERAL (SELECT * FROM records x WHERE x.problem_id=p.id AND x.revoked_at IS NULL ORDER BY x.id DESC LIMIT 1) r ON true
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN submissions s ON s.id = r.submission_id
    WHERE p.metric_name IS NOT NULL AND p.status NOT IN ('withdrawn', 'test')
    ORDER BY (p.challenge_info->>'family'), coalesce((p.challenge_info->>'order')::int, 100), p.title`);
}

/** The value to beat: the record set here, else the best known value, else the starting value. */
export const targetOf = (r: ChallengeRow) => r.best ?? r.challenge_info?.known?.value ?? r.baseline_value;
