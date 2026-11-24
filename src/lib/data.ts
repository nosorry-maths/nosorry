import "server-only";
import { one, q } from "./db";

export type Subject = { code: string; name: string; parent: string | null; level: number; description: string | null; n: number; open: number };
export type ProblemRow = {
  id: number; ident: string; slug: string; title: string; statement_md: string | null; status: string; statement_status: string;
  primary_subject: string; subjects: string[]; tags: string[]; collection: string; solved_on_platform: boolean; resolution: string | null;
  variant_of: number | null; updated_at: string; n_proofs?: number; n_threads?: number; formalization?: string; n_partial?: number; n_variants?: number; source_url?: string | null;
};

export const PAGE = 50;
export const RESEARCH = ["open", "solved"];
// Problems are research problems unless they are demo/pipeline tests (tag "demo").
const NOT_DEMO = "NOT ('demo' = ANY(p.tags))";

export async function subjectTree(): Promise<Subject[]> {
  return q<Subject>(`
    WITH counts AS (
      SELECT unnest(subjects) AS code, count(*)::int AS n, count(*) FILTER (WHERE status='open')::int AS open
      FROM problems p WHERE status = ANY($1) AND variant_of IS NULL AND ${NOT_DEMO} GROUP BY 1
    )
    SELECT s.code, s.name, s.parent, s.level, s.description,
      COALESCE(CASE WHEN s.level=1 THEN (SELECT count(*)::int FROM problems p WHERE p.field=s.code AND p.status = ANY($1) AND variant_of IS NULL AND ${NOT_DEMO}) ELSE c.n END, 0) AS n,
      COALESCE(CASE WHEN s.level=1 THEN (SELECT count(*)::int FROM problems p WHERE p.field=s.code AND p.status='open' AND variant_of IS NULL AND ${NOT_DEMO}) ELSE c.open END, 0) AS open
    FROM subjects s LEFT JOIN counts c ON c.code = s.code ORDER BY s.level, s.sort_order`, [RESEARCH]);
}

export async function getSubject(code: string) {
  return one<{ code: string; name: string; parent: string | null; level: number; description: string | null }>(
    "SELECT code, name, parent, level, description FROM subjects WHERE code=$1", [code]);
}

/** MSC classes that appear on the problems of a subject (cross-listings included), with counts. */
export async function mscCounts(subject: string) {
  return q<{ code: string; name: string; n: number }>(`
    SELECT s.code, s.name, count(*)::int AS n
    FROM problems p CROSS JOIN LATERAL unnest(p.subjects) AS m(code) JOIN subjects s ON s.code = m.code
    WHERE $1 = ANY(p.subjects) AND m.code LIKE 'msc:%' AND p.status = ANY($2) AND p.variant_of IS NULL AND ${NOT_DEMO}
    GROUP BY s.code, s.name ORDER BY n DESC`, [subject, RESEARCH]);
}

export type ListFilter = { subject?: string; status?: string; collection?: string; q?: string; sort?: string; page?: number; variants?: boolean };

export const STATUS_FILTERS: Record<string, { label: string; help: string }> = {
  research: { label: "research", help: "open problems and known results (no textbook exercises or sanity tests)" },
  open: { label: "open", help: "no accepted solution in the literature" },
  solved: { label: "known results", help: "solved in the literature; the formal proof may still be missing" },
  proved: { label: "proved here", help: "a verified formal proof or disproof exists on nosorry" },
  unsolved: { label: "not yet proved here", help: "no verified formal proof on nosorry yet" },
  informal: { label: "awaiting formalization", help: "stated in words only: submit a Lean statement to make it provable" },
  textbook: { label: "textbook", help: "standard results, good for practice" },
  test: { label: "sanity tests", help: "small checks that the formal definitions behave as intended" },
  all: { label: "all", help: "everything, including API lemmas" },
};

