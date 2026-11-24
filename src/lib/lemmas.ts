import "server-only";
import { q, one, tx } from "./db";
import { rateLimit } from "./ratelimit";
import { canSubmit, type User } from "./auth";
import { createLemma, parentRow, shareOpenLemmas, topLevelIndex } from "../../shared/lemmas.mjs";

export type LemmaRow = {
  id: number; slug: string; ident: string; lemma_name: string; lemma_signature: string; lemma_state: "checking" | "open" | "proved" | "invalid";
  lemma_origin: "proposed" | "partial"; lemma_note: string | null; decl_name: string | null; proposed_by: string | null;
  parent_slug: string; parent_title: string; created_at: string; uses: number; prover: string | null; proof_id: string | null;
  check_id: string | null; origin_id: string | null;
};

const SELECT = `
  SELECT l.id, l.slug, l.ident, l.lemma_name, l.lemma_signature, l.lemma_state, l.lemma_origin, l.lemma_note, v.decl_name,
         pu.handle AS proposed_by, par.slug AS parent_slug, par.title AS parent_title, l.created_at,
         (SELECT count(*)::int FROM lemma_uses u JOIN submissions us ON us.id=u.submission_id
            WHERE u.lemma_id=l.id AND us.status='verified') AS uses,
         (SELECT su.handle FROM submissions s JOIN users su ON su.id=s.user_id
            WHERE s.problem_id=l.id AND s.kind='proof' AND s.status='verified' ORDER BY s.created_at LIMIT 1) AS prover,
         (SELECT s.public_id FROM submissions s
            WHERE s.problem_id=l.id AND s.kind='proof' AND s.status='verified' ORDER BY s.created_at LIMIT 1) AS proof_id,
         (SELECT s.public_id FROM submissions s WHERE s.problem_id=l.id AND s.kind='formalization' ORDER BY s.id DESC LIMIT 1) AS check_id,
         (SELECT s.public_id FROM submissions s WHERE s.id=l.origin_submission_id) AS origin_id
  FROM problems l JOIN problems par ON par.id=l.parent_id
  LEFT JOIN problem_versions v ON v.id=l.current_version_id LEFT JOIN users pu ON pu.id=l.proposed_by`;

const ORDER = `ORDER BY CASE l.lemma_state WHEN 'proved' THEN 0 WHEN 'open' THEN 1 WHEN 'checking' THEN 2 ELSE 3 END,
  (SELECT count(*) FROM lemma_uses u WHERE u.lemma_id=l.id) DESC, l.created_at DESC`;

/** Lemmas of one problem (invalid ones last, still listed so their reason is visible). */
export async function lemmasOf(problemId: number) {
  // A rejected statement is listed (its reason helps) unless a valid lemma of the same name replaced it.
  return q<LemmaRow>(`${SELECT} WHERE l.parent_id=$1 AND l.status='lemma'
    AND NOT (l.lemma_state='invalid' AND EXISTS (SELECT 1 FROM problems t WHERE t.parent_id=l.parent_id AND t.status='lemma'
             AND t.lemma_name=l.lemma_name AND t.lemma_state<>'invalid')) ${ORDER} LIMIT 300`, [problemId]);
}

