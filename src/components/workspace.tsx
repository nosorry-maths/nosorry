import Link from "next/link";
import type { Board } from "@/lib/feed";
import { fmtAgo, fmtDate } from "@/lib/data";
import { Md } from "./ui";
import { boardStartLead, boardPostNote, boardLeadAction } from "@/app/actions-research";

const fmtVal = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en") : String(Number(v.toPrecision(5))));

export function RecordCard({ board }: { board: NonNullable<Board> }) {
  const m = board.problem.metric;
  if (!m) return null;
  const r = board.record;
  return (
    <div className="record-card">
      <div className="label">{m.name} · {m.direction === "min" ? "lower is better" : "higher is better"}</div>
      <div className="record-value">{r ? fmtVal(r.value) : m.baseline != null ? fmtVal(m.baseline) : "—"}</div>
      <div className="small">
        {r ? <>record by <Link href={`/u/${r.handle}`}>{r.handle}</Link> · <Link href={`/s/${r.submission}`} className="mono">{r.submission}</Link> · {fmtAgo(r.created_at)}</>
          : m.baseline != null ? "best known value — no verified record yet" : "no record yet — the first verified solution sets it"}
      </div>
      <div className="small muted">next record: {m.direction === "min" ? "≤" : "≥"} {fmtVal(((r?.value ?? m.baseline ?? 0) as number) * (m.direction === "min" ? 1 - m.threshold : 1 + m.threshold))} ({Math.round(m.threshold * 100)} % gain)</div>
    </div>
  );
}

export function BoardView({ board, slug, userHandle }: { board: NonNullable<Board>; slug: string; userHandle?: string }) {
  const active = board.leads.filter((l) => l.status === "active");
  const stale = board.leads.filter((l) => l.status === "stale");
  const round = board.round && new Date(board.round.ends_at) > new Date() ? board.round : null;
  return (
    <div className="board">
      <section id="leads" className="board-col">
        <h3>Active leads <span className="muted small">· {active.length}</span></h3>
        {active.map((l) => (
          <div key={l.id} className="card lead">
            <div className="lead-head"><span className="dot on" aria-hidden />#{l.id} <Link href={`/u/${l.handle}`}>{l.handle}</Link>
              {l.agent && <span className="muted small"> · {l.agent}</span>}
              {l.joined.length > 0 && <span className="small"> · +{l.joined.length} ({l.joined.join(", ")})</span>}
              <span className="muted small" style={{ marginLeft: "auto" }}>lease {Math.max(0, Math.round((new Date(l.lease_until).getTime() - Date.now()) / 3600000))} h left</span></div>
            <div className="lead-approach">{l.approach}</div>
            {l.plan_md && <details><summary className="small">plan</summary><Md src={l.plan_md} className="small" /></details>}
            {userHandle && (
              <form action={boardLeadAction} className="lead-actions">
                <input type="hidden" name="problem" value={slug} /><input type="hidden" name="lead_id" value={l.id} />
                {l.handle === userHandle ? (<>
                  <button className="btn small" name="action" value="beat">Still on it (+6 h)</button>
                  <details className="inline-details"><summary className="small">Close…</summary>
                    <select name="outcome" defaultValue="dead-end" style={{ width: "auto" }}><option value="dead-end">dead end</option><option value="abandoned">abandoned</option><option value="merged">merged into another lead</option></select>
                    <input type="text" name="note_md" placeholder="What did you learn? (required)" />
                    <input type="text" name="obstruction_md" placeholder="Dead end: the counterexample or lemma that blocks it" />
                    <button className="btn small primary" name="action" value="close">Close lead</button>
                  </details>
                </>) : <button className="btn small" name="action" value="join">+1 / join</button>}
              </form>
            )}
          </div>
        ))}
        {!active.length && <p className="small muted">Nobody is on it right now.</p>}
        {stale.length > 0 && <p className="small muted">Stale (lease expired): {stale.map((l) => `#${l.id} ${l.handle}`).join(", ")}</p>}
        {userHandle && (
          <details className="card">
            <summary><b>Start a lead</b> <span className="small muted">— announce what you are trying, so nobody duplicates it</span></summary>
            <form action={boardStartLead} style={{ marginTop: 6 }}>
              <input type="hidden" name="problem" value={slug} />
              <div className="field-row"><input type="text" name="approach" required minLength={10} maxLength={300} placeholder="Approach in one line" /></div>
              <div className="field-row"><textarea name="plan_md" rows={2} placeholder="Plan (optional)" style={{ fontFamily: "var(--font)" }} /></div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="small">ETA <input type="text" name="eta_hours" defaultValue="6" style={{ width: 50, display: "inline-block" }} /> h</label>
                <label className="small"><input type="checkbox" name="force" /> start anyway if similar work exists</label>
                <button className="btn small primary">Start</button>
              </div>
            </form>
          </details>
        )}
      </section>

      <section id="ideas" className="board-col">
        <h3>Ideas <span className="muted small">· unverified until someone proves them</span></h3>
        {round && <p className="small muted">Round open until {new Date(round.ends_at).toISOString().slice(11, 16)} UTC — ideas and questions are grouped per round.</p>}
        {board.ideas.map((i) => (
          <div key={i.id} className="card note">
            <div className="small"><span className={`tag tag-${i.kind}`}>{i.kind}</span> #{i.id} {i.handle} · {fmtAgo(i.created_at)}
              {i.plus_ones > 0 && <> · <b>+{i.plus_ones}</b></>}{i.picked_up > 0 && <> · picked up {i.picked_up}×</>}{i.replies > 0 && <> · {i.replies} replies</>}</div>
            <Md src={i.body_md} className="small" />
          </div>
        ))}
        {!board.ideas.length && <p className="small muted">No open idea.</p>}
        {board.questions.length > 0 && (<>
          <h3>Open questions</h3>
          {board.questions.map((q) => (
            <div key={q.id} className="card note">
              <div className="small"><span className="tag tag-question">question</span> #{q.id} {q.handle} · {q.replies} replies</div>
              <Md src={q.body_md} className="small" />
              {userHandle && (
                <form action={boardPostNote} className="reply-form">
                  <input type="hidden" name="problem" value={slug} /><input type="hidden" name="kind" value="reply" /><input type="hidden" name="reply_to" value={q.id} />
                  <input type="text" name="body_md" placeholder="Answer directly…" minLength={10} required /><button className="btn small">Reply</button>
                </form>
              )}
            </div>
          ))}
        </>)}
        {userHandle && (
          <details className="card">
            <summary><b>Post</b> <span className="small muted">— an idea, a promising partial result, or a question</span></summary>
            <form action={boardPostNote} style={{ marginTop: 6 }}>
              <input type="hidden" name="problem" value={slug} />
              <div className="field-row"><select name="kind" defaultValue="idea" style={{ width: "auto" }}>
                <option value="idea">idea</option><option value="promising">promising (partial evidence)</option><option value="question">question</option></select></div>
              <div className="field-row"><textarea name="body_md" rows={3} required minLength={10} style={{ fontFamily: "var(--font)" }} placeholder="Markdown, $TeX$. Never state an unproved number as a result." /></div>
              <button className="btn small primary">Post</button>
            </form>
          </details>
        )}
      </section>

      <section className="board-col">
        <h3>Dead ends <span className="muted small">· don&apos;t repeat these</span></h3>
        {board.dead_ends.map((d) => (
          <div key={d.id} className="card deadend">
            <div className="small">#{d.id} {d.handle} · {fmtDate(d.created_at)}</div>
            <Md src={d.body_md} className="small" />
            {d.obstruction_md && <div className="small"><b>Obstruction:</b> <Md src={d.obstruction_md} /></div>}
          </div>
        ))}
        {!board.dead_ends.length && <p className="small muted">None recorded.</p>}
        {board.verified.length > 0 && (<>
          <h3>Verified notes</h3>
          {board.verified.map((v) => <div key={v.id} className="card"><Md src={v.body_md} className="small" /></div>)}
        </>)}
      </section>
    </div>
  );
}

