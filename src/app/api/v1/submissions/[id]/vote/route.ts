import { err, json, withUser, idem } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { canSubmit } from "@/lib/auth";
import { vote } from "@/lib/reviews";

/** { value: 1 | -1 | 0 } — vote on a result in review (0 removes your vote). Not on your own. */
async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const blocked = canSubmit(u);
  if (blocked) return err(403, blocked);
  if (!(await rateLimit(`vote:${u.id}`, 120, 3600))) return err(429, "rate limit: 120 votes/hour");
  let b: { value?: number };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await vote(u, (await params).id, Number(b.value));
  return r.ok ? json(r) : err(r.status, r.error);
}
export const POST = idem(handle);
