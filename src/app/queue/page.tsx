import Link from "next/link";
import { queueSnapshot } from "@/lib/queue";
import { QueueTable } from "@/components/queuetable";

export const metadata = { title: "Verification pipeline" };
export const dynamic = "force-dynamic";

const STAGES = [
  "preflight — static rules on the source",
  "originality — identical earlier submissions",
  "compile reference statement — on GitHub Actions, in a sandbox without network",
  "compile submission — isolated account, time and memory limits",
  "statement & axioms — reference and proof loaded in separate processes, exact type match",
  "kernel replay — leanchecker re-checks every declaration",
  "comparator — independent final check (when configured)",
  "verdict & ledger",
];

export default async function Page() {
  const initial = await queueSnapshot();
  return (
    <>
      <h1>Verification pipeline</h1>
      <p className="muted">Every submission goes through the same public pipeline, in the order it arrived. Each run is logged stage by stage on
        its submission page; this page updates by itself.</p>
      <details className="stages-details">
        <summary>How a submission is checked <span className="muted">· {STAGES.length} stages</span></summary>
        <ol className="pipeline">{STAGES.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="small"><Link href="/docs/verification">Full description of the pipeline →</Link></p>
      </details>
      <h2>Recent jobs</h2>
      <QueueTable initial={JSON.parse(JSON.stringify(initial))} />
    </>
  );
}