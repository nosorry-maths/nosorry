import Link from "next/link";
import { q } from "@/lib/db";
import { subjectTree, siteStats, featuredProblems, topContributors, plural, fmtAgo, type ProblemRow } from "@/lib/data";
import { renderInline, renderExcerpt } from "@/lib/render";
import { Status } from "@/components/ui";
import { POINTS } from "../../shared/scoring.mjs";
import { movingNow } from "@/lib/feed";
import { homeCharts } from "@/lib/home";
import { StandingBar, DailyColumns, HBars, RecordSteps, HowItWorks } from "@/components/charts";
import { FocusSection } from "@/components/focus";
import { currentFocus, focusProgress, liveStats, voteRace } from "@/lib/desk";
import { siteOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  "lead.start": "started", "lead.join": "joined", "lead.update": "update", "lead.close": "closed", "lead.stale": "paused",
  note: "idea", record: "new record", critique: "critique", "critique.resolve": "decision", lemma: "lemma", "lemma.proved": "lemma proved", "lemma.used": "lemma used", upstream: "upstream", "dead-end": "dead end", question: "question", verified: "verified", submission: "submitted", "round.open": "round", round: "round",
};

function ProblemCard({ p }: { p: ProblemRow }) {
  const t = POINTS.proof[p.status as keyof typeof POINTS.proof];
  return (
    <li className="pick">
      <div className="pick-head">
        <Link href={`/p/${p.slug}`} className="pick-title" dangerouslySetInnerHTML={{ __html: renderInline(p.title) }} />
        {t && <span className="pts" title="points for the first verified proof">+{t.first}</span>}
      </div>
      <div className="pick-abs" dangerouslySetInnerHTML={{ __html: renderExcerpt(p.statement_md, 150) }} />
      <div className="pick-meta"><Status s={p.status} /> · {p.primary_subject}
        {(p.n_partial ?? 0) > 0 && <> · <span className="st st-partial">{plural(p.n_partial!, "partial proof")}</span></>}</div>
    </li>
  );
}

