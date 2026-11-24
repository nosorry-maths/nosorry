import Link from "next/link";
import { q } from "@/lib/db";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const by = (await searchParams).by === "agent" ? "agent" : "people";
  const people = by === "people"
    ? await q<{ handle: string; points: number; proofs: number; open_solved: number }>(
        "SELECT handle, points, proofs, open_solved FROM leaderboard WHERE points <> 0 OR proofs > 0 ORDER BY points DESC, proofs DESC LIMIT 200")
    : [];
  const agents = by === "agent"
    ? await q<{ agent: string; proofs: number; open_solved: number; partial: number; people: number }>(`
        SELECT COALESCE(NULLIF(s.agent_model,''), s.agent_name, 'undeclared') AS agent,
          count(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified')::int AS proofs,
          count(DISTINCT s.problem_id) FILTER (WHERE s.kind='proof' AND s.status='verified' AND p.status='open')::int AS open_solved,
          count(*) FILTER (WHERE s.status='partial')::int AS partial,
          count(DISTINCT s.user_id)::int AS people
        FROM submissions s JOIN problems p ON p.id=s.problem_id
        WHERE s.status IN ('verified','partial') GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 100`)
    : [];
  return (
    <>
      <h1>Leaderboard</h1>
      <p className="muted">
        Points come from an append-only ledger. Corrections — a wrong statement, cheating, plagiarism — are recorded as reversing
        entries, never silent edits. <Link href="/docs/scoring">Scoring policy</Link>.
      </p>
      <div className="optbar">
        <span className="grp">View:{" "}
          {by === "people" ? <b aria-current="true">People </b> : <Link href="/leaderboard">People </Link>}
          {by === "agent" ? <b aria-current="true">Agents &amp; models</b> : <Link href="/leaderboard?by=agent">Agents &amp; models</Link>}
        </span>
      </div>
      {by === "people" ? (
        <table className="t" style={{ maxWidth: 820 }}>
          <thead><tr><th>#</th><th>Contributor</th><th className="num">Open problems solved</th><th className="num">Problems proved</th><th className="num">Points</th></tr></thead>
          <tbody>
            {people.map((r, i) => (
              <tr key={r.handle}><td className="num">{i + 1}</td><td><Link href={`/u/${r.handle}`}>{r.handle}</Link></td>
                <td className="num">{r.open_solved}</td><td className="num">{r.proofs}</td><td className="num"><b>{r.points}</b></td></tr>
            ))}
            {!people.length && <tr><td colSpan={5} className="muted">No points awarded yet.</td></tr>}
          </tbody>
        </table>
      ) : (
        <>
          <p className="small muted">Agent and model are declared by the submitter. Counts are distinct problems.</p>
          <table className="t" style={{ maxWidth: 820 }}>
            <thead><tr><th>Agent / model</th><th className="num">Open solved</th><th className="num">Problems proved</th><th className="num">Partial proofs</th><th className="num">People</th></tr></thead>
            <tbody>
              {agents.map((r) => (
                <tr key={r.agent}><td className="mono">{r.agent}</td><td className="num">{r.open_solved}</td><td className="num">{r.proofs}</td>
                  <td className="num">{r.partial}</td><td className="num">{r.people}</td></tr>
              ))}
              {!agents.length && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
