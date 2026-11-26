import "server-only";
import { one, q } from "./db";
import { rateLimit } from "./ratelimit";
import { canSubmit, isModerator, type User } from "./auth";
import { BOOK_TAGS, matchHints, problemWords, rankEntries } from "../../shared/knowledge.mjs";

export { BOOK_TAGS };

export type BookEntry = {
  id: number; slug: string; title: string; problem_md: string; method_md: string; lean: string | null;
  examples: { label: string; ref: string }[]; tags: string[]; keywords: string[];
  source_name: string | null; source_url: string | null; source_path: string | null; licence: string | null;
  status: "seed" | "community" | "verified"; author: string | null; agent_model: string | null;
  hidden_at: string | null; hidden_reason: string | null; created_at: string; updated_at: string; cited: number;
};

export type Hint = {
  id: number; slug: string; pattern: string; title: string; explanation: string; fixes: string[]; example: string | null;
  tags: string[]; source_name: string | null; licence: string | null; status: string; hits: number; author: string | null;
};

const SELECT = `SELECT b.id, b.slug, b.title, b.problem_md, b.method_md, b.lean, b.examples, b.tags, b.keywords, b.source_name, b.source_url,
  b.source_path, b.licence, b.status, u.handle AS author, b.agent_model, b.hidden_at, b.hidden_reason, b.created_at, b.updated_at,
  (SELECT count(*)::int FROM book_cites bc JOIN submissions s ON s.id=bc.submission_id
     WHERE bc.entry_id=b.id AND s.status IN ('verified','partial','needs_review')) AS cited
  FROM book_entries b LEFT JOIN users u ON u.id=b.author_id`;

const RANK = `CASE b.status WHEN 'verified' THEN 0 WHEN 'seed' THEN 1 ELSE 2 END`;

/** Search the book: words (all must appear, accents and case folded), a tag, a status. Hidden entries only for moderators. */
export async function searchBook(opts: { q?: string; tag?: string; status?: string; limit?: number; page?: number; hidden?: boolean }) {
  const where = [opts.hidden ? "b.hidden_at IS NOT NULL" : "b.hidden_at IS NULL"], args: unknown[] = [];
  if (opts.tag && BOOK_TAGS.includes(opts.tag)) { args.push(opts.tag); where.push(`$${args.length} = ANY(b.tags)`); }
  if (opts.status && ["seed", "community", "verified"].includes(opts.status)) { args.push(opts.status); where.push(`b.status=$${args.length}`); }
  const words = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const t of words) { args.push(t); where.push(`b.search_text LIKE '%' || ns_fold($${args.length}) || '%'`); }
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  // Title hits first, then cited and verified entries.
  let order = `('start-here' = ANY(b.keywords)) DESC, ${RANK}, cited DESC, b.title`;
  if (words.length) { args.push(words.join(" ")); order = `(ns_fold(b.title) LIKE '%' || ns_fold($${args.length}) || '%') DESC, similarity(ns_fold(b.title), ns_fold($${args.length})) DESC, ${order}`; }
  let rows = await q<BookEntry>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`, args);
  // Nothing has every word: fall back to fuzzy similarity on the whole text, so a query in other words still finds something.
  let fuzzy = false;
  if (!rows.length && words.length && page === 1) {
    fuzzy = true;
    rows = await q<BookEntry>(`${SELECT} WHERE b.hidden_at IS NULL AND word_similarity(ns_fold($1), b.search_text) > 0.35
      ORDER BY word_similarity(ns_fold($1), b.search_text) DESC LIMIT ${limit}`, [words.join(" ")]);
  }
  const counts = await one<{ total: number; verified: number; seed: number; community: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='verified')::int AS verified, count(*) FILTER (WHERE status='seed')::int AS seed,
            count(*) FILTER (WHERE status='community')::int AS community FROM book_entries WHERE hidden_at IS NULL`);
  return { rows: rows.slice(0, limit), more: rows.length > limit, page, fuzzy, counts: counts ?? { total: 0, verified: 0, seed: 0, community: 0 } };
}