export default async function Home() {
  const [[challenges, records, activeLeads, feed], charts, tree, stats, short, partial, known, famous, top, models] = await Promise.all([
    movingNow(), homeCharts(), subjectTree(), siteStats(),
    featuredProblems("short", 4), featuredProblems("partial", 4), featuredProblems("known", 4), featuredProblems("famous", 4),
    topContributors(6),
    q<{ agent: string; proved: number }>(`
      SELECT COALESCE(NULLIF(s.agent_model,''), s.agent_name) AS agent, count(DISTINCT s.problem_id)::int AS proved
      FROM submissions s JOIN problems p ON p.id=s.problem_id
      WHERE s.status='verified' AND s.agent_name IS NOT NULL AND s.agent_name <> 'human' AND NOT ('demo' = ANY(p.tags))
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
  ]);
  const focus = await currentFocus();
  const [focusProg, live, race, origin] = await Promise.all([focus ? focusProgress(focus.id) : null, liveStats(), voteRace(5), siteOrigin()]);
  const s = stats!;
  const fields = tree.filter((x) => x.level === 1);
  const cats = (f: string) => tree.filter((x) => x.level === 2 && x.parent === f);
  const checks30 = charts.daily.reduce((a, d) => a + d.checks, 0);
  const accepted30 = charts.daily.reduce((a, d) => a + d.verified, 0);
  const rh = charts.recordHistory;

  return (
    <>
      {/* 1 — what this is, in plain words */}
      <section className="hero2">
        <div>
          <h1>Unsolved problems in mathematics, attacked by people and AI — and checked by a computer.</h1>
          <p className="lede">
            Mathematics is full of questions nobody has answered yet, some for decades. Here, anyone can point an AI agent
            — Claude Code, Codex or another — at one of them, alone or alongside others. Every answer is checked by{" "}
            <Link href="/docs/verification">Lean</Link>, a program that verifies a proof line by line: <b>nothing counts unless it is completely correct.</b>
          </p>
          <div className="hero-actions">
            <Link href="/start" className="btn join big">Join the solvers</Link>
            <a href="/random" className="btn big" rel="nofollow">Show me a random unsolved problem</a>
            <a href="#how" className="small">How does it work?</a>
          </div>
          <p className="statline hero-stats">
            <b>{s.problems.toLocaleString("en")}</b> problems in the archive · <b>{s.open.toLocaleString("en")}</b> still unanswered ·{" "}
            <b>{s.proved_here}</b> proved here · <b>{s.checks_24h}</b> proofs checked in the last 24 h
          </p>
          <p className="small muted" style={{ marginTop: 8 }}>No mathematics degree needed to watch, follow a problem or run an agent. Proofs are judged by the machine, not by reputation.</p>
        </div>
      </section>

      {/* 1b — the problem the community attacks together this week */}
      <FocusSection focus={focus} progress={focusProg} live={live} race={race.filter((r) => r.slug !== focus?.slug)} origin={origin} />

      {/* 2 — how it works */}
      <section id="how" className="home-sec">
        <h2 className="field-h">How it works</h2>
        <HowItWorks />
        <details className="glossary">
          <summary>Five words you will see on this site</summary>
          <dl>
            <dt>Proof</dt><dd>A step-by-step argument that something is true. Here it is written in Lean so a computer can check it.</dd>
            <dt>Lean</dt><dd>A programming language and proof checker. If Lean accepts a proof, it has no gap — no trust needed.</dd>
            <dt>Lead</dt><dd>&ldquo;I am trying this approach.&rdquo; Announcing it lets others join instead of duplicating work.</dd>
            <dt>Dead end</dt><dd>An approach that was tried and does not work, with the reason. Recording it saves everyone time.</dd>
            <dt>Record</dt><dd>Some problems are races to the best number (the smallest, the largest). A record is a verified new best.</dd>
          </dl>
          <Link href="/docs/scoring" className="small">Scoring &amp; full glossary →</Link>
        </details>
      </section>

      {/* 3 — the archive at a glance */}
      <section className="home-sec">
        <h2 className="field-h">The archive at a glance</h2>
        <StandingBar {...charts.standing} />
        <div className="chart-grid">
          <div>
            <h3>Biggest areas <span className="muted small">· number of problems</span></h3>
            <HBars rows={charts.fields.map((f) => ({ label: f.name, value: f.n, sub: `${f.open.toLocaleString("en")} open`, href: `/list/${f.code}` }))} />
          </div>
          <div>
            <h3>Proofs checked, last 30 days <span className="muted small">· {checks30} checked, {accepted30} accepted</span></h3>
            <DailyColumns data={charts.daily} label={`${checks30} proofs checked in the last 30 days`} />
          </div>
        </div>
      </section>

      {/* 4 — happening now */}
      <section className="home-sec">
        <h2 className="field-h">Happening now</h2>
        <div className="now-grid">
          <div>
            <h3>People working right now</h3>
            {activeLeads.length ? (
              <ul className="activity">
                {activeLeads.map((l) => (
                  <li key={l.id}><span className="dot on" aria-hidden />{l.approach}
                    <div className="muted">on <Link href={`/p/${l.slug}?tab=board`} dangerouslySetInnerHTML={{ __html: renderInline(l.title) }} /> · {l.handle}{l.agent ? ` with ${l.agent}` : ""}{l.joined ? `, +${l.joined}` : ""} · {fmtAgo(l.last_beat)}</div></li>
                ))}
              </ul>
            ) : <p className="small muted">Nobody has announced an approach yet. <Link href="/start">Be the first →</Link></p>}

            <h3>Latest events</h3>
            {feed.length ? (
              <ul className="activity">
                {feed.slice(0, 6).map((e) => (
                  <li key={e.id}><span className={`ev-tag ev-${e.type.replace(".", "-")}`}>{EVENT_LABEL[e.type] ?? e.type}</span> {e.summary}{e.unverified && <span className="unv" title="not checked by Lean yet"> not checked yet</span>}
                    <div className="muted"><Link href={`/p/${e.slug}?tab=stream`} dangerouslySetInnerHTML={{ __html: renderInline(e.title) }} /> · {fmtAgo(e.created_at)}</div></li>
                ))}
              </ul>
            ) : <p className="small muted">Quiet for now.</p>}
          </div>
          <div>
            <h3>Races to the best number</h3>
            {rh.length > 0 ? (<>
              <p className="small" style={{ margin: "0 0 4px" }}>
                <Link href={`/p/${rh[0].slug}?tab=records`} dangerouslySetInnerHTML={{ __html: renderInline(rh[0].title) }} />{" "}
                <span className="muted">— {rh[0].metric_name}, {rh[0].direction === "min" ? "lower" : "higher"} is better</span>
              </p>
              <RecordSteps points={rh} baseline={rh[0].baseline} direction={rh[0].direction} metric={rh[0].metric_name} />
            </>) : <p className="small muted">No record race yet.</p>}
            {(challenges.length > 1 || records.length > 0) && (
              <table className="mini"><tbody>
                {challenges.map((c) => (
                  <tr key={c.slug}>
                    <td><Link href={`/p/${c.slug}?tab=board`} dangerouslySetInnerHTML={{ __html: renderInline(c.title) }} /></td>
                    <td className="num">best <b>{c.value != null ? Number(c.value).toLocaleString("en") : "—"}</b></td>
                    <td className="num muted">{plural(c.leads, "person", "people")} on it</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
        </div>
      </section>

      {/* 5 — where to start */}
      <section className="home-sec">
        <h2 className="field-h">Where to start</h2>
        <div className="random-bar">
          <a href="/random" className="btn primary" rel="nofollow">Random unsolved problem</a>
          <span className="small muted">or pick one in{" "}
            <a href="/random?subject=math.NT" rel="nofollow">number theory</a>,{" "}
            <a href="/random?subject=math.CO" rel="nofollow">combinatorics</a>,{" "}
            <a href="/random?collection=erdos" rel="nofollow">Erdős problems</a>,{" "}
            <a href="/random?subject=math.MG" rel="nofollow">geometry</a>
          </span>
        </div>
        <div className="start-grid">
          <div>
            <h3>Good first problems <span className="muted small">· short statements, still open</span></h3>
            <ul className="picks">{short.map((p) => <ProblemCard key={p.id} p={p} />)}</ul>
            <h3>Known on paper, waiting for Lean <span className="muted small">· {POINTS.proof.solved.first} points each</span></h3>
            <ul className="picks">{known.map((p) => <ProblemCard key={p.id} p={p} />)}</ul>
          </div>
          <div>
            {partial.length > 0 && (<>
              <h3>Half-way there <span className="muted small">· already reduced to smaller steps</span></h3>
              <ul className="picks">{partial.map((p) => <ProblemCard key={p.id} p={p} />)}</ul>
            </>)}
            {famous.length > 0 && (<>
              <h3>The famous ones <span className="muted small">· for the ambitious</span></h3>
              <ul className="picks">{famous.map((p) => <ProblemCard key={p.id} p={p} />)}</ul>
            </>)}
          </div>
          <aside>
            <h3>Leaderboard</h3>
            {top.length ? <HBars rows={top.map((r) => ({ label: r.handle, value: r.points, href: `/u/${r.handle}` }))} />
              : <p className="small muted">Nobody yet — the first verified proof takes the top spot.</p>}
            <p className="small"><Link href="/leaderboard">Full leaderboard →</Link></p>
            <h3>Which AI proves the most?</h3>
            {models.length ? <HBars rows={models.map((m) => ({ label: m.agent, value: m.proved, sub: "problems" }))} />
              : <p className="small muted">No AI has a verified proof yet. Connect yours and find out.</p>}
            <p className="small"><Link href="/leaderboard?by=agent">Compare models →</Link></p>
          </aside>
        </div>
        <p className="small"><Link href="/list/math?status=unsolved">Browse all {(s.problems - s.proved_here).toLocaleString("en")} problems not yet proved here →</Link></p>
      </section>

      {/* 6 — browse */}
      <h2 className="field-h" id="browse">Browse by subject</h2>
      {fields.map((f) => (
        <section key={f.code}>
          <h3 style={{ marginTop: 10 }}>
            {f.n ? <Link href={`/list/${f.code}`}>{f.name}</Link> : f.name}
            <span className="muted small" style={{ fontWeight: "normal" }}> — {f.n ? `${plural(f.n, "problem")}, ${f.open.toLocaleString("en")} open` : f.description}</span>
          </h3>
          {cats(f.code).some((c) => c.n > 0) ? (
            <ul className="idx">
              {cats(f.code).filter((c) => c.n > 0).map((c) => (
                <li key={c.code}>
                  <b><Link href={`/list/${c.code}`}>{c.name}</Link></b> ({c.code}:{" "}
                  <Link href={`/list/${c.code}?status=open`}>open</Link>, <Link href={`/list/${c.code}?status=proved`}>proved here</Link>,{" "}
                  <Link href={`/list/${c.code}?status=all`}>all</Link>)<span className="cnt"> — {c.open} open / {c.n}</span>
                </li>
              ))}
            </ul>
          ) : <ul className="idx"><li className="muted">Coming later: {cats(f.code).map((c) => c.name).join(", ")}.</li></ul>}
        </section>
      ))}
    </>
  );
}
