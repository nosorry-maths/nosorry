"use server";
// Community review of a result held for review (src/lib/reviews.ts): browser actions for signed-in members.
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, canSubmit, clientIp, audit } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { vote, comment, suggest, decideSuggestion, hideComment } from "@/lib/reviews";

const str = (f: FormData, k: string, max = 100_000) => String(f.get(k) ?? "").slice(0, max).trim();

async function member(id: string) {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/s/${id}#review`)}`);
  const blocked = canSubmit(u);
  if (blocked) back(id, blocked);
  return u;
}
function back(id: string, msg?: string, anchor = "review"): never {
  revalidatePath(`/s/${id}`);
  redirect(`/s/${id}${msg ? `?msg=${encodeURIComponent(msg.charAt(0).toUpperCase() + msg.slice(1) + ".")}` : ""}#${anchor}`);
}
async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string; url?: string }>) {
  let r;
  try { r = await fn(); } catch (e) { unstable_rethrow(e); r = { ok: false, error: e instanceof Error ? e.message : "this action could not be completed" }; }
  if (!r.ok) back(id, r.error);
  if (r.url && !r.url.startsWith(`/s/${id}`)) { revalidatePath(`/s/${id}`); redirect(r.url); }
  back(id, undefined, r.url?.split("#")[1] ?? "review");
}

export async function reviewVoteAction(f: FormData) {
  const id = str(f, "id", 40);
  const u = await member(id);
  if (!(await rateLimit(`vote:${u.id}`, 120, 3600))) back(id, "too many votes, try again later");
  await run(id, () => vote(u, id, Number(f.get("value"))));
}

export async function reviewCommentAction(f: FormData) {
  const id = str(f, "id", 40);
  const u = await member(id);
  if (!(await rateLimit(`comment:${u.id}`, 60, 3600))) back(id, "too many comments, try again later");
  const line = Number(str(f, "line", 10)) || null, replyTo = Number(str(f, "reply_to", 20)) || null;
  await run(id, () => comment(u, id, { body_md: str(f, "body", 20_000), line, reply_to: replyTo }));
}

export async function reviewSuggestAction(f: FormData) {
  const id = str(f, "id", 40);
  const u = await member(id);
  if (!(await rateLimit(`suggest:${u.id}`, 20, 3600))) back(id, "too many suggestions, try again later");
  await run(id, () => suggest(u, id, { body_md: str(f, "body", 20_000), lean_source: String(f.get("lean_source") ?? "") }));
}

export async function reviewDecideSuggestionAction(f: FormData) {
  const id = str(f, "id", 40);
  const u = await member(id);
  const action = str(f, "action", 10) === "apply" ? "apply" : "close";
  const gid = Number(str(f, "gid", 20));
  await audit(u.id, `suggestion.${action}`, `submission:${id}#${gid}`);
  await run(id, async () => decideSuggestion(u, id, gid, action, await clientIp()));
}

export async function reviewHideCommentAction(f: FormData) {
  const id = str(f, "id", 40);
  const u = await member(id);
  const cid = Number(str(f, "cid", 20));
  await audit(u.id, "comment.hide", `submission:${id}#c${cid}`);
  await run(id, () => hideComment(u, cid));
}