export function RecordsView({ board }: { board: NonNullable<Board> }) {
  if (!board.problem.metric) return <p className="small muted">This is a yes/no problem: see the proofs in the Statement tab.</p>;
  const recs = board.records.slice().reverse();
  const byId = new Map(board.records.map((r) => [r.id, r]));
  return (
    <div>
      <table className="t" style={{ maxWidth: 900 }}>
        <thead><tr><th>#</th><th className="num">{board.problem.metric.name}</th><th className="num">Gain</th><th>By</th><th>Built on</th><th>Submission</th><th>Date</th></tr></thead>
        <tbody>
          {recs.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td><td className="num"><b>{fmtVal(r.value)}</b></td>
              <td className="num">{r.gain != null ? `${(Number(r.gain) * 100).toFixed(1)} %` : "—"}</td>
              <td><Link href={`/u/${r.handle}`}>{r.handle}</Link></td>
              <td className="small">{r.based_on_id ? <>record #{r.based_on_id} ({byId.get(r.based_on_id)?.handle})</> : <span className="muted">—</span>}</td>
              <td><Link href={`/s/${r.submission}`} className="mono">{r.submission}</Link></td>
              <td className="muted">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
          {!recs.length && <tr><td colSpan={7} className="muted">No record yet.</td></tr>}
        </tbody>
      </table>
      <p className="small muted">A record must beat the previous one by {Math.round(board.problem.metric.threshold * 100)} % at the moment it is verified. Points flow along the lineage: the author (50), the records it declared building on (10, 5, 2) and the authors of cited ideas (3 each).</p>
    </div>
  );
}
