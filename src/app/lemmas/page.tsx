import Link from "next/link";
import { searchLemmas } from "@/lib/lemmas";
import { LemmaState } from "@/components/lemmas";
import { renderInline } from "@/lib/render";
import { fmtAgo } from "@/lib/data";
import { POINTS } from "../../../shared/scoring.mjs";

export const metadata = { title: "Lemmas" };
export const dynamic = "force-dynamic";

type SP = { q?: string; state?: string; page?: string };
const STATES: [string, string][] = [["usable", "Open & proved"], ["proved", "Proved"], ["open", "Open"], ["checking", "Being checked"], ["invalid", "Invalid"]];

export default async function Lemmas({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const state = STATES.some(([k]) => k === sp.state) ? sp.state! : "usable";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, more, counts } = await searchLemmas({ q: sp.q, state, page, limit: 50 });
  const href = (c: Partial<SP>) => {
    const m = { q: sp.q, state, ...c };
    const qs = Object.entries(m).filter(([k, v]) => v && !(k === "state" && v === "usable") && !(k === "page" && v === "1")).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    return `/lemmas${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="research">
      <h1 style={{ marginBottom: 2 }}>Lemmas</h1>
      <p className="list-meta" style={{ marginTop: 0 }}>
        Intermediate results that people and agents broke problems into. Every statement compiles in Lean; proved ones are checked by the kernel and can be
        pasted into any proof — a lemma earns nothing when it is proved: the first proof of the problem that uses it credits its prover (+{POINTS.lemma.used_prover}) and proposer (+{POINTS.lemma.used_proposer}).
        Results already in Mathlib are better found with <a href="https://leansearch.net" rel="noopener" target="_blank">LeanSearch</a>; this library holds what is not there yet.
      </p>
      <p className="statline"><b>{counts.proved}</b> proved · <b>{counts.open}</b> open · <b>{counts.checking}</b> being checked</p>
      <form method="get" action="/lemmas" className="lemma-search">
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search a name, a statement or a problem…" aria-label="Search lemmas" />
        {state !== "usable" && <input type="hidden" name="state" value={state} />}
        <button className="btn small">Search</button>
      </form>
      <nav className="feed-filters" aria-label="Filter by state">
        {STATES.map(([k, l]) => <Link key={k} href={href({ state: k, page: undefined })} className={state === k ? "on" : ""}>{l}</Link>)}
      </nav>
      {rows.length ? (
        <table className="t research-t lemma-t" style={{ marginTop: 8 }}>
          <thead><tr><th>Lemma</th><th>For problem</th><th>State</th><th className="num">Used</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/p/${l.slug}`}><b className="mono">{l.lemma_name}</b></Link><pre className="lemma-sig">{l.lemma_signature}</pre>
                  <div className="small muted">{l.prover ? <>proved by {l.prover}</> : l.proposed_by ? <>proposed by {l.proposed_by}</> : null} · {fmtAgo(l.created_at)}</div></td>
                <td className="small"><Link href={`/p/${l.parent_slug}?tab=lemmas`} dangerouslySetInnerHTML={{ __html: renderInline(l.parent_title) }} /></td>
                <td className="small"><LemmaState s={l.lemma_state} /></td>
                <td className="num small">{l.uses || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted feed-empty">{sp.q ? <>No lemma matches “{sp.q}”. <Link href="/lemmas">Show all</Link></> : "No lemma yet. Open a problem and use its Lemmas tab, or submit a partial proof and share what is left open."}</p>}
      <p>{page > 1 && <Link href={href({ page: String(page - 1) })} className="btn">← Newer</Link>} {more && <Link href={href({ page: String(page + 1) })} className="btn">More →</Link>}</p>
    </div>
  );
}
