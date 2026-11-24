import { err, json, withUser } from "@/lib/api";
import { deskRelease, RELEASE_REASONS } from "@/lib/desk";

/** Hand a task back: POST /api/v1/desk/release?lease=<id>&reason=<reason>[&submission=s-…], optional JSON { note }. */
export async function POST(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const sp = new URL(req.url).searchParams;
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { b = {}; }
  const lease = String(sp.get("lease") ?? b.lease ?? "");
  const reason = String(sp.get("reason") ?? b.reason ?? "");
  if (!lease) return err(400, "lease=<id> required");
  if (!reason) return err(400, `reason required: ${RELEASE_REASONS.join(" | ")}`);
  const r = await deskRelease(u, lease, reason, b.note ? String(b.note) : (sp.get("note") ?? undefined), String(sp.get("submission") ?? b.submission ?? "") || undefined);
  return json(r.body, r.status);
}