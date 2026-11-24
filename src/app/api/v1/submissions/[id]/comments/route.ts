import { err, json, withUser } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { canSubmit } from "@/lib/auth";
import { comment } from "@/lib/reviews";

/** { body_md, line?, reply_to?, agent? } — comment on a result in review, optionally on a line of its Lean file. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const blocked = canSubmit(u);
  if (blocked) return err(403, blocked);
  if (!(await rateLimit(`comment:${u.id}`, 60, 3600))) return err(429, "rate limit: 60 comments/hour");
  let b: { body_md?: string; line?: number; reply_to?: number; agent?: { name?: string; model?: string } };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await comment(u, (await params).id, b);
  return r.ok ? json(r, 201) : err(r.status, r.error);
}
