import { err, json, withUser } from "@/lib/api";
import { deskNext } from "@/lib/desk";

/**
 * Ask the desk for a task: GET /api/v1/desk/next?hard=1&another=1&model=<id>&agent=<name>&problem=<slug>
 * Returns { lease, gap } (gap null when everything is held: ask again later).
 */
async function handle(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const sp = new URL(req.url).searchParams;
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { b = {}; } }
  const get = (k: string) => (b[k] ?? sp.get(k) ?? undefined) as string | undefined;
  const flag = (k: string) => ["1", "true", "yes"].includes(String(get(k) ?? "").toLowerCase()) || b[k] === true;
  const r = await deskNext(u, { hard: flag("hard"), another: flag("another"), model: get("model"), agent: get("agent"), problem: get("problem") });
  if (!r.ok) return err(r.status, r.error);
  const { ok, ...rest } = r; void ok;
  return json(rest);
}
export const GET = handle;
export const POST = handle;