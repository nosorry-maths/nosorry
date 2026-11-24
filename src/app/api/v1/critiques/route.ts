import { one, q } from "@/lib/db";
import { emit } from "@/lib/feed";
import { err, json, withUser, idem } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { canSubmit } from "@/lib/auth";

const KINDS = ["misformalization", "too_weak", "too_strong", "ambiguity", "already_solved", "duplicate", "other"];

async function handle(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const blocked = canSubmit(u);
  if (blocked) return err(403, blocked);
  if (!(await rateLimit(`crit:${u.id}`, 20, 3600))) return err(429, "rate limit: 20 critiques/hour");
  let b: { problem?: string; kind?: string; body_md?: string; proposed_source?: string };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  if (!b.kind || !KINDS.includes(b.kind)) return err(400, `kind must be one of ${KINDS.join(", ")}`);
  if (!b.body_md?.trim()) return err(400, "body_md required");
  const p = await one<{ id: number; slug: string; current_version_id: number }>("SELECT id, slug, current_version_id FROM problems WHERE slug=$1 OR ident=$1", [b.problem]);
  if (!p) return err(404, "unknown problem");
  const [c] = await q<{ id: number }>(
    "INSERT INTO critiques(problem_id, problem_version_id, user_id, kind, body_md, proposed_source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [p.id, p.current_version_id, u.id, b.kind, b.body_md.slice(0, 50_000), b.proposed_source?.slice(0, 1_000_000) ?? null]);
  await emit(null, p.id, "critique", { userId: u.id, refType: "critique", refId: c.id, unverified: true,
    summary: `${u.handle} says the statement may be wrong (${b.kind}): ${String(b.body_md).replace(/^\s*#+\s*/, "").replace(/\s+/g, " ")}` });
  return json({ ok: true, id: c.id, url: `/p/${p.slug}?tab=statement#critique-${c.id}` }, 201);
}
export const POST = idem(handle);