/** The lemma library: search by name, statement, note or parent problem. */
export async function searchLemmas(opts: { q?: string; state?: string; problem?: string; limit?: number; page?: number }) {
  const where = ["l.status='lemma'"], args: unknown[] = [];
  const st = opts.state ?? "usable";
  if (st === "usable") where.push("l.lemma_state IN ('open','proved')");
  else if (["open", "proved", "checking", "invalid"].includes(st)) { args.push(st); where.push(`l.lemma_state=$${args.length}`); }
  if (opts.problem) { args.push(opts.problem); where.push(`(par.slug=$${args.length} OR par.ident=$${args.length})`); }
  for (const t of (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
    args.push(t);
    where.push(`(l.search_text LIKE '%' || ns_fold($${args.length}) || '%' OR par.search_text LIKE '%' || ns_fold($${args.length}) || '%')`);
  }
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const rows = await q<LemmaRow>(`${SELECT} WHERE ${where.join(" AND ")} ${ORDER} LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`, args);
  const counts = await one<{ proved: number; open: number; checking: number }>(
    `SELECT count(*) FILTER (WHERE lemma_state='proved')::int AS proved, count(*) FILTER (WHERE lemma_state='open')::int AS open,
            count(*) FILTER (WHERE lemma_state='checking')::int AS checking FROM problems WHERE status='lemma'`);
  return { rows: rows.slice(0, limit), more: rows.length > limit, page, counts: counts ?? { proved: 0, open: 0, checking: 0 } };
}

export async function proposeLemma(user: User, parentRef: string, input: { name: string; statement: string; note?: string; agent?: string; model?: string }) {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false as const, error: blocked };
  if (!(await rateLimit(`lemma:${user.id}`, 30, 3600))) return { ok: false as const, error: "you proposed many lemmas this hour; please wait a little" };
  return tx(async (c) => {
    const parent = await parentRow(c, parentRef);
    if (!parent) return { ok: false as const, error: `unknown problem ${parentRef}` };
    const r = await createLemma(c, { parent, userId: user.id, name: String(input.name ?? "").trim(), statement: input.statement,
      note: input.note?.slice(0, 2000), origin: "proposed", agentName: (input.agent?.slice(0, 60) ?? null) as never,
      agentModel: (input.model?.slice(0, 80) ?? null) as never });
    return r as { ok: boolean; error?: string; existing?: boolean; lemma_id?: number; slug?: string; submission?: string; target?: string; signature?: string };
  });
}

/** Author-only: turn the open lemmas of an accepted partial proof into intermediate problems (statements only). */
export async function shareLemmasOf(user: User, publicId: string) {
  return tx(async (c) => {
    const { rows: [s] } = await c.query("SELECT * FROM submissions WHERE public_id=$1 FOR UPDATE", [publicId]);
    if (!s) return { ok: false as const, error: "unknown submission" };
    if (Number(s.user_id) !== Number(user.id)) return { ok: false as const, error: "only the author can share the open lemmas of a submission" };
    if (s.status !== "partial") return { ok: false as const, error: "only an accepted partial proof has open lemmas to share" };
    await c.query("UPDATE submissions SET share_lemmas=true WHERE id=$1", [s.id]);
    const shared = await shareOpenLemmas(c, s, s.agent_name);
    return { ok: true as const, lemmas: shared.map((x: { name: string; ok: boolean; slug?: string; error?: string; existing?: boolean }) =>
      ({ name: x.name, ok: x.ok, slug: x.slug, existing: x.existing ?? false, error: x.error })) };
  });
}

/**
 * What to paste to reuse a proved lemma: its declaration taken from the first verified proof (lemma proofs are public).
 * Best effort — helper declarations of that proof are not included; the full proof link is always given.
 */
export async function lemmaSnippet(lemmaId: number) {
  const r = await one<{ lean_source: string; lemma_name: string; public_id: string }>(
    `SELECT s.lean_source, l.lemma_name, s.public_id FROM submissions s JOIN problems l ON l.id=s.problem_id
     WHERE s.problem_id=$1 AND s.kind='proof' AND s.status='verified' ORDER BY s.created_at LIMIT 1`, [lemmaId]);
  if (!r?.lean_source) return null;
  const src = r.lean_source.split("\r").join("");
  const lines = src.split("\n");
  const isDecl = (l: string) => {
    const t = l.replace(/^@\[[^\]]*\]\s*/, "");
    for (const kw of ["theorem ", "lemma "]) {
      if (!t.startsWith(kw)) continue;
      const name = t.slice(kw.length).trim().split(/[\s(:{[⦃⟨]/)[0];
      if (name === r.lemma_name || name.endsWith("." + r.lemma_name)) return true;
    }
    return false;
  };
  const startsCommand = (l: string) =>
    /^(theorem|lemma|def|noncomputable|private|protected|instance|abbrev|example|namespace|section|open|end|@\[|\/--|--)/.test(l);
  const at = lines.findIndex(isDecl);
  let decl: string | null = null;
  if (at >= 0) {
    // Include a doc comment only when it ends on the line right above the declaration.
    let first = at;
    if (at > 0 && lines[at - 1].trimEnd().endsWith("-/")) {
      let k = at - 1;
      while (k >= 0 && !lines[k].trimStart().startsWith("/--")) k--;
      if (k >= 0) first = k;
    }
    let last = at + 1;
    while (last < lines.length && !startsCommand(lines[last])) last++;
    decl = lines.slice(first, last).join("\n").trimEnd();
  }
  return { submission: r.public_id, decl: decl && topLevelIndex(decl, ":=") >= 0 ? decl : null };
}
