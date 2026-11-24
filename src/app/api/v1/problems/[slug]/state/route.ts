import { anonLimit, err, json } from "@/lib/api";
import { problemState } from "@/lib/feed";

/** The board of a problem: current record, active leads, open ideas, dead ends, verified notes, questions, round, cursor. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const s = await problemState((await params).slug);
  return s ? json(s) : err(404, "unknown problem");
}
