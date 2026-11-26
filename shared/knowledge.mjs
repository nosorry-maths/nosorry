// Shared knowledge (book of methods, error → fix hints), used by the web app and the worker.
//
// Credit: a book entry cited by an accepted proof earns its author a few REFEREE points. It is kept small and hard to
// game: never for citing your own entry, only for an entry written before the citing submission, at most
// POINTS.book.maxPerSubmission entries per submission, once per entry and problem, and only from the proof or disproof
// that SETTLES a problem (the first one Lean accepts; not a lemma, not a re-proof of a settled problem, which earns
// nothing either). Every accepted citation is still recorded (book_cites) and shown.
// A revoked submission reverses these awards like its other non-proof awards (src/app/actions.ts).
import { POINTS } from "./scoring.mjs";

export const BOOK_TAGS = ["tactics", "architecture", "performance", "pitfalls", "mathlib"];
export const BOOK_STATUSES = ["seed", "community", "verified"];

/** @param {any} c pg client in a transaction  @param {any} sub submission row (with cites, problem_status) */
export async function creditBookCites(c, sub) {
  const cites = Array.isArray(sub.cites) ? sub.cites : [];
  const ids = [...new Set(cites.filter((x) => x && x.type === "book" && Number(x.id) > 0).map((x) => Number(x.id)))].slice(0, 20);
  if (!ids.length) return [];
  const { rows: entries } = await c.query(
    `SELECT id, slug, author_id FROM book_entries WHERE id = ANY($1) AND hidden_at IS NULL AND created_at < $2 ORDER BY id`,
    [ids, sub.created_at]);
  let isProof = (sub.kind === "proof" || sub.kind === "disproof") && sub.problem_status !== "lemma";
  if (isProof) {
    const { rowCount: earlier } = await c.query(
      `SELECT 1 FROM submissions WHERE problem_id=$1 AND id<>$2 AND kind IN ('proof','disproof') AND status IN ('verified','needs_review')
       AND (created_at, id) < ($3, $2) LIMIT 1`, [sub.problem_id, sub.id, sub.created_at]);
    if (earlier) isProof = false;
  }
  const out = [];
  let paid = 0;
  for (const e of entries) {
    const ins = await c.query("INSERT INTO book_cites(entry_id, submission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [e.id, sub.id]);
    if (!ins.rowCount) continue;
    out.push(e.slug);
    if (!isProof || !e.author_id || Number(e.author_id) === Number(sub.user_id) || paid >= POINTS.book.maxPerSubmission) continue;
    const { rowCount: before } = await c.query(
      `SELECT 1 FROM point_events pe JOIN submissions s2 ON s2.id = pe.submission_id
       WHERE pe.reason = 'book:cited' AND pe.note LIKE $1 AND s2.problem_id = $2
         AND NOT EXISTS (SELECT 1 FROM point_events r WHERE r.reverses_id = pe.id) LIMIT 1`,
      [`book entry ${e.slug} %`, sub.problem_id]);
    if (before) continue;
    paid++;
    await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, note) VALUES ($1,$2,$3,'book:cited',$4)",
      [e.author_id, sub.id, POINTS.book.cited, `book entry ${e.slug} cited by submission ${sub.public_id}`]);
  }
  return out;
}

/** Turn a Lean error text into the words used to search (identifiers and line numbers removed). */
export function errorShape(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/^.*?:\d+:\d+:\s*/gm, "")             // file:line:col: prefixes
    .replace(/'[^'\n]{1,200}'/g, "'…'")            // quoted names
    .replace(/`[^`\n]{1,200}`/g, "`…`")
    .replace(/\b\d+\b/g, "N")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const compiled = new Map();
function rx(p) {
  if (!compiled.has(p)) { let r = null; try { r = new RegExp(p, "i"); } catch { r = null; } compiled.set(p, r); }
  return compiled.get(p);
}

/**
 * Rank hints for an error text: a pattern that matches wins; otherwise word overlap with the hint's example and
 * title. Returns [{ hint, score, matched }] best first.
 * @param {{pattern:string,title:string,example?:string|null,explanation:string}[]} hints
 */
export function matchHints(hints, text, limit = 5) {
  const t = String(text ?? "").slice(0, 20000);
  const words = (s) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, " ").split(" ").filter((w) => w.length > 2));
  const mine = words(errorShape(t));
  const scored = [];
  for (const h of hints) {
    const r = rx(h.pattern);
    const matched = !!(r && r.test(t));
    let score = matched ? 100 : 0;
    if (!matched && mine.size) {
      const theirs = words(`${h.example ?? ""} ${h.title}`);
      let n = 0; for (const w of theirs) if (mine.has(w)) n++;
      score = theirs.size ? Math.round((40 * n) / Math.sqrt(theirs.size * mine.size)) : 0;
    }
    if (score >= 12) scored.push({ hint: h, score, matched });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Words of a problem used to find relevant entries (Lean identifiers split on dots and underscores). */
export function problemWords(...texts) {
  const out = new Set();
  for (const s of texts) for (const w of String(s ?? "").toLowerCase().split(/[^a-z0-9_.]+/)) {
    if (!w) continue;
    for (const part of [w, ...w.split(/[._]/)]) if (part.length > 2 && !STOP.has(part)) out.add(part);
  }
  return out;
}
const STOP = new Set(["the", "and", "for", "theorem", "lemma", "def", "fun", "let", "have", "show", "with", "this", "that", "from", "are",
  "is", "sorry", "true", "false", "open", "namespace", "end", "variable", "example", "type", "prop", "answer", "erdos", "problem", "problems",
  "there", "exists", "all", "any", "such", "every", "where", "which", "real", "nat", "int"]);

/** Score entries against a set of problem words (keywords count most, then title words). */
export function rankEntries(entries, words, limit = 4) {
  const scored = [];
  for (const e of entries) {
    let s = 0;
    for (const k of e.keywords ?? []) {
      const kk = String(k).toLowerCase();
      if (words.has(kk)) s += 3;
      else for (const part of kk.split(/[\s._-]+/)) if (part.length > 3 && words.has(part)) { s += 1; break; }
    }
    for (const w of String(e.title).toLowerCase().split(/[^a-z0-9_]+/)) if (w.length > 3 && words.has(w)) s += 1;
    if (s > 0) scored.push({ e, s: s + (e.status === "verified" ? 1 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}