export async function listProblems(f: ListFilter) {
  const where: string[] = [], args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  if (f.subject && (f.subject.includes(".") || f.subject.startsWith("msc:"))) add("? = ANY(p.subjects)", f.subject);
  else if (f.subject) add("p.field = ?", f.subject);
  const st = f.status ?? "research";
  if (st === "research") add("p.status = ANY(?)", RESEARCH);
  else if (st === "proved") where.push("p.solved_on_platform");
  else if (st === "unsolved") { add("p.status = ANY(?)", RESEARCH); where.push("NOT p.solved_on_platform"); }
  else if (st === "informal") where.push("p.formalization = 'informal'");
  else if (st !== "all") add("p.status = ?", st);
  if (st !== "test" && st !== "all") where.push(NOT_DEMO);
  where.push("p.status <> 'lemma'");
  if (f.collection) add("p.collection = ?", f.collection);
  if (!f.variants && !f.q) where.push("p.variant_of IS NULL");
  let rank = "p.id";
  let nWhere = args.length;
  if (f.q) {
    // Accent-insensitive, every word must appear (in title, slug, identifier, Lean declaration name or statement).
    const tokens = f.q.toLowerCase().split(/[\s,;]+/).filter(Boolean).slice(0, 8);
    for (const t of tokens) add("p.search_text LIKE '%' || ns_fold(?) || '%'", t);
    nWhere = args.length;
    args.push(f.q);
    const i = args.length;
    rank = `(CASE WHEN ns_fold(p.title) LIKE '%' || ns_fold($${i}) || '%' THEN 0 ELSE 1 END), p.variant_of IS NOT NULL, length(p.title), p.id`;
  }
  const order = f.sort === "recent" ? "p.updated_at DESC, p.id DESC"
    : f.sort === "activity" ? "n_threads DESC, n_proofs DESC NULLS LAST, p.id"
    : f.sort === "easy" ? "length(coalesce(p.statement_md, p.title)), p.id"
    : f.q ? rank : "p.collection, length(p.slug), p.slug";
  const page = Math.max(1, Math.min(10_000, Math.trunc(Number(f.page)) || 1));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await q<ProblemRow>(`
    SELECT p.id, p.ident, p.slug, p.title, left(p.statement_md, 1200) AS statement_md, p.status, p.statement_status, p.primary_subject,
           p.subjects, p.tags, p.collection, p.solved_on_platform, p.resolution, p.variant_of, p.updated_at, p.formalization,
           (SELECT count(*)::int FROM submissions s WHERE s.problem_id=p.id AND s.status IN ('verified','partial')) AS n_proofs,
           (SELECT count(*)::int FROM research_threads t WHERE t.problem_id=p.id AND t.status='active') AS n_threads
    FROM problems p ${w} ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`, args);
  const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM problems p ${w}`, args.slice(0, nWhere));
  return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE, page, total: total?.n ?? 0 };
}

export async function collectionCounts(subject?: string) {
  const args: unknown[] = [RESEARCH];
  let w = `p.status = ANY($1) AND p.variant_of IS NULL AND ${NOT_DEMO}`;
  if (subject?.includes(".") || subject?.startsWith("msc:")) { args.push(subject); w += " AND $2 = ANY(p.subjects)"; }
  return q<{ slug: string; name: string; n: number }>(
    `SELECT c.slug, c.name, count(p.id)::int AS n FROM collections c JOIN problems p ON p.collection=c.slug WHERE ${w}
     GROUP BY c.slug, c.name ORDER BY n DESC`, args);
}

export async function siteStats() {
  return one<{
    problems: number; open: number; statements: number; proved_here: number; open_proved_here: number; verified: number; partial: number;
    contributors: number; findings: number; agents: number; last_verified: string | null; checks_24h: number;
  }>(`
    SELECT (SELECT count(*)::int FROM problems p WHERE status = ANY('{open,solved}') AND variant_of IS NULL AND ${NOT_DEMO}) AS problems,
           (SELECT count(*)::int FROM problems p WHERE status='open' AND variant_of IS NULL AND ${NOT_DEMO}) AS open,
           (SELECT count(*)::int FROM problems p WHERE ${NOT_DEMO} AND p.status <> 'lemma') AS statements,
           (SELECT count(*)::int FROM problems p WHERE solved_on_platform AND ${NOT_DEMO} AND p.status <> 'lemma') AS proved_here,
           (SELECT count(*)::int FROM problems p WHERE solved_on_platform AND status='open' AND ${NOT_DEMO}) AS open_proved_here,
           (SELECT count(*)::int FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE s.status='verified' AND ${NOT_DEMO}) AS verified,
           (SELECT count(*)::int FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE s.status='partial' AND ${NOT_DEMO}) AS partial,
           (SELECT count(DISTINCT user_id)::int FROM submissions WHERE status IN ('verified','partial','accepted')) AS contributors,
           (SELECT count(*)::int FROM critiques WHERE status='accepted') AS findings,
           (SELECT count(DISTINCT coalesce(nullif(agent_model,''), agent_name))::int FROM submissions WHERE agent_name IS NOT NULL AND agent_name <> 'human') AS agents,
           (SELECT max(verified_at) FROM submissions WHERE status='verified') AS last_verified,
           (SELECT count(*)::int FROM verification_runs WHERE started_at > now() - interval '1 day') AS checks_24h`);
}

/** Problems worth attacking: open, reviewed statement, not yet proved here. */
export async function featuredProblems(kind: "short" | "partial" | "famous" | "known", limit = 6) {
  const base = `p.variant_of IS NULL AND ${NOT_DEMO} AND NOT p.solved_on_platform AND p.statement_status IN ('reviewed','frozen') AND p.statement_md IS NOT NULL AND p.statement_md !~* '^\\s*is \\W?[A-Za-z0-9_.]+\\W? true\\?\\s*$'`;
  const sql = {
    // Short statements are a decent proxy for "approachable".
    short: `${base} AND p.status='open' ORDER BY length(p.statement_md), p.id`,
    // Someone already reduced them to lemmas.
    partial: `${base} AND EXISTS (SELECT 1 FROM submissions s WHERE s.problem_id=p.id AND s.status='partial') ORDER BY p.updated_at DESC`,
    // Well-known collections.
    famous: `${base} AND p.status='open' AND p.collection IN ('millennium','hilbert','green') ORDER BY p.collection, p.id`,
    // Solved in the literature, still missing a formal proof: real value, lower risk.
    known: `${base} AND p.status='solved' AND p.collection='erdos' ORDER BY length(p.statement_md), p.id`,
  }[kind];
  return q<ProblemRow>(`
    SELECT p.id, p.ident, p.slug, p.title, left(p.statement_md, 600) AS statement_md, p.status, p.statement_status, p.primary_subject,
           p.subjects, p.tags, p.collection, p.solved_on_platform, p.resolution, p.variant_of, p.updated_at, p.source_url,
           (SELECT count(*)::int FROM submissions s WHERE s.problem_id=p.id AND s.status='partial') AS n_partial
    FROM problems p WHERE ${sql} LIMIT ${limit}`);
}

export type SubmissionRow = {
  id: number; public_id: string; kind: string; status: string; title: string | null; handle: string; agent_name: string | null;
  agent_model: string | null; created_at: string; verified_at: string | null; problem_slug: string | null; problem_title: string | null;
  problem_ident: string | null; open_lemmas: string[] | null; visibility: string; statement_version: number | null;
};

/**
 * Submissions for listings. `open_lemmas` is only returned for published submissions (or the viewer's own, via userId),
 * because the structure of a sealed partial proof is part of its content.
 */
export async function recentSubmissions(opts: { problemId?: number; userId?: number; limit?: number; publicOnly?: boolean; statuses?: string[]; excludeDemo?: boolean }) {
  const where = ["1=1"], args: unknown[] = [];
  if (opts.problemId) { args.push(opts.problemId); where.push(`s.problem_id=$${args.length}`); }
  if (opts.userId) { args.push(opts.userId); where.push(`s.user_id=$${args.length}`); }
  if (opts.publicOnly !== false) where.push("s.status IN ('verified','partial','accepted','needs_review','revoked','superseded')");
  if (opts.statuses) { args.push(opts.statuses); where.push(`s.status = ANY($${args.length})`); }
  if (opts.excludeDemo) where.push("(p.id IS NULL OR NOT ('demo' = ANY(p.tags)))");
  const own = opts.publicOnly === false;
  return q<SubmissionRow>(`
    SELECT s.id, s.public_id, s.kind, s.status, s.title, u.handle, s.agent_name, s.agent_model, s.created_at, s.verified_at,
           p.slug AS problem_slug, p.title AS problem_title, p.ident AS problem_ident,
           CASE WHEN s.visibility='public' OR ${own ? "true" : "false"} THEN s.open_lemmas END AS open_lemmas,
           s.visibility, v.version AS statement_version
    FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN problems p ON p.id=s.problem_id
    LEFT JOIN problem_versions v ON v.id = s.problem_version_id
    WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC LIMIT ${Math.min(500, opts.limit ?? 50)}`, args);
}

export async function topContributors(limit = 5) {
  return q<{ handle: string; points: number; proofs: number }>(
    "SELECT handle, points, proofs FROM leaderboard WHERE points > 0 ORDER BY points DESC, proofs DESC LIMIT $1", [limit]);
}

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

export const fmtDate = (d: string | Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (d: string | Date | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "—";
export const fmtAgo = (d: string | Date | null) => {
  if (!d) return "never";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
