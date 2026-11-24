import { one } from "@/lib/db";
import { anonLimit, err, idempotent, json, withUser } from "@/lib/api";
import { requireLease } from "@/lib/desk";
import { audit } from "@/lib/auth";
import { saveThread, threadsForProblem } from "@/lib/research";

/** Public research threads on a problem (repositories + progress summaries). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const p = await one<{ id: number }>("SELECT id FROM problems WHERE slug=$1 OR ident=$1", [(await params).slug]);
  if (!p) return err(404, "unknown problem");
  const items = (await threadsForProblem(p.id)).map(({ user_id, ...t }) => { void user_id; return t; });
  return json({ items });
}

/** Create or update your research thread: { repo_url, summary_md, approach?, status?, open_to_collaborators? } */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const slug = (await params).slug;
  return idempotent(req, u, `research:${slug}`, async () => {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err(400, "invalid JSON"); }
  const lease = await requireLease(u, slug, body.lease ? String(body.lease) : null);
  if ("error" in lease) return err(lease.status, lease.error);
  const r = await saveThread(u, slug, {
    repo_url: String(body.repo_url ?? ""), summary_md: String(body.summary_md ?? ""), approach: body.approach ? String(body.approach) : undefined,
    status: body.status ? String(body.status) : undefined, open_to_collaborators: body.open_to_collaborators !== false,
  });
  if (!r.ok) return err(400, r.error);
  await audit(u.id, r.created ? "research.create" : "research.update", `thread:${r.id}`, { problem: r.slug, via: "api" });
  return json({ ok: true, id: r.id, created: r.created, url: `/p/${r.slug}#thread-${r.id}` }, r.created ? 201 : 200);
  });
}
