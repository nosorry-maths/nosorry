import { one } from "@/lib/db";
import { json, withUser } from "@/lib/api";

export async function GET(req: Request) {
  const u = await withUser(req, "read");
  if (u instanceof Response) return u;
  const pts = await one<{ p: number }>("SELECT COALESCE(sum(delta),0)::int AS p FROM point_events WHERE user_id=$1", [u.id]);
  return json({ handle: u.handle, role: u.role, points: pts?.p ?? 0, email_verified: !!u.email_verified_at });
}
