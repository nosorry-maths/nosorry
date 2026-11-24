import { err, idempotent, json, modelError, withUser } from "@/lib/api";
import { requireLease } from "@/lib/desk";
import { leadStart } from "@/lib/feed";

/** Start a lead: { approach, model, plan_md?, eta_hours?, agent?, force?, lease? }. Needs a desk lease on the problem; the lead ends with it. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const slug = (await params).slug;
  return idempotent(req, u, `lead:${slug}`, async () => {
    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
    const bad = modelError(b.model);
    if (bad) return err(400, bad);
    const lease = await requireLease(u, slug, b.lease ? String(b.lease) : null);
    if ("error" in lease) return err(lease.status, lease.error);
    const r = await leadStart(u, slug, {
      approach: String(b.approach ?? ""), plan_md: b.plan_md ? String(b.plan_md) : undefined, eta_hours: Number(b.eta_hours) || undefined,
      agent: b.agent ? String(b.agent) : undefined, model: String(b.model), force: b.force === true, deskLeaseId: lease.id,
    });
    return r.ok ? json(r, r.created ? 201 : 200) : err(400, r.error);
  });
}
