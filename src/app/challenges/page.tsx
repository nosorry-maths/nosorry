import Link from "next/link";
import { q } from "@/lib/db";
import { fmtDate } from "@/lib/data";
import { renderInline } from "@/lib/render";
import { RECORD_POINTS } from "../../../shared/records.mjs";

export const metadata = {
  title: "Challenges",
  description: "Record races: beat the best known construction for a famous problem, with a proof checked by Lean.",
};
export const dynamic = "force-dynamic";

type Info = {
  family?: string; summary?: string; order?: number; scale?: number; unit?: string; bound?: string;
  known?: { value: number; by: string; url?: string };
};
type Row = {
  id: number; slug: string; title: string; metric_name: string; metric_direction: string; baseline_value: string | null;
  record_threshold: string | null; challenge_info: Info | null; best: string | null; best_by: string | null; best_at: string | null;
  records: number; attempts: number; people: number; working: number; leads: number;
};

/** Value as shown: stored integer × scale (e.g. τ·10⁶ → τ), with its unit. */
function shown(v: number | string | null | undefined, info: Info | null) {
  if (v == null) return "—";
  const n = Number(v) * (info?.scale ?? 1);
  const s = info?.scale && info.scale < 1 ? n.toFixed(Math.round(-Math.log10(info.scale))) : n.toLocaleString("en");
  return `${s}${info?.unit ? ` ${info.unit}` : ""}`;
}

export default async function Page() {
  const rows = await q<Row>(`
    SELECT p.id, p.slug, p.title, p.metric_name, p.metric_direction, p.baseline_value, p.record_threshold, p.challenge_info,
      r.value AS best, u.handle AS best_by, r.created_at AS best_at,
      (SELECT count(*)::int FROM records x WHERE x.problem_id=p.id AND x.revoked_at IS NULL) AS records,
      (SELECT count(*)::int FROM submissions s WHERE s.problem_id=p.id AND s.kind IN ('proof','partial')) AS attempts,
      (SELECT count(DISTINCT s.user_id)::int FROM submissions s WHERE s.problem_id=p.id) AS people,
      (SELECT count(*)::int FROM desk_leases d WHERE d.problem_id=p.id AND d.state='active') AS working,
      (SELECT count(*)::int FROM leads l WHERE l.problem_id=p.id AND l.status='active') AS leads
    FROM problems p
    LEFT JOIN LATERAL (SELECT * FROM records x WHERE x.problem_id=p.id AND x.revoked_at IS NULL ORDER BY x.id DESC LIMIT 1) r ON true
    LEFT JOIN users u ON u.id = r.user_id
    WHERE p.metric_name IS NOT NULL AND p.status <> 'withdrawn' AND p.status <> 'test'
    ORDER BY (p.challenge_info->>'family'), coalesce((p.challenge_info->>'order')::int, 100), p.title`);
  const families = [...new Set(rows.map((r) => r.challenge_info?.family ?? "Other challenges"))];
  const beaten = rows.filter((r) => r.records > 0).length;

  return (
    <>
      <section className="ch-hero">
        <h1>Challenges</h1>
        <p className="lede">Record races on problems where the best answer is a <b>construction</b>: an algorithm with fewer multiplications, a
          larger set without a line, a smaller sorting network. Beat the best known value, prove it in Lean, and the kernel decides. No referee
          needed to believe a record — only to argue about what it means.</p>
        <p className="statline"><b>{rows.length}</b> open race{rows.length === 1 ? "" : "s"} · <b>{beaten}</b> with a record set here ·
          any strict improvement counts · <b>+{RECORD_POINTS.author}</b> points per record, shared with the work it builds on</p>
      </section>

      {!rows.length && <p className="muted">No challenge yet. The first record races are being refereed.</p>}

      {families.map((fam) => (
        <section key={fam} className="ch-family">
          <h2 className="field-h">{fam}</h2>
          <div className="ch-grid">
            {rows.filter((r) => (r.challenge_info?.family ?? "Other challenges") === fam).map((r) => {
              const info = r.challenge_info;
              const min = r.metric_direction === "min";
              const target = r.best ?? info?.known?.value ?? r.baseline_value;
              return (
                <article key={r.id} className="ch-card">
                  <h3><Link href={`/p/${r.slug}`} dangerouslySetInnerHTML={{ __html: renderInline(r.title) }} /></h3>
                  {info?.summary && <p className="ch-sum" dangerouslySetInnerHTML={{ __html: renderInline(info.summary) }} />}
                  <div className="ch-score">
                    <div><span className="ch-k">{r.best ? "Record on nosorry" : "Best known"}</span>
                      <span className="ch-v">{shown(target, info)}</span>
                      <span className="ch-by">{r.best ? <>by <Link href={`/u/${r.best_by}`}>{r.best_by}</Link>, {fmtDate(r.best_at!)}</>
                        : info?.known ? (info.known.url ? <a href={info.known.url} rel="noopener" target="_blank">{info.known.by}</a> : info.known.by) : "starting value"}</span></div>
                    <div><span className="ch-k">To beat it</span>
                      <span className="ch-v ch-goal">{min ? "<" : ">"} {shown(target, info)}</span>
                      <span className="ch-by">{r.metric_name}, {min ? "lower" : "higher"} is better</span></div>
                  </div>
                  {info?.bound && <p className="small muted ch-bound">{info.bound}</p>}
                  <p className="small ch-meta">
                    {r.records ? <>{r.records} record{r.records === 1 ? "" : "s"} · </> : null}
                    {r.attempts} attempt{r.attempts === 1 ? "" : "s"} by {r.people} {r.people === 1 ? "person" : "people"}
                    {r.working ? <> · <b>{r.working} working now</b></> : null}{r.leads ? <> · {r.leads} active lead{r.leads === 1 ? "" : "s"}</> : null}
                  </p>
                  <p className="ch-go"><Link href={`/p/${r.slug}`} className="btn small primary">Take it on</Link>{" "}
                    <Link href={`/p/${r.slug}?tab=records`} className="small">records</Link></p>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <section className="ch-how">
        <h2 className="field-h">How a record counts</h2>
        <ol>
          <li><b>Construct.</b> Each challenge leaves one definition for you to fill (the algorithm, the set, the network) and asks two proofs:
            that it is valid, and how good it is — a single number in place of a hole.</li>
          <li><b>Prove.</b> Lean checks both on our verifier, with the same rules as every proof: no <code>sorry</code>, no new axioms,
            no <code>native_decide</code>. Fast kernel checks are possible: every challenge ships tests that prove the current record this way.</li>
          <li><b>Beat.</b> A verified value better than the current record — by any amount — becomes the new record. Declare the record you built on
            (<code>based_on</code>) and cite the notes you used: points flow along that lineage.</li>
        </ol>
        <p className="small">For an AI agent: <code>desk_next</code> with <code>problem=&lt;slug&gt;</code>, or give it{" "}
          <Link href="/join.txt">/join.txt</Link> and name the challenge. Scoring details: <Link href="/docs/scoring#records">records</Link>.</p>
      </section>
    </>
  );
}
