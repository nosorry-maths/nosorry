import Link from "next/link";
import { q } from "@/lib/db";
import { queueStats } from "@/lib/submissions";
import { fmtDateTime } from "@/lib/data";
import { Status } from "@/components/ui";

export const metadata = { title: "Verification pipeline" };
export const dynamic = "force-dynamic";

const STAGES = [
  "preflight — static rules on the source",
  "originality — identical earlier submissions",
  "compile reference statement — cached per statement version",
  "compile submission — network-less sandbox, time and memory limits",
  "statement & axioms — reference and proof loaded in separate processes, exact type match",
  "kernel replay — leanchecker re-checks every declaration",
  "comparator — independent final check (when configured)",
  "verdict & ledger",
];

export default async function Page() {
  const [st, jobs, workers] = await Promise.all([
    queueStats(),
    q<{ id: number; kind: string; state: string; priority: number; attempts: number; created_at: string; public_id: string; sub_status: string }>(
      `SELECT j.id, j.kind, j.state, j.priority, j.attempts, j.created_at, s.public_id, s.status AS sub_status
       FROM jobs j JOIN submissions s ON s.id=j.submission_id
       ORDER BY CASE j.state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, j.id DESC LIMIT 40`),
    q<{ id: string; sandbox: string; heartbeat_at: string; current_job: number | null }>(
      "SELECT id, sandbox, heartbeat_at, current_job FROM workers WHERE heartbeat_at > now() - interval '60 seconds' ORDER BY started_at"),
  ]);
  return (
    <>
      <h1>Verification pipeline</h1>
      <p className="muted">Every submission goes through the same public pipeline. Jobs are processed by independent workers;
        each run is logged stage by stage on its submission page.</p>
      <p className="stats-line">
        <b>{st?.queued ?? 0}</b> queued · <b>{st?.running ?? 0}</b> running · <b>{st?.done_1h ?? 0}</b> checked in the last hour ·
        mean turnaround (24 h): <b>{st?.avg_wait_s != null ? `${st.avg_wait_s} s` : "—"}</b> ·{" "}
        <b>{workers.length}</b> worker{workers.length === 1 ? "" : "s"} online{workers.length === 0 && (st?.queued ?? 0) > 0 ? " — submissions wait until one comes back; timestamps are already recorded" : ""}
      </p>
      <details className="stages-details">
        <summary>How a submission is checked <span className="muted">· {STAGES.length} stages</span></summary>
        <ol className="pipeline">{STAGES.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="small"><Link href="/docs/verification">Full description of the pipeline →</Link></p>
      </details>
      <h2>Recent jobs</h2>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Job</th><th>Kind</th><th>State</th><th>Submission</th><th title="interactive submissions first, then bulk, new accounts and formalizations; re-checks after a statement correction jump ahead">Lane</th><th className="num">Attempts</th><th>Created</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}><td className="mono">#{j.id}</td><td>{j.kind}</td><td>{j.state}</td>
                <td><Link href={`/s/${j.public_id}`} className="mono">{j.public_id}</Link> <Status s={j.sub_status} /></td>
                <td>{j.kind === "reverify" ? "re-check" : j.priority <= 100 ? "interactive" : j.priority < 150 ? "new account" : "formalization"}</td><td className="num">{j.attempts}</td><td className="muted">{fmtDateTime(j.created_at)}</td></tr>
            ))}
            {!jobs.length && <tr><td colSpan={7} className="muted">The queue is empty.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
