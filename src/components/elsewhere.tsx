import { renderInline } from "@/lib/render";
import type { AixivLink } from "@/lib/aixiv";

const STATUS: Record<string, string> = {
  resolved: "claimed solved",
  formalized: "formalized in Lean",
  progress: "partial progress",
  related: "related results only",
  conflicting: "conflicting claims",
  withdrawn: "claim withdrawn",
};
const KIND: Record<string, string> = {
  solves: "solves", disproves: "disproves", partial: "partial", formalizes: "Lean formalization", bound: "bound",
  conditional: "conditional", "new-proof": "new proof", computes: "computation", theorem: "theorem", survey: "survey",
};

/** What aiXiv records about this problem: claims, plainly labelled as not verified here. */
export function Elsewhere({ links, solvedHere, isVariant = false }: { links: AixivLink[]; solvedHere: boolean; isVariant?: boolean }) {
  const main = links[0];
  const label = STATUS[main.status ?? (main.settled ? "resolved" : "progress")] ?? main.status ?? "results";
  const results = links.flatMap((l) => l.results.map((r) => ({ ...r, problem: l.name }))).filter((r) => !r.withdrawn);
  return (
    <>
      <div className="abs-line elsewhere-line"><span className="descriptor">Elsewhere:</span>
        <span>{isVariant ? "the main problem, " : ""}on <a href={main.url} rel="noopener" target="_blank">aiXiv</a>: <b>{label}</b>
          {main.status_text ? <> — {main.status_text.replace(/\s*\d+ resolutions? on record\.?$/, "")}</> : null}
          {main.tracker?.status && <> · {main.tracker.url ? <a href={main.tracker.url} rel="noopener" target="_blank">{main.tracker.source ?? "tracker"}</a> : main.tracker.source}: {main.tracker.status}</>}
          {" "}<span className="muted small">{solvedHere ? "(a proof was also checked here)" : "(a claim recorded elsewhere, not verified on nosorry)"}</span>
          {links.length > 1 && <span className="muted small"> · {links.length} matching aiXiv entries</span>}
        </span>
      </div>
      {results.length > 0 && (
        <details className="elsewhere">
          <summary>{results.length} result{results.length > 1 ? "s" : ""} recorded on aiXiv{main.match === "name" ? <span className="muted small"> · matched by name: check it is the same problem</span> : null}</summary>
          <ol>
            {results.map((r, i) => (
              <li key={`${r.aixiv_id}-${i}`}>
                <span className="ek">{KIND[r.kind] ?? r.kind}</span>{" "}
                <span dangerouslySetInnerHTML={{ __html: renderInline(r.statement) }} />{" "}
                <span className="small">— <a href={r.url} rel="noopener" target="_blank" className="mono">aiXiv:{r.aixiv_id}</a>, {r.date}
                  {r.lean ? <> · <a href={r.lean} rel="noopener" target="_blank">Lean</a></> : null}
                  <span className="muted"> · {r.standing}</span></span>
              </li>
            ))}
          </ol>
          <p className="small muted">From <a href="https://aixiv.online" rel="noopener" target="_blank">aixiv.online</a>, an open archive of AI-assisted research, synced daily. A result there is the authors&apos; claim; here, only a proof checked by Lean against this statement counts — formalizing one of these is a fair way to solve it.</p>
        </details>
      )}
    </>
  );
}
