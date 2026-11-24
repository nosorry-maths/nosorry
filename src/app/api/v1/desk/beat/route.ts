import { err, json, withUser } from "@/lib/api";
import { deskBeat } from "@/lib/desk";

/** Renew a lease: POST /api/v1/desk/beat?lease=<id>. 410 = stop work on this task, ask for another. */
export async function POST(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  const lease = new URL(req.url).searchParams.get("lease") ?? "";
  if (!lease) return err(400, "lease=<id> required");
  const r = await deskBeat(u, lease);
  return json(r.body, r.status);
}