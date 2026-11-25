import Link from "next/link";
import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { recentSubmissions, fmtDate, fmtAgo } from "@/lib/data";
import { SubmissionTable, Status } from "@/components/ui";
import { recentThreads } from "@/lib/research";
import { ThreadList } from "@/components/research";
import { userActivity } from "@/lib/activity";
import { renderInline, renderExcerpt } from "@/lib/render";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  return { title: (await params).handle };
}

const TABS = ["submissions", "leads", "notes", "critiques", "threads"] as const;
const OUTCOME: Record<string, string> = { "dead-end": "dead end", abandoned: "abandoned", merged: "merged", record: "set a record" };

export default async function Page({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ tab?: string }> }) {
  const u = await one<{ id: number; handle: string; display_name: string | null; created_at: string; affiliation: string | null; points: number; prover_points: number; referee_points: number; agents: string[] | null }>(
    `SELECT u.id, u.handle, u.display_name, u.created_at, u.affiliation,
            COALESCE((SELECT sum(delta) FROM point_events WHERE user_id=u.id),0)::int AS points,
            COALESCE((SELECT sum(delta) FROM point_events WHERE user_id=u.id AND track='prover'),0)::int AS prover_points,
            COALESCE((SELECT sum(delta) FROM point_events WHERE user_id=u.id AND track='referee'),0)::int AS referee_points,
            (SELECT array_agg(DISTINCT a ORDER BY a) FROM (
               SELECT COALESCE(NULLIF(agent_model,''), agent_name) AS a FROM submissions WHERE user_id=u.id AND agent_name IS NOT NULL AND agent_name <> 'human'
               UNION SELECT agent FROM leads WHERE user_id=u.id AND agent IS NOT NULL) x WHERE a IS NOT NULL AND a NOT IN ('unknown','')) AS agents
     FROM users u WHERE u.handle=$1 AND u.banned_at IS NULL`, [(await params).handle]);
  if (!u) notFound();
  const [subs, threads, act] = await Promise.all([recentSubmissions({ userId: u.id, limit: 100 }), recentThreads(50, u.id), userActivity(u.id)]);
  const accepted = subs.filter((s) => s.status === "verified" || s.status === "partial").length;
  const deadEnds = act.notes.filter((n) => n.kind === "dead-end").length;
  const activeLeads = act.leads.filter((l) => l.status === "active").length;
  const counts: Record<(typeof TABS)[number], number> = { submissions: subs.length, leads: act.leads.length, notes: act.notes.length, critiques: act.critiques.length, threads: threads.length };
  const requested = (await searchParams).tab ?? "";
  // Default to the first tab that has something in it.
  const tab = (TABS as readonly string[]).includes(requested) ? requested : TABS.find((t) => counts[t] > 0) ?? "submissions";
  const label: Record<string, string> = { submissions: "Submissions", leads: "Leads", notes: "Ideas & dead ends", critiques: "Statement critiques", threads: "Repositories" };

  return (
    <>
      <div className="ident">contributor</div>
      <h1 style={{ marginBottom: 2 }}>{u.display_name ?? u.handle}</h1>
      <p className="muted sans small" style={{ marginTop: 0 }}>since {fmtDate(u.created_at)}{u.affiliation ? ` · ${u.affiliation}` : ""}
        {u.agents?.length ? <> · works with <span className="mono">{u.agents.join(", ")}</span></> : null}</p>

      <p className="statline">
        <b>{u.prover_points}</b> prover points · <b>{u.referee_points}</b> referee points · <b>{accepted}</b> accepted of <b>{subs.length}</b> submission{subs.length === 1 ? "" : "s"} ·{" "}
        <b>{activeLeads}</b> active lead{activeLeads === 1 ? "" : "s"} · <b>{deadEnds}</b> dead end{deadEnds === 1 ? "" : "s"} recorded ·{" "}
        <b>{act.critiques.length}</b> statement critique{act.critiques.length === 1 ? "" : "s"} · <Link href={`/research?who=${u.handle}`}>activity feed →</Link>
      </p>

      <nav className="tabs ws-tabs" aria-label="Activity">
        {TABS.map((t) => (
          <Link key={t} href={`/u/${u.handle}?tab=${t}`} className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined}>
            {label[t]}{counts[t] ? ` · ${counts[t]}` : ""}</Link>
        ))}
      </nav>

      {tab === "submissions" && (subs.length ? <SubmissionTable rows={subs} showSubmitter={false} /> : <p className="small muted">No submission yet.</p>)}

      {tab === "leads" && (act.leads.length ? (
        <table className="t research-t">
          <thead><tr><th>Approach</th><th>Problem</th><th>State</th><th className="num">Last sign</th></tr></thead>
          <tbody>
            {act.leads.map((l) => (
              <tr key={l.id}>
                <td>{l.status === "active" && <span className="dot on" aria-hidden />}{l.approach}{l.agent && <div className="muted mono small">{l.agent}</div>}</td>
                <td className="small"><Link href={`/p/${l.slug}?tab=board`} dangerouslySetInnerHTML={{ __html: renderInline(l.title) }} /></td>
                <td className="small">{l.status === "closed" ? (OUTCOME[l.outcome ?? ""] ?? "closed") : l.status === "stale" ? "paused" : "working"}</td>
                <td className="num small muted">{fmtAgo(l.last_beat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="small muted">No lead announced yet.</p>)}

      {tab === "notes" && (act.notes.length ? (
        <ul className="activity">
          {act.notes.map((n) => (
            <li key={n.id}><span className={`tag tag-${n.kind}`}>{n.kind.replace("-", " ")}</span>{" "}
              <span dangerouslySetInnerHTML={{ __html: renderExcerpt(n.body_md, 200) }} />{n.plus > 0 && <b className="small"> +{n.plus}</b>}
              {n.obstruction_md && <div className="small"><b>Blocked by:</b> <span dangerouslySetInnerHTML={{ __html: renderExcerpt(n.obstruction_md, 200) }} /></div>}
              <div className="muted"><Link href={`/p/${n.slug}?tab=board`} dangerouslySetInnerHTML={{ __html: renderInline(n.title) }} /> · {fmtAgo(n.created_at)}</div></li>
          ))}
        </ul>
      ) : <p className="small muted">No idea or dead end posted yet.</p>)}

      {tab === "critiques" && (act.critiques.length ? (
        <ul className="activity">
          {act.critiques.map((c) => (
            <li key={c.id}><Status s={c.status === "open" ? "needs_review" : c.status} /> <b>#{c.id} {c.kind.replace("_", " ")}</b>{" "}
              <span dangerouslySetInnerHTML={{ __html: renderExcerpt(c.body_md, 220) }} />
              {c.resolution_md && <div className="small"><i>Decision:</i> <span dangerouslySetInnerHTML={{ __html: renderExcerpt(c.resolution_md, 200) }} /></div>}
              <div className="muted"><Link href={`/p/${c.slug}?tab=statement#critique-${c.id}`} dangerouslySetInnerHTML={{ __html: renderInline(c.title) }} /> · {fmtAgo(c.created_at)}</div></li>
          ))}
        </ul>
      ) : <p className="small muted">No statement critique yet.</p>)}

      {tab === "threads" && (threads.length ? <ThreadList threads={threads} /> : <p className="small muted">No repository shared yet.</p>)}
    </>
  );
}
