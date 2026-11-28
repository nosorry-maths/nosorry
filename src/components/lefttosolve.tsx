import { fmtDate } from "@/lib/data";
import { LTS_BASE, ltsProblemUrl, type LtsState } from "@/lib/lefttosolve";

const STATE: Record<string, string> = {
  proved: "proved there", disproved: "disproved there", pending: "a proof is under review there", misstated: "its statement was reported misstated there",
};
const OUTCOME: Record<string, string> = {
  open: "open problem settled", known: "known result formalized", warmup: "exercise", step: "reduction step", pending: "under review", misstated: "statement misstated",
};

/** What Left to Solve (lefttosolve.com) records about this problem, with links to the pull requests. Not verified here. */
export function LeftToSolve({ lts, solvedHere }: { lts: LtsState; solvedHere: boolean }) {
  const m = lts.main;
  const others = lts.events.filter((e) => e !== m).slice(0, 25);
  return (
    <>
      <div className="abs-line elsewhere-line"><span className="descriptor">Left to Solve:</span>
        <span>
          {lts.state ? <b>{STATE[lts.state]}</b> : <>listed</>}
          {m && <> — <a href={m.pr_url} rel="noopener" target="_blank">pull request</a>{m.handle ? <> by {m.handle}</> : null}{m.model ? <span className="muted small"> ({m.model})</span> : null}{m.created_at ? <>, {fmtDate(m.created_at)}</> : null}</>}
          {lts.steps.total > 0 && <> · {lts.steps.solved}/{lts.steps.total} reduction steps solved</>}
          {lts.lts_id && <> · <a href={ltsProblemUrl(lts.lts_id)} rel="noopener" target="_blank">problem page</a></>}
          {" "}<span className="muted small">{solvedHere ? "(a proof was also checked here)" : "(checked by that site's CI against its own pinned statement, not on nosorry)"}</span>
        </span>
      </div>
      {others.length > 0 && (
        <details className="elsewhere">
          <summary>{lts.events.length} result{lts.events.length > 1 ? "s" : ""} recorded on Left to Solve</summary>
          <ol>
            {others.map((e) => (
              <li key={`${e.lts_id}-${e.pr_url}-${e.outcome}`}>
                <span className="ek">{OUTCOME[e.outcome] ?? e.outcome}{e.polarity === "disproof" ? " (disproof)" : ""}</span>{" "}
                <span className="mono small">{e.lts_id}</span>{" "}
                <span className="small">— <a href={e.pr_url} rel="noopener" target="_blank">PR</a>{e.handle ? <> by {e.handle}</> : null}{e.created_at ? <>, {fmtDate(e.created_at)}</> : null}</span>
              </li>
            ))}
          </ol>
          <p className="small muted">Mirrored every 10 minutes from <a href={LTS_BASE} rel="noopener" target="_blank">lefttosolve.com</a>. A proof merged there was
            checked by that site&apos;s CI against its pinned copy of the statement; on nosorry only a proof checked here counts. Re-submitting it here is a fair way to settle the problem.</p>
        </details>
      )}
    </>
  );
}
