import Link from "next/link";
import type { LemmaRow } from "@/lib/lemmas";
import { fmtAgo } from "@/lib/data";
import { proposeLemmaAction } from "@/app/actions-research";
import { POINTS } from "../../shared/scoring.mjs";

const STATE: Record<LemmaRow["lemma_state"], [string, string]> = {
  proved: ["proved", "st-verified"], open: ["open", "st-open"], checking: ["checking statement", "st-queued"], invalid: ["invalid", "st-rejected"],
};

export function LemmaState({ s }: { s: LemmaRow["lemma_state"] }) {
  const [label, cls] = STATE[s];
  return <span className={`st ${cls}`}>{label}</span>;
}

/** Intermediate lemmas of a problem, and the form to propose one. */
export function LemmasView({ slug, lemmas, signedIn, canPropose }: { slug: string; lemmas: LemmaRow[]; signedIn: boolean; canPropose: boolean }) {
  return (
    <div className="lemmas">
      <p className="small muted" style={{ marginTop: 0 }}>
        Intermediate steps towards this problem. Statements are checked by Lean automatically — no review needed. A proved lemma can be
        pasted into any proof; it earns nothing when proved; the first proof of the problem that uses it gives its prover +{POINTS.lemma.used_prover} and its proposer +{POINTS.lemma.used_proposer}.{" "}
        <Link href="/docs/collaborate#lemmas">How lemmas work</Link> · <Link href="/lemmas">All lemmas</Link>
      </p>
      {lemmas.length ? (
        <table className="t research-t lemma-t">
          <thead><tr><th>Lemma</th><th>State</th><th>By</th><th className="num">Used</th></tr></thead>
          <tbody>
            {lemmas.map((l) => (
              <tr key={l.id} className={l.lemma_state === "invalid" ? "muted" : ""}>
                <td><Link href={`/p/${l.slug}`}><b className="mono">{l.lemma_name}</b></Link>
                  <pre className="lemma-sig">{l.lemma_signature}</pre>
                  {l.lemma_state === "invalid" && l.lemma_note && <div className="small">{l.lemma_note.slice(0, 300)}</div>}
                </td>
                <td className="small"><LemmaState s={l.lemma_state} /></td>
                <td className="small">
                  {l.prover ? <>proved by <Link href={`/u/${l.prover}`}>{l.prover}</Link></> : null}
                  {l.proposed_by && <div className="muted">{l.lemma_origin === "partial" ? "left open by" : "proposed by"} <Link href={`/u/${l.proposed_by}`}>{l.proposed_by}</Link> · {fmtAgo(l.created_at)}</div>}
                </td>
                <td className="num small">{l.uses || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="small muted">No lemma yet. Break the problem into steps: propose one below, or submit a partial proof and share what is left open.</p>}

      {canPropose && (signedIn ? (
        <details className="card" style={{ marginTop: 10 }}>
          <summary><b>Propose a lemma</b> <span className="small muted">— a step you think the proof needs</span></summary>
          <form action={proposeLemmaAction} style={{ marginTop: 6 }}>
            <input type="hidden" name="problem" value={slug} />
            <div className="field-row"><label htmlFor="lname">Lean name</label>
              <input id="lname" type="text" name="name" required maxLength={60} pattern="[A-Za-z_][A-Za-z0-9_']*" placeholder="two_mul_radius_le" className="mono" /></div>
            <div className="field-row"><label htmlFor="lstmt">Statement (binders and type, without the proof)</label>
              <textarea id="lstmt" name="statement" rows={3} required className="mono" placeholder="(G : SimpleGraph α) [G.LocallyFinite] (h : G.Connected) : 2 * G.radius ≤ G.indepNum" /></div>
            <div className="field-row"><label htmlFor="lnote">How it is a step of the proof (required)</label>
              <textarea id="lnote" name="note" rows={2} required minLength={25} maxLength={2000} placeholder="e.g. with it, the main bound follows by induction on n; a special case of the statement is a partial result, not a lemma" style={{ fontFamily: "var(--font)" }} /></div>
            <div className="hint">It is added to this problem&apos;s Challenge.lean, in the same namespace, so it can use every definition there. Lean checks it compiles before it is listed as open.</div>
            <button className="btn small primary">Propose</button>
          </form>
        </details>
      ) : <p className="small"><Link href={`/login?next=${encodeURIComponent(`/p/${slug}?tab=lemmas`)}`}>Sign in</Link> to propose a lemma.</p>)}
    </div>
  );
}
