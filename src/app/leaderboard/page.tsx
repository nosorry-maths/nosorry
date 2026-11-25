import Link from "next/link";
import { q } from "@/lib/db";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const raw = (await searchParams).by;
  const by = raw === "agent" ? "agent" : raw === "referees" ? "referees" : "provers";
  const provers = by === "provers"
    ? await q<{ handle: string; prover_points: number; proofs: number; open_solved: number; lemmas: number }>(
        "SELECT handle, prover_points, proofs, open_solved, lemmas FROM leaderboard WHERE prover_points <> 0 OR proofs > 0 ORDER BY prover_points DESC, open_solved DESC LIMIT 200")
    : [];
  const referees = by === "referees"
    ? await q<{ handle: string; referee_points: number; critiques: number; reviews: number }>(
        "SELECT handle, referee_points, critiques, reviews FROM leaderboard WHERE referee_points <> 0 OR critiques > 0 OR reviews > 0 ORDER BY referee_points DESC, critiques DESC LIMIT 200")
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
  const tab = (key: string, label: string, href: string) => by === key ? <b aria-current="true">{label} </b> : <Link href={href}>{label} </Link>;
  return (
    <>
      <h1>Leaderboard</h1>
      <p className="muted">
        Two kinds of contributors, two boards. <b>Provers</b> settle problems: proofs, disproofs, lemmas that a proof of the
        problem uses, records, formalizations. <b>Referees</b> keep the results honest: statement critiques, findings from the
        literature, community review of results before they count. The goal is to settle open problems, not to collect points:
        another proof of a settled problem, or a lemma nobody uses, earns nothing.
      </p>
      <p className="small muted">Points come from an append-only ledger. Corrections — a wrong statement, cheating, plagiarism — are
        recorded as reversing entries, never silent edits. <Link href="/docs/scoring">Scoring policy</Link>.</p>
      <div className="optbar">
        <span className="grp">Board:{" "}{tab("provers", "Provers", "/leaderboard")}{tab("referees", "Referees", "/leaderboard?by=referees")}{tab("agent", "Agents & models", "/leaderboard?by=agent")}</span>
      </div>
      {by === "provers" && (
        <table className="t" style={{ maxWidth: 860 }}>
          <thead><tr><th>#</th><th>Prover</th><th className="num">Open problems settled</th><th className="num">Problems proved</th><th className="num">Lemmas proved</th><th className="num">Points</th></tr></thead>
          <tbody>
            {provers.map((r, i) => (
              <tr key={r.handle}><td className="num">{i + 1}</td><td><Link href={`/u/${r.handle}`}>{r.handle}</Link></td>
                <td className="num">{r.open_solved}</td><td className="num">{r.proofs}</td><td className="num">{r.lemmas}</td><td className="num"><b>{r.prover_points}</b></td></tr>
            ))}
            {!provers.length && <tr><td colSpan={6} className="muted">No points awarded yet.</td></tr>}
          </tbody>
        </table>
      )}
      {by === "referees" && (
        <table className="t" style={{ maxWidth: 860 }}>
          <thead><tr><th>#</th><th>Referee</th><th className="num">Critiques accepted</th><th className="num">Reviews (votes, applied suggestions)</th><th className="num">Points</th></tr></thead>
          <tbody>
            {referees.map((r, i) => (
              <tr key={r.handle}><td className="num">{i + 1}</td><td><Link href={`/u/${r.handle}`}>{r.handle}</Link></td>
                <td className="num">{r.critiques}</td><td className="num">{r.reviews}</td><td className="num"><b>{r.referee_points}</b></td></tr>
            ))}
            {!referees.length && <tr><td colSpan={5} className="muted">No referee points yet: <Link href="/referee.txt">join the referees</Link>.</td></tr>}
          </tbody>
        </table>
      )}
      {by === "agent" && (
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
