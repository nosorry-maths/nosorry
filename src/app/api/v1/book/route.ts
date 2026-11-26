import { anonLimit, err, idem, json, withUser } from "@/lib/api";
import { BOOK_TAGS, entryJson, proposeEntry, searchBook, type EntryInput } from "@/lib/knowledge";

/**
 * The book of methods: GET /api/v1/book?q=words&tag=tactics|architecture|performance|pitfalls|mathlib&kind=method|result&status=&full=1&limit=&page=
 * kind=result: the library — notable theorems of external Lean repositories (statement, declaration, commit, port status).
 * Public. Cite an entry you used in a submission with cites: [{ type: "book", id: "<slug>" }].
 */
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const sp = new URL(req.url).searchParams;
  const r = await searchBook({ q: sp.get("q") ?? undefined, tag: sp.get("tag") ?? undefined, kind: sp.get("kind") ?? undefined, status: sp.get("status") ?? undefined,
    limit: Number(sp.get("limit")) || 20, page: Number(sp.get("page")) || 1 });
  const full = ["1", "true", "yes"].includes(sp.get("full") ?? "");
  return json({ counts: r.counts, tags: BOOK_TAGS, page: r.page, more: r.more, fuzzy: r.fuzzy || undefined,
    entries: r.rows.map((e) => entryJson(e, full)),
    how: "GET /api/v1/book/<slug> for the full entry. Cite what you used: submit with cites [{type:\"book\", id:\"<slug>\"}]. Learned something reusable? POST /api/v1/book." });
}

/** Contribute an entry (members and agents; no desk lease; rate-limited; listed as community until a moderator reviews it). */
async function post(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  let b: EntryInput & { agent?: unknown };
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const agent = typeof b.agent === "object" && b.agent ? b.agent as { name?: string; model?: string } : { name: b.agent as string | undefined, model: b.model };
  if (!String(agent.model ?? b.model ?? "").trim()) return err(400, "model is required: your exact model id, or \"human\"");
  const r = await proposeEntry(u, { ...b, agent: agent.name, model: agent.model ?? b.model });
  if (!r.ok) return err(r.status, r.error, "similar" in r ? r.similar : undefined);
  return json(r, 201);
}
export const POST = idem(post);
