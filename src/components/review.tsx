import Link from "next/link";
import { Md } from "@/components/ui";
import { fmtDateTime } from "@/lib/data";
import { lineDiff, type Comment, type Suggestion } from "@/lib/reviews";
import { reviewVoteAction, reviewCommentAction, reviewSuggestAction, reviewDecideSuggestionAction, reviewHideCommentAction } from "@/app/actions-review";

type Sub = { public_id: string; user_id: number; kind: string; status: string; reviewed_at: string | null; reviewer: string | null; source_repo: string | null };
type Props = {
  s: Sub; source: string | null; viewer: { id: number; mod: boolean } | null;
  score: { up: number; down: number; score: number; mine: number }; comments: Comment[]; suggestions: Suggestion[];
};

const who = (x: { handle: string; agent_name: string | null; agent_model: string | null }) =>
  <><Link href={`/u/${x.handle}`}>{x.handle}</Link>{x.agent_model || x.agent_name ? <span className="muted"> · {[x.agent_name, x.agent_model].filter(Boolean).join(" / ")}</span> : null}</>;

/** The community review of a result held for review: votes, discussion (optionally on a line), suggested changes. */
export function ReviewSection({ s, source, viewer, score, comments, suggestions }: Props) {
  const held = s.status === "needs_review";
  const own = viewer?.id === Number(s.user_id);
  const lines = source?.split("\n") ?? [];
  const top = comments.filter((c) => !c.reply_to), replies = (id: number) => comments.filter((c) => c.reply_to === id);
  const open = suggestions.filter((g) => g.status === "open").length;

  const CommentBox = ({ c, depth }: { c: Comment; depth: number }) => (
    <div id={`c${c.id}`} className="box" style={{ marginLeft: depth ? 24 : 0 }}><div className="in small">
      <div className="muted">{who(c)} · {fmtDateTime(c.created_at)}
        {c.line ? <> · on line {c.line}</> : null}
        {viewer?.mod && !c.hidden && (
          <form action={reviewHideCommentAction} style={{ display: "inline", marginLeft: 8 }}>
            <input type="hidden" name="id" value={s.public_id} /><input type="hidden" name="cid" value={c.id} />
            <button className="linkbtn">hide</button></form>)}
      </div>
      {c.line && lines[c.line - 1] != null && <pre style={{ margin: "4px 0" }}>{lines[c.line - 1]}</pre>}
      {c.hidden ? <p className="small muted" style={{ margin: 0 }}>(hidden by a moderator)</p> : <Md src={c.body_md} className="small" />}
      {held && viewer && depth === 0 && (
        <details className="small"><summary>Reply</summary>
          <form action={reviewCommentAction}>
            <input type="hidden" name="id" value={s.public_id} /><input type="hidden" name="reply_to" value={c.id} />
            <textarea name="body" rows={3} required style={{ fontFamily: "var(--font)", width: "100%" }} />
            <button className="btn small">Reply</button>
          </form>
        </details>)}
    </div>
    {replies(c.id).map((r) => <CommentBox key={r.id} c={r} depth={depth + 1} />)}
    </div>
  );

  return (
    <section id="review">
      <h2>Community review</h2>
      <p className="small">{held
        ? <>Lean accepts this {s.kind}. Because it would change the status of the problem, it counts — status, points — only once a moderator
            approves it, after the community has looked at it: vote, comment (on a line if you like), or suggest a change to the file.</>
        : s.status === "verified" ? <>Approved by {s.reviewer ?? "a moderator"}{s.reviewed_at ? `, ${fmtDateTime(s.reviewed_at)}` : ""}, after community review.</>
        : s.status === "superseded" ? <>Superseded by a revision (see the suggestions below).</>
        : <>Decided{s.reviewer ? ` by ${s.reviewer}` : ""}: {s.status}.</>}</p>

      <div className="abs-line" style={{ alignItems: "center", gap: 10 }}>
        <span><b>{score.score > 0 ? "+" : ""}{score.score}</b> <span className="muted small">({score.up} up, {score.down} down)</span></span>
        {held && viewer && !own && (<>
          {[1, -1].map((v) => (
            <form key={v} action={reviewVoteAction} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={s.public_id} />
              <input type="hidden" name="value" value={score.mine === v ? 0 : v} />
              <button className={`btn small${score.mine === v ? " primary" : ""}`} title={score.mine === v ? "remove your vote" : v > 0 ? "it looks right" : "something is wrong"}>
                {v > 0 ? "▲ Upvote" : "▼ Downvote"}</button>
            </form>))}
        </>)}
        {held && !viewer && <span className="small"><Link href={`/login?next=/s/${s.public_id}%23review`}>Sign in</Link> to vote, comment or suggest a change.</span>}
        {held && own && <span className="small muted">You cannot vote on your own submission; answer comments and apply suggestions you agree with.</span>}
        <span className="small muted">· {comments.length} comment{comments.length === 1 ? "" : "s"} · {open} open suggestion{open === 1 ? "" : "s"}</span>
      </div>

      <h3>Discussion</h3>
      {top.map((c) => <CommentBox key={c.id} c={c} depth={0} />)}
      {!comments.length && <p className="small muted">No comment yet.</p>}
      {held && viewer && (
        <form action={reviewCommentAction} className="box"><div className="in">
          <input type="hidden" name="id" value={s.public_id} />
          <div className="field-row"><label>Comment (Markdown)</label><textarea name="body" rows={4} required style={{ fontFamily: "var(--font)" }} /></div>
          {!s.source_repo && <div className="field-row"><label>On line (optional)</label><input type="text" name="line" inputMode="numeric" style={{ maxWidth: 100 }} /></div>}
          <button className="btn small">Comment</button>
        </div></form>
      )}

      <h3>Suggested changes</h3>
      {suggestions.map((g) => {
        const diff = source ? lineDiff(source, g.lean_source) : [];
        return (
          <div id={`g${g.id}`} className="box" key={g.id}><div className="in small">
            <div className="muted">#{g.id} · {who(g)} · {fmtDateTime(g.created_at)} · <b>{g.status}</b>
              {g.status === "applied" && g.revision ? <> → revision <Link href={`/s/${g.revision}`} className="mono">{g.revision}</Link></> : null}
              {g.decided_by ? <> by {g.decided_by}</> : null}</div>
            <Md src={g.body_md} className="small" />
            <details open={g.status === "open"}><summary>Diff ({diff.filter((d) => d.kind === "+").length} added, {diff.filter((d) => d.kind === "-").length} removed lines)</summary>
              <pre className="diff" style={{ maxHeight: 420, overflow: "auto" }}>{diff.map((d, i) => (
                <div key={i} style={{ background: d.kind === "+" ? "var(--diff-add, rgba(40,160,60,.12))" : d.kind === "-" ? "var(--diff-del, rgba(200,40,40,.12))" : undefined }}>
                  {d.kind === "…" ? "  …" : `${d.kind} ${d.line ? String(d.line).padStart(5) : "     "}  ${d.text}`}</div>))}</pre>
            </details>
            {g.status === "open" && held && (own || viewer?.mod) && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {(["apply", "close"] as const).map((a) => (
                  <form key={a} action={reviewDecideSuggestionAction}>
                    <input type="hidden" name="id" value={s.public_id} /><input type="hidden" name="gid" value={g.id} /><input type="hidden" name="action" value={a} />
                    <button className={`btn small${a === "apply" ? " primary" : ""}`}>{a === "apply" ? "Apply: submit it as a new revision" : "Close without applying"}</button>
                  </form>))}
              </div>)}
          </div></div>
        );
      })}
      {!suggestions.length && <p className="small muted">No suggestion yet.</p>}
      {held && viewer && !s.source_repo && (
        <details className="box"><summary className="in"><b>Suggest a change</b> <span className="small muted">— edit the whole file; once applied by the author or a moderator it is checked by Lean as a new revision, crediting you</span></summary>
          <form action={reviewSuggestAction} className="in">
            <input type="hidden" name="id" value={s.public_id} />
            <div className="field-row"><label>What it changes and why</label><textarea name="body" rows={3} required style={{ fontFamily: "var(--font)" }} /></div>
            <div className="field-row"><label>Revised Lean file</label><textarea name="lean_source" rows={16} required defaultValue={source && source.length < 300_000 ? source : ""} /></div>
            <button className="btn small">Suggest</button>
          </form>
        </details>
      )}
    </section>
  );
}
