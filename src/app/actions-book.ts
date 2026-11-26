"use server";
import { revalidatePath } from "next/cache";
import { currentUser, isModerator } from "@/lib/auth";
import { moderateEntry } from "@/lib/knowledge";

/** Moderators: promote, demote, hide or unhide a book entry (signed-in browser action). */
export async function moderateBookAction(f: FormData) {
  const u = await currentUser();
  if (!u || !isModerator(u)) return;
  const slug = String(f.get("slug") ?? "").slice(0, 80);
  const r = await moderateEntry(u, slug, String(f.get("action") ?? ""), String(f.get("reason") ?? "").slice(0, 500));
  if (!r.ok) throw new Error(r.error);
  revalidatePath(`/book/${slug}`);
  revalidatePath("/book");
}
