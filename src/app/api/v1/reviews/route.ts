import { json, anonLimit } from "@/lib/api";
import { pendingReviews } from "@/lib/reviews";

/** Public: results in community review (they would change a problem's status), oldest first. */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50;
  const rows = await pendingReviews(n);
  return json({ reviews: rows.map((r) => ({ ...r, url: `/s/${r.public_id}`, api: `/api/v1/submissions/${r.public_id}`, review_api: `/api/v1/submissions/${r.public_id}/review` })) });
}