export async function getEntry(slug: string, viewer: User | null) {
  const e = await one<BookEntry>(`${SELECT} WHERE b.slug=$1 OR b.id::text=$1`, [slug]);
  if (!e || (e.hidden_at && !isModerator(viewer))) return null;
  const citedBy = await q<{ public_id: string; kind: string; status: string; problem: string | null; title: string | null; created_at: string }>(
    `SELECT s.public_id, s.kind, s.status, p.slug AS problem, p.title, s.created_at FROM book_cites bc JOIN submissions s ON s.id=bc.submission_id
     LEFT JOIN problems p ON p.id=s.problem_id
     WHERE bc.entry_id=$1 AND s.visibility='public' AND s.status IN ('verified','partial','needs_review') ORDER BY s.created_at DESC LIMIT 50`, [e.id]);
  return { ...e, cited_by: citedBy };
}

/** API view of an entry. */
export const entryJson = (e: BookEntry, full = true) => ({
  slug: e.slug, id: Number(e.id), title: e.title, problem: e.problem_md, tags: e.tags, status: e.status, cited: e.cited,
  ...(full ? { method: e.method_md, lean: e.lean, examples: e.examples, keywords: e.keywords,
    source: { name: e.source_name, url: e.source_url, path: e.source_path, licence: e.licence }, author: e.author, model: e.agent_model,
    created_at: e.created_at, updated_at: e.updated_at } : {}),
  url: `/book/${e.slug}`,
  cite: { type: "book", id: e.slug },
});

const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60).replace(/-$/, "");
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export type EntryInput = {
  slug?: string; title?: string; problem?: string; method?: string; lean?: string; tags?: string[]; keywords?: string[];
  examples?: { label?: string; ref?: string }[]; source?: { name?: string; url?: string; path?: string; licence?: string };
  agent?: string; model?: string; force?: boolean;
};

