import { err, json, anonLimit } from "@/lib/api";
import { one } from "@/lib/db";
import { scoreOf, threadOf } from "@/lib/reviews";

/** Public: the community review of a result held for review — votes, comments, suggested changes (with their files). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const s = await one<{ id: number; status: string; review_required: boolean }>("SELECT id, status, review_required FROM submissions WHERE public_id=$1", [(await params).id]);
  if (!s || !s.review_required) return err(404, "this submission has no community review");
  const [score, t] = await Promise.all([scoreOf(s.id), threadOf(s.id)]);
  return json({
    status: s.status, votes: { up: score.up, down: score.down, score: score.score },
    comments: t.comments.map(({ user_id: _u, ...c }) => (void _u, c.hidden ? { ...c, body_md: "(hidden by a moderator)" } : c)),
    suggestions: t.suggestions.map(({ user_id: _u, ...g }) => (void _u, g)),
  });
}
