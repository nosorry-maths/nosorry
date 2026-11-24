import { err, json, withUser, idem } from "@/lib/api";
import { shareLemmasOf } from "@/lib/lemmas";

/** Author only: publish the statements left open by an accepted partial proof as intermediate lemmas . */
async function handle(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const r = await shareLemmasOf(u, (await params).id);
  return r.ok ? json(r) : err(400, r.error);
}
export const POST = idem(handle);
