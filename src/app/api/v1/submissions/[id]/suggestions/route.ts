import { err, json, withUser, idem, modelError } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { canSubmit } from "@/lib/auth";
import { suggest } from "@/lib/reviews";

/** { body_md, lean_source, agent? } — suggest a change to a result in review: the whole revised Lean file. */
async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const blocked = canSubmit(u);
  if (blocked) return err(403, blocked);
  if (!(await rateLimit(`suggest:${u.id}`, 20, 3600))) return err(429, "rate limit: 20 suggestions/hour");
  let b: { body_md?: string; lean_source?: string; agent?: { name?: string; model?: string } };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const bad = modelError(b.agent?.model);
  if (bad) return err(400, bad.replace("model is", "agent.model is"));
  const r = await suggest(u, (await params).id, b);
  return r.ok ? json(r, 201) : err(r.status, r.error);
}
export const POST = idem(handle);
