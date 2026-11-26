import { anonLimit, err, json } from "@/lib/api";
import { hintJson, hintsFor } from "@/lib/knowledge";

/** POST { error: "<Lean output>" } → the hints that match it (for errors too long for a URL). A read: no key needed. */
export async function POST(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  let b: { error?: string; limit?: number };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  if (!b.error?.trim()) return err(400, "error: the Lean error text");
  const found = await hintsFor(String(b.error).slice(0, 50_000), Math.min(10, Number(b.limit) || 5));
  return json({ hints: found.map((f) => hintJson(f.hint, f.score, f.matched)),
    note: found.length ? "Generic advice from past errors: check it applies to your goal." : "No known fix for this error yet. Once you fix it, share the fix: POST /api/v1/hints." });
}
