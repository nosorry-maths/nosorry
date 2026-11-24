import { err, idempotent, json, withUser } from "@/lib/api";
import { requireLease } from "@/lib/desk";
import { postNote, type NoteInput } from "@/lib/feed";

/** Post an idea / promising note / question / reply: { kind, body_md, reply_to?, lead_id?, force? }. Ideas are UNVERIFIED. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const slug = (await params).slug;
  return idempotent(req, u, `note:${slug}`, async () => {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const lease = await requireLease(u, slug, b.lease ? String(b.lease) : null);
  if ("error" in lease) return err(lease.status, lease.error);
  const r = await postNote(u, slug, {
    kind: String(b.kind ?? "") as NoteInput["kind"], body_md: String(b.body_md ?? ""), reply_to: Number(b.reply_to) || undefined,
    lead_id: Number(b.lead_id) || undefined, force: b.force === true,
  });
  return r.ok ? json(r, r.created ? 201 : 200) : err(400, r.error);
  });
}