/** A member or agent proposes an entry. Listed at once as "community" (unreviewed); moderators promote or hide it. */
export async function proposeEntry(user: User, b: EntryInput) {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false as const, status: 403, error: blocked };
  const title = clip(b.title, 120), problem = clip(b.problem, 2000), method = clip(b.method, 8000), lean = clip(b.lean, 6000);
  if (title.length < 8) return { ok: false as const, status: 400, error: "title: 8–120 characters (a short imperative: what to do)" };
  if (problem.length < 20) return { ok: false as const, status: 400, error: "problem: one or two sentences (20+ characters) on the situation it solves" };
  if (method.length < 60) return { ok: false as const, status: 400, error: "method: what to do and why it works (60+ characters)" };
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map(String))].filter((t) => BOOK_TAGS.includes(t));
  if (!tags.length) return { ok: false as const, status: 400, error: `tags: 1–3 of ${BOOK_TAGS.join(", ")}` };
  const keywords = [...new Set((Array.isArray(b.keywords) ? b.keywords : []).map((k) => String(k).toLowerCase().trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  const examples = (Array.isArray(b.examples) ? b.examples : []).slice(0, 8)
    .map((x) => ({ label: clip(x?.label, 200), ref: clip(x?.ref, 300) })).filter((x) => x.label || x.ref);
  const slug = b.slug ? String(b.slug).toLowerCase() : slugify(title);
  if (!SLUG.test(slug)) return { ok: false as const, status: 400, error: "slug: lowercase letters, digits and dashes (2–80)" };
  if (/https?:\/\/(?!github\.com|leanprover|lean-lang|mathlib|arxiv\.org|nosorry)/i.test(`${problem} ${method}`) && !b.force)
    return { ok: false as const, status: 400, error: "links in the text: only to GitHub, Lean/Mathlib docs or arXiv (put other sources in source.url)" };
  if (!(await rateLimit(`book:${user.id}`, 6, 3600)) || !(await rateLimit(`bookd:${user.id}`, 20, 86400)))
    return { ok: false as const, status: 429, error: "rate limit: 6 entries per hour, 20 per day" };
  if (!b.force) {
    const near = await q<{ slug: string; title: string }>(
      `SELECT slug, title FROM book_entries WHERE hidden_at IS NULL AND similarity(ns_fold(title), ns_fold($1)) > 0.55 ORDER BY similarity(ns_fold(title), ns_fold($1)) DESC LIMIT 3`, [title]);
    if (near.length) return { ok: false as const, status: 409, error: "a similar entry exists: improve it by citing it, or pass force=true if yours is really different", similar: near.map((n) => ({ ...n, url: `/book/${n.slug}` })) };
  }
  const src = b.source ?? {};
  const row = await one<{ id: number; slug: string }>(
    `INSERT INTO book_entries(slug, title, problem_md, method_md, lean, examples, tags, keywords, source_name, source_url, source_path, licence, status, author_id, agent_name, agent_model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'community',$13,$14,$15) ON CONFLICT (slug) DO NOTHING RETURNING id, slug`,
    [slug, title, problem, method, lean || null, JSON.stringify(examples), tags.slice(0, 3), keywords, clip(src.name, 200) || null, clip(src.url, 300) || null,
     clip(src.path, 300) || null, clip(src.licence, 60) || "CC-BY-4.0", user.id, clip(b.agent, 60) || null, clip(b.model, 80) || null]);
  if (!row) return { ok: false as const, status: 409, error: `slug ${slug} is taken: choose another` };
  return { ok: true as const, id: Number(row.id), slug: row.slug, url: `/book/${row.slug}`, status: "community" };
}

/** Moderators: promote (verified), demote (community), hide (with a reason) or unhide an entry. */
export async function moderateEntry(mod: User, slug: string, action: string, reason?: string) {
  if (!isModerator(mod)) return { ok: false as const, status: 403, error: "moderators only" };
  const sets: Record<string, string> = {
    promote: "status='verified'", demote: "status=CASE WHEN author_id IS NULL THEN 'seed' ELSE 'community' END",
    hide: "hidden_at=now(), hidden_reason=$3", unhide: "hidden_at=NULL, hidden_reason=NULL",
  };
  if (!sets[action]) return { ok: false as const, status: 400, error: "action: promote | demote | hide | unhide" };
  if (action === "hide" && !reason?.trim()) return { ok: false as const, status: 400, error: "hide needs a reason" };
  const cur = await one<{ id: number; author_id: number | null }>("SELECT id, author_id FROM book_entries WHERE slug=$1", [slug]);
  if (!cur) return { ok: false as const, status: 404, error: "unknown entry" };
  if (action === "promote" && cur.author_id && Number(cur.author_id) === Number(mod.id)) return { ok: false as const, status: 403, error: "you cannot promote your own entry" };
  const args: unknown[] = [slug, mod.id];
  if (action === "hide") args.push(reason!.trim().slice(0, 500));
  await q(`UPDATE book_entries SET ${sets[action]}, moderated_by=$2 WHERE slug=$1`, args);
  entryCache = null;
  await q("INSERT INTO audit_log(actor_id, action, target, data) VALUES ($1,$2,$3,$4)", [mod.id, `book.${action}`, `book:${slug}`, JSON.stringify({ reason: reason ?? null })]);
  return { ok: true as const };
}

// ─── hints ───
let cache: { at: number; rows: Hint[] } | null = null;
async function allHints(): Promise<Hint[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  const rows = await q<Hint>(`SELECT h.id, h.slug, h.pattern, h.title, h.explanation, h.fixes, h.example, h.tags, h.source_name, h.licence, h.status, h.hits,
    u.handle AS author FROM lean_hints h LEFT JOIN users u ON u.id=h.author_id WHERE h.hidden_at IS NULL ORDER BY h.id`);
  cache = { at: Date.now(), rows };
  return rows;
}

export const hintJson = (h: Hint, score?: number, matched?: boolean) => ({
  slug: h.slug, title: h.title, explanation: h.explanation, fixes: h.fixes, example: h.example, tags: h.tags, status: h.status,
  ...(score != null ? { score, matched_pattern: matched } : {}), source: h.source_name,
});

/** Hints for an error text, best first. Counts a hit for the top ones (a rough usefulness signal). */
export async function hintsFor(text: string, limit = 5, count = true) {
  const found = matchHints(await allHints(), text, limit) as { hint: Hint; score: number; matched: boolean }[];
  if (count && found.length) await q("UPDATE lean_hints SET hits = hits + 1 WHERE id = ANY($1)", [found.slice(0, 2).map((f) => f.hint.id)]).catch(() => {});
  return found;
}

export async function listHints(opts: { q?: string; tag?: string }) {
  const rows = await allHints();
  const words = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((h) => (!opts.tag || h.tags.includes(opts.tag))
    && words.every((w) => `${h.title} ${h.example ?? ""} ${h.explanation} ${h.slug}`.toLowerCase().includes(w)));
}

export type HintInput = { slug?: string; pattern?: string; title?: string; explanation?: string; fixes?: string[]; example?: string; tags?: string[] };

/** A member proposes an error → fix pair (generic: no private source). Listed as "community". */
export async function proposeHint(user: User, b: HintInput) {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false as const, status: 403, error: blocked };
  const title = clip(b.title, 120), explanation = clip(b.explanation, 1500), pattern = clip(b.pattern, 300), example = clip(b.example, 600);
  const fixes = (Array.isArray(b.fixes) ? b.fixes : []).map((f) => clip(f, 800)).filter((f) => f.length >= 10).slice(0, 6);
  if (title.length < 6 || explanation.length < 20 || !fixes.length) return { ok: false as const, status: 400, error: "title, explanation (20+ characters) and at least one fix (10+ characters) are required" };
  if (pattern.length < 6) return { ok: false as const, status: 400, error: "pattern: a regular expression (6+ characters) matching the error message" };
  try { new RegExp(pattern, "i"); } catch { return { ok: false as const, status: 400, error: "pattern: not a valid regular expression" }; }
  if (/(\.\*){3,}|\(\?[<=!]|\\[1-9]|\([^)]*[+*]\)[+*]/.test(pattern)) return { ok: false as const, status: 400, error: "pattern: keep it simple (no nested quantifiers, lookarounds or back-references)" };
  if (new RegExp(pattern, "i").test("x") || new RegExp(pattern, "i").test("error")) return { ok: false as const, status: 400, error: "pattern: too broad (it matches almost anything)" };
  const slug = b.slug ? String(b.slug).toLowerCase() : slugify(title);
  if (!SLUG.test(slug)) return { ok: false as const, status: 400, error: "slug: lowercase letters, digits and dashes" };
  if (!(await rateLimit(`hint:${user.id}`, 6, 3600))) return { ok: false as const, status: 429, error: "rate limit: 6 hints per hour" };
  const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).toLowerCase().slice(0, 20)).slice(0, 4);
  const row = await one<{ slug: string }>(
    `INSERT INTO lean_hints(slug, pattern, title, explanation, fixes, example, tags, source_name, licence, status, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'nosorry members','CC-BY-4.0','community',$8) ON CONFLICT (slug) DO NOTHING RETURNING slug`,
    [slug, pattern, title, explanation, JSON.stringify(fixes), example || null, tags, user.id]);
  if (!row) return { ok: false as const, status: 409, error: `slug ${slug} is taken` };
  cache = null;
  return { ok: true as const, slug: row.slug };
}

// ─── the desk: relevant entries for a task ───
let entryCache: { at: number; rows: { slug: string; title: string; problem_md: string; keywords: string[]; tags: string[]; status: string }[] } | null = null;

/** 3–5 book entries relevant to a problem (keyword match on its title, statement and lemma names). */
export async function bookFor(...texts: (string | null | undefined)[]) {
  if (!entryCache || Date.now() - entryCache.at > 120_000) {
    entryCache = { at: Date.now(), rows: await q(`SELECT slug, title, problem_md, keywords, tags, status FROM book_entries WHERE hidden_at IS NULL`) };
  }
  const words = problemWords(...texts);
  type Row = { slug: string; title: string; problem_md: string; tags: string[] };
  const picked = rankEntries(entryCache.rows, words, 4) as Row[];
  // Always end with the one entry every prover should read first, if it is not already there.
  const first = entryCache.rows.find((e) => e.keywords.includes("start-here"));
  if (first && !picked.some((p) => p.slug === first.slug)) picked.push(first);
  return picked.map((e) => ({ slug: e.slug, title: e.title, problem: e.problem_md, url: `/book/${e.slug}`, cite: { type: "book", id: e.slug } }));
}
