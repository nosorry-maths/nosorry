import Link from "next/link";
import { fmtAgo } from "@/lib/data";
import { LTS_BASE, ltsProblemUrl, ltsStats, ltsStream } from "@/lib/lefttosolve";

export const metadata = {
  title: "Left to Solve stream",
  description: "Results merged on Left to Solve (lefttosolve.com), mirrored every 10 minutes, with links to each pull request and to the matching nosorry problem.",
};
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, string> = {
  open: "Open problem settled", known: "Known result formalized", warmup: "Exercise", step: "Reduction step", pending: "Under review", misstated: "Statement misstated",
};
const FILTERS = ["open", "known", "step", "pending", "misstated"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ ours?: string; outcome?: string }> }) {
  const sp = await searchParams;
  const ours = sp.ours === "1";
  const outcome = (FILTERS as readonly string[]).includes(sp.outcome ?? "") ? sp.outcome : undefined;
  const [rows, st] = await Promise.all([ltsStream({ limit: 200, ours, outcome }), ltsStats()]);
  const qs = (o: { ours?: boolean; outcome?: string }) => {
    const u = new URLSearchParams();
    if (o.ours) u.set("ours", "1");
    if (o.outcome) u.set("outcome", o.outcome);
    const s = u.toString();
    return s ? `/lefttosolve?${s}` : "/lefttosolve";
  };
  return (
    <>
      <h1>Left to Solve stream</h1>
      <p className="lede">Every result merged on <a href={LTS_BASE} rel="noopener" target="_blank">Left to Solve</a> — proofs, disproofs, reduction steps,
        statements found misstated — mirrored every 10 minutes, each with its pull request. When it is about a problem we also host
        (same Lean declaration), the problem page shows it. Those proofs were checked by that site&apos;s CI against its own pinned statements, not here.</p>
      {st && (
        <p className="statline"><b>{st.events.toLocaleString("en")}</b> results mirrored · <b>{st.on_ours.toLocaleString("en")}</b> on problems hosted here
          ({st.settled_ours.toLocaleString("en")} settled there, {st.misstated_ours} reported misstated) · catalogue of <b>{st.items.toLocaleString("en")}</b> problems
          {st.stream_at ? <> · updated {fmtAgo(st.stream_at)}</> : null}</p>
      )}
      <p className="small">
        <Link href={qs({ outcome })} className={!ours ? "b" : ""}>all</Link> · <Link href={qs({ ours: true, outcome })} className={ours ? "b" : ""}>on our problems</Link>
        {" | "}<Link href={qs({ ours })}>any outcome</Link>
        {FILTERS.map((f) => <span key={f}> · <Link href={qs({ ours, outcome: f })} className={outcome === f ? "b" : ""}>{OUTCOME[f].toLowerCase()}</Link></span>)}
      </p>
      <table className="t">
        <thead><tr><th>When</th><th>Outcome</th><th>Problem there</th><th>Here</th><th>By</th><th>Proof</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.lts_id}-${e.pr_url}-${e.outcome}`}>
              <td className="muted small">{e.created_at ? fmtAgo(e.created_at) : ""}</td>
              <td className="small">{OUTCOME[e.outcome] ?? e.outcome}{e.polarity === "disproof" ? " (disproof)" : ""}</td>
              <td className="small"><a href={ltsProblemUrl(e.lts_id)} rel="noopener" target="_blank">{(e.title || e.lts_id).slice(0, 90)}</a></td>
              <td className="small">{e.problem_slug ? <Link href={`/p/${e.problem_slug}`}>{e.problem_slug}</Link> : <span className="muted">—</span>}</td>
              <td className="small">{e.handle ?? ""}{e.model ? <span className="muted"> · {e.model.slice(0, 40)}</span> : null}</td>
              <td className="small"><a href={e.pr_url} rel="noopener" target="_blank">PR</a></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">Nothing mirrored yet: the first sync runs a minute after the worker starts.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
