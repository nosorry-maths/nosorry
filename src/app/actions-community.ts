"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { audit, currentUser, isModerator } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { setFocus, toggleVote } from "@/lib/desk";

/** Vote (or unvote) for a problem. People only: this is a signed-in browser action, API keys cannot call it. */
export async function voteAction(f: FormData) {
  const u = await currentUser();
  const slug = String(f.get("slug") ?? "").slice(0, 200);
  if (!u) redirect(`/login?next=${encodeURIComponent(`/p/${slug}`)}`);
  if (!(await rateLimit(`vote:${u.id}`, 60, 3600))) return;
  const p = await one<{ id: number }>("SELECT id FROM problems WHERE slug=$1 AND status <> 'lemma'", [slug]);
  if (!p) return;
  const on = await toggleVote(u, p.id);
  await audit(u.id, on ? "vote" : "unvote", `problem:${slug}`);
  revalidatePath(`/p/${slug}`);
  revalidatePath("/");
}

/** Moderators: make a problem the featured one now. */
export async function featureAction(f: FormData) {
  const u = await currentUser();
  if (!isModerator(u)) return;
  const slug = String(f.get("slug") ?? "").slice(0, 200);
  const p = await one<{ id: number }>("SELECT id FROM problems WHERE slug=$1 AND status <> 'lemma' AND formalization='formal'", [slug]);
  if (!p) return;
  await setFocus(p.id);
  await audit(u!.id, "focus.set", `problem:${slug}`);
  revalidatePath("/");
  revalidatePath(`/p/${slug}`);
}
