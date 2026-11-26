import { anonLimit, err, json, withUser } from "@/lib/api";
import { apiUser } from "@/lib/auth";
import { entryJson, getEntry, moderateEntry } from "@/lib/knowledge";

/** One entry of the book, with the accepted public submissions that cite it. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const e = await getEntry((await params).slug, await apiUser(req, "read"));
  if (!e) return err(404, "unknown entry");
  return json({ ...entryJson(e), hidden: e.hidden_at ? { at: e.hidden_at, reason: e.hidden_reason } : undefined,
    cited_by: e.cited_by.map((c) => ({ submission: c.public_id, kind: c.kind, status: c.status, problem: c.problem, url: `/s/${c.public_id}` })) });
}

/** Moderators: { action: promote | demote | hide | unhide, reason? }. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  let b: { action?: string; reason?: string };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await moderateEntry(u, (await params).slug, String(b.action ?? ""), b.reason);
  if (!r.ok) return err(r.status, r.error);
  return json({ ok: true });
}
