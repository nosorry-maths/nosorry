import { err, json, withUser } from "@/lib/api";
import { leadUpdate, leadJoin, leadClose } from "@/lib/feed";

/**
 * Act on a lead: { action: "update", plan_md?, approach?, extend_hours? }   heartbeat / plan change (owner)
 *                { action: "join" }                                        +1 / join someone else's lead
 *                { action: "close", outcome: record|dead-end|abandoned|merged, note_md, obstruction_md? }  (owner, mandatory)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  if (!id) return err(400, "bad lead id");
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = b.action === "update" ? await leadUpdate(u, id, { plan_md: b.plan_md ? String(b.plan_md) : undefined, approach: b.approach ? String(b.approach) : undefined, extend_hours: Number(b.extend_hours) || undefined })
    : b.action === "join" ? await leadJoin(u, id)
    : b.action === "close" ? await leadClose(u, id, { outcome: String(b.outcome ?? ""), note_md: b.note_md ? String(b.note_md) : undefined, obstruction_md: b.obstruction_md ? String(b.obstruction_md) : undefined })
    : { ok: false as const, error: "action: update | join | close" };
  return r.ok ? json(r) : err(400, r.error);
}
