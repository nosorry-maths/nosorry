import { one, q } from "@/lib/db";
import { apiUser } from "@/lib/auth";
import { anonLimit, err, json } from "@/lib/api";

type Row = {
  sid: number; id: string; user_id: number; kind: string; status: string; visibility: string; problem: string | null; statement_version: number | null;
  verdict: Record<string, unknown> | null; axioms: string[] | null; open_lemmas: string[] | null; review_note: string | null;
  created_at: string; verified_at: string | null; badge_compiles: boolean | null; badge_axioms: boolean | null; badge_statement: boolean | null;
  lean_source: string | null; review_required: boolean; recheck_state: string | null;
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const id = (await params).id;
  const s = await one<Row>(`
    SELECT s.id AS sid, s.public_id AS id, s.user_id, s.kind, s.status, s.visibility, p.slug AS problem, v.version AS statement_version,
           s.verdict, s.axioms, s.open_lemmas, s.review_note, s.created_at, s.verified_at,
           s.badge_compiles, s.badge_axioms, s.badge_statement, s.lean_source, s.review_required, s.recheck_state
    FROM submissions s LEFT JOIN problems p ON p.id=s.problem_id LEFT JOIN problem_versions v ON v.id=s.problem_version_id
    WHERE s.public_id=$1`, [id]);
  if (!s) return err(404, "not found");
  const viewer = await apiUser(req, "read");
  const owner = viewer?.id === s.user_id;
  const publicStatus = ["verified", "partial", "accepted", "needs_review", "revoked", "superseded", "queued", "running"].includes(s.status);
  if (!owner && !publicStatus) return err(404, "not found");
  const full = owner || s.visibility === "public";
  const run = await one<{ stages: { name: string; status: string; ms?: number; detail?: string | null }[]; result: string; sandbox: string; toolchain: string }>(
    `SELECT r.stages, r.result, r.sandbox, r.toolchain FROM verification_runs r LEFT JOIN jobs j ON j.id=r.job_id
     WHERE r.submission_id=$1 AND j.kind IS DISTINCT FROM 'recheck' ORDER BY r.id DESC LIMIT 1`, [s.sid]);
  const points = owner ? await q("SELECT delta, reason, note FROM point_events WHERE submission_id=$1", [s.sid]) : undefined;
  const base = {
    id: s.id, kind: s.kind, status: s.status, visibility: s.visibility, problem: s.problem, statement_version: s.statement_version,
    created_at: s.created_at, verified_at: s.verified_at, review_note: s.review_note,
    badges: { compiles: s.badge_compiles, axioms: s.badge_axioms, statement: s.badge_statement },
    done: !["queued", "running"].includes(s.status),
    // Results that would change the problem's status count only after review (independent re-run, reviews, moderator).
    ...(s.review_required ? { review: { required: true, recheck: s.recheck_state, reviews_url: `/api/v1/submissions/${s.id}/reviews` } } : {}),
  };
  if (!full) {
    // Sealed and not yours: verdict only. Stage names and outcomes, but no logs, lemma names or source.
    return json({ ...base, sealed: true, latest_run: run ? { result: run.result, toolchain: run.toolchain, stages: run.stages.map(({ name, status, ms }) => ({ name, status, ms })) } : null });
  }
  return json({ ...base, verdict: s.verdict, axioms: s.axioms, open_lemmas: s.open_lemmas, lean_source: s.lean_source, latest_run: run, points });
}
