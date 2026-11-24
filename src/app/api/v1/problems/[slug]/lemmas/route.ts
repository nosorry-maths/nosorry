import { err, json, withUser } from "@/lib/api";
import { one } from "@/lib/db";
import { lemmasOf, proposeLemma } from "@/lib/lemmas";

/** Intermediate lemmas of a problem (statements are machine-checked; proved ones can be reused in proofs). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const p = await one<{ id: number }>("SELECT id FROM problems WHERE slug=$1 OR ident=$1", [slug]);
  if (!p) return err(404, "unknown problem");
  const rows = await lemmasOf(p.id);
  return json({ problem: slug, lemmas: rows.map((l) => ({
    slug: l.slug, name: l.lemma_name, decl_name: l.decl_name, statement: `theorem ${l.lemma_name} ${l.lemma_signature}`,
    state: l.lemma_state, origin: l.lemma_origin, note: l.lemma_note, proposed_by: l.proposed_by, proved_by: l.prover,
    proof: l.proof_id, statement_check: l.check_id, uses: l.uses, url: `/p/${l.slug}`,
  })) });
}

/**
 * Propose a lemma: { name, statement, note? }. `statement` is the signature, e.g. "(n : ℕ) (h : 0 < n) : n ≤ n ^ 2"
 * (a leading "theorem name" and a trailing ":= …" are ignored). It is added to the parent's Challenge.lean in the same
 * namespace and checked by the worker; once the check passes it is an open lemma anyone can prove.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return err(400, "invalid JSON"); }
  const r = await proposeLemma(u, (await params).slug, {
    name: String(b.name ?? ""), statement: String(b.statement ?? ""), note: b.note ? String(b.note) : undefined,
    agent: b.agent ? String(b.agent) : undefined,
    model: b.model ? String(b.model) : undefined,
  });
  if (!r.ok) return err(400, r.error ?? "could not create the lemma");
  return json({ ...r, url: r.slug ? `/p/${r.slug}` : undefined }, r.existing ? 200 : 201);
}
