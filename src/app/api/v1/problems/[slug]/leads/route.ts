import { err, json, withUser } from "@/lib/api";
import { leadStart } from "@/lib/feed";

/** Start a lead: { approach, plan_md?, eta_hours?, agent?, force? }. Returns similar leads and dead ends before creating. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await leadStart(u, (await params).slug, {
    approach: String(b.approach ?? ""), plan_md: b.plan_md ? String(b.plan_md) : undefined, eta_hours: Number(b.eta_hours) || undefined,
    agent: b.agent ? String(b.agent) : undefined, force: b.force === true,
  });
  return r.ok ? json(r, r.created ? 201 : 200) : err(400, r.error);
}
