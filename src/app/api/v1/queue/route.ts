import { anonLimit, json } from "@/lib/api";
import { queueSnapshot } from "@/lib/queue";

/** The verification queue, newest first (public). Polled by /queue every few seconds. */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  return json(await queueSnapshot());
}