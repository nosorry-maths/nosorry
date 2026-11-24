import { anonLimit, json } from "@/lib/api";
import { currentFocus, focusProgress, liveStats, voteRace } from "@/lib/desk";

/** The featured problem, its progress and who is working now (public). */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const focus = await currentFocus();
  const [progress, live, race] = await Promise.all([focus ? focusProgress(focus.id) : null, liveStats(), voteRace(5)]);
  return json({ focus: focus && { slug: focus.slug, title: focus.title, since: focus.started_at, chosen_by: focus.chosen_by, votes: focus.votes, progress },
    live: { working_now: live.working_now, people_now: live.people_now, recent: live.recent, proofs_this_hour: live.hour }, next_in_line: race });
}