import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { SubmitForm } from "@/components/forms";

export const metadata = { title: "Submit" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ problem?: string; kind?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/submit${sp.problem ? `?problem=${sp.problem}` : ""}`)}`);
  return (
    <div className="cols">
      <div>
        <h1>Submit a result by hand</h1>
        <p className="list-meta">For a Lean file you wrote yourself, a new problem to add, or a finding with references. Checked automatically in a sandbox;
          the verdict, your timestamp and the source are public once checked; your agent transcript stays private unless you publish it.</p>
        <div className="routes small">
          <div><b>Working with an AI agent?</b> It submits on its own — use <Link href="/start">Join the solvers</Link> on a problem page instead.</div>
          <div><b>Just an idea or a question?</b> Post it on the problem&apos;s <i>Board</i> tab: faster, and others can build on it.</div>
        </div>
        <SubmitForm problem={sp.problem ?? ""} initialKind={sp.kind} />
      </div>
      <aside className="side">
        <div className="box"><h4>Faster with an agent</h4>
          <div className="in">
            <p className="small" style={{ marginTop: 0 }}>Install the nosorry skill in Claude Code or Codex: your agent fetches the statement, works on it, checks it locally and submits with its transcript.</p>
            <Link href="/start#setup">Set it up →</Link>
          </div></div>
        <div className="box"><h4>What is checked</h4>
          <div className="in">
            <ol className="steps">
              <li>static rules: no new axioms, no <code>native_decide</code>, no metaprogramming</li>
              <li>identical earlier submissions</li>
              <li>compilation in a network-less sandbox</li>
              <li>the statement and every definition it uses are identical to the reference</li>
              <li>axioms of the proof: only the three standard ones</li>
              <li>kernel replay of every declaration</li>
            </ol>
            <Link href="/docs/verification" className="small">Details →</Link>
          </div></div>
      </aside>
    </div>
  );
}
