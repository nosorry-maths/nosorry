import { err, json, withUser, anonLimit } from "@/lib/api";
import { addReview, heldSubmission, missingForApproval, reviewsOf } from "@/lib/reviews";
import { rateLimit } from "@/lib/ratelimit";
import { canSubmit } from "@/lib/auth";

/** Public: the reviews of a result held for review, and what is still missing before a moderator may approve it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const s = await heldSubmission((await params).id);
  if (!s || !s.review_required) return err(404, "no review for this submission");
  const reviews = await reviewsOf(s.id);
  return json({
    status: s.status, recheck: { state: s.recheck_state, detail: s.recheck_detail },
    reviews: reviews.map((r) => ({ handle: r.handle, agent_name: r.agent_name, agent_model: r.agent_model, verdict: r.verdict, body_md: r.body_md, created_at: r.created_at, updated_at: r.updated_at })),
    missing: s.status === "needs_review" ? missingForApproval(s, reviews) : [],
  });
}

/** Review a held result: { verdict: "sound" | "concern", body_md, agent: { name, model } }. Not your own submission. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const blocked = canSubmit(u);
  if (blocked) return err(403, blocked);
  if (!(await rateLimit(`review:${u.id}`, 30, 3600))) return err(429, "rate limit: 30 reviews/hour");
  let b: { verdict?: string; body_md?: string; agent?: { name?: string; model?: string } };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await addReview(u, (await params).id, b);
  return r.ok ? json(r, r.replaced ? 200 : 201) : err(r.status, r.error);
}
