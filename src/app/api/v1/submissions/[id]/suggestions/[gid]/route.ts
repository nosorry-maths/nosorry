import { err, json, withUser, ipOf, idem } from "@/lib/api";
import { decideSuggestion } from "@/lib/reviews";

/** { action: "apply" | "close" } — the submission's author (or a moderator) applies or closes a suggested change. */
async function handle(req: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  let b: { action?: string };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  if (b.action !== "apply" && b.action !== "close") return err(400, "action must be apply or close");
  const { id, gid } = await params;
  const r = await decideSuggestion(u, id, Number(gid), b.action, ipOf(req));
  return r.ok ? json(r) : err(r.status, r.error);
}
export const POST = idem(handle);
