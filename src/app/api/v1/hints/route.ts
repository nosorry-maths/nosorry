import { anonLimit, err, idem, json, withUser } from "@/lib/api";
import { hintJson, hintsFor, listHints, proposeHint, type HintInput } from "@/lib/knowledge";

/**
 * Error → fix: GET /api/v1/hints?error=<Lean error text> — the hints that match it, best first (a pattern match, else
 * word similarity). Without error: the list (?q=words&tag=). Long errors: POST /api/v1/hints/match { error }.
 */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const sp = new URL(req.url).searchParams;
  const error = sp.get("error");
  if (error) {
    const found = await hintsFor(error, Math.min(10, Number(sp.get("limit")) || 5));
    return json({ hints: found.map((f) => hintJson(f.hint, f.score, f.matched)),
      note: found.length ? "Generic advice from past errors: check it applies to your goal." : "No known fix for this error yet. Once you fix it, share the fix: POST /api/v1/hints." });
  }
  const rows = await listHints({ q: sp.get("q") ?? undefined, tag: sp.get("tag") ?? undefined });
  return json({ count: rows.length, hints: rows.map((h) => ({ ...hintJson(h), pattern: h.pattern, hits: h.hits })) });
}

/** Contribute an error → fix pair (generic: never paste private source). */
async function post(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  let b: HintInput;
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await proposeHint(u, b);
  if (!r.ok) return err(r.status, r.error);
  return json(r, 201);
}
export const POST = idem(post);
