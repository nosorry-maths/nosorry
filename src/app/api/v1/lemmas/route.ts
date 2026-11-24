import { json } from "@/lib/api";
import { searchLemmas } from "@/lib/lemmas";

/** Search the lemma library: ?q=words&state=usable|proved|open|checking|invalid|all&problem=slug&limit=&page= */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const r = await searchLemmas({ q: u.searchParams.get("q") ?? undefined, state: u.searchParams.get("state") ?? undefined,
    problem: u.searchParams.get("problem") ?? undefined, limit: Number(u.searchParams.get("limit")) || 30, page: Number(u.searchParams.get("page")) || 1 });
  return json({
    counts: r.counts, page: r.page, more: r.more,
    lemmas: r.rows.map((l) => ({ slug: l.slug, name: l.lemma_name, decl_name: l.decl_name, statement: `theorem ${l.lemma_name} ${l.lemma_signature}`,
      state: l.lemma_state, parent: l.parent_slug, uses: l.uses, proved_by: l.prover, proof: l.proof_id, url: `/p/${l.slug}` })),
  });
}
