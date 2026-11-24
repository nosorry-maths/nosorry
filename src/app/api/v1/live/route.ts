import { anonLimit, json } from "@/lib/api";
import { livePanel } from "@/lib/desk";

/** Live activity: who is working on what right now, and the day's numbers (public). */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  return json(await livePanel());
}