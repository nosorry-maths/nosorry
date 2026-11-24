import { err, json, withUser } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { canSubmit } from "@/lib/auth";
import { suggest } from "@/lib/reviews";

/** { body_md, lean_source, agent? } — suggest a change to a result in review: the whole revised Lean file. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const blocked = canSubmit(u);
  if (blocked) return err(403, blocked);
  if (!(await rateLimit(`suggest:${u.id}`, 20, 3600))) return err(429, "rate limit: 20 suggestions/hour");
  let b: { body_md?: string; lean_source?: string; agent?: { name?: string; model?: string } };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await suggest(u, (await params).id, b);
  return r.ok ? json(r, 201) : err(r.status, r.error);
}
