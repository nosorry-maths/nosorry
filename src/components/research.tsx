import Link from "next/link";
import type { ThreadRow } from "@/lib/research";
import { repoLabel } from "@/lib/research";
import { fmtDate, fmtAgo } from "@/lib/data";
import { renderInline } from "@/lib/render";
import { Md } from "./ui";
import { saveResearchThread, hideResearchThread } from "@/app/actions";

const STATUS_LABEL: Record<string, string> = { active: "active", paused: "paused", abandoned: "abandoned", done: "done" };
const STATUS_CLASS: Record<string, string> = { active: "st-verified", paused: "st-partial", abandoned: "st-test", done: "st-reviewed" };

export function ThreadList({ threads, problemSlug, canModerate, viewerId }: { threads: ThreadRow[]; problemSlug?: string; canModerate?: boolean; viewerId?: number }) {
  if (!threads.length) return null;
  return (
    <ul className="threads">
      {threads.map((t) => (
        <li key={t.id} id={`thread-${t.id}`} className="thread">
          <div className="thread-head">
            <a href={t.repo_url} rel="nofollow ugc noopener noreferrer" target="_blank" className="mono">{repoLabel(t.repo_url)}</a>
            <span className={`st ${STATUS_CLASS[t.status] ?? ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
            {t.open_to_collaborators && t.status === "active" && <span className="small muted">open to collaborators</span>}
          </div>
          {t.problem_slug && (
            <div className="small">on <Link href={`/p/${t.problem_slug}#thread-${t.id}`} dangerouslySetInnerHTML={{ __html: renderInline(t.problem_title) }} /> <span className="muted">({t.problem_ident})</span></div>
          )}
          {t.approach && <div className="thread-approach"><b>Approach:</b> {t.approach}</div>}
          <Md src={t.summary_md} className="thread-summary" />
          <div className="small muted">
            by <Link href={`/u/${t.handle}`}>{t.handle}</Link> · started {fmtDate(t.created_at)} · updated {fmtAgo(t.updated_at)}
            {canModerate && problemSlug && viewerId !== t.user_id && (
              <form action={hideResearchThread} className="inline-form" style={{ marginLeft: 8 }}>
                <input type="hidden" name="id" value={t.id} /><input type="hidden" name="problem" value={problemSlug} />
                <input type="text" name="note" placeholder="reason" required style={{ width: 120, display: "inline-block" }} />{" "}
                <button className="btn small">Hide</button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ThreadForm({ problemSlug, mine }: { problemSlug: string; mine?: ThreadRow | null }) {
  return (
    <form action={saveResearchThread} style={{ maxWidth: 720, marginTop: 8 }}>
      <input type="hidden" name="problem" value={problemSlug} />
      <div className="field-row"><label htmlFor="repo">Repository (public)</label>
        <input id="repo" type="text" name="repo_url" defaultValue={mine?.repo_url ?? ""} placeholder="https://github.com/you/erdos-488-notes" required />
        <div className="hint">GitHub, GitLab or Codeberg. Put your notes, attempts, scripts, partial Lean files there.</div></div>
      <div className="field-row"><label htmlFor="approach">Approach in one line (optional)</label>
        <input id="approach" type="text" name="approach" maxLength={200} defaultValue={mine?.approach ?? ""} placeholder="e.g. computer search up to 10^9, then reduction to the density lemma" /></div>
      <div className="field-row"><label htmlFor="summary">What you have done so far (required)</label>
        <textarea id="summary" name="summary_md" rows={5} required minLength={30} style={{ fontFamily: "var(--font)" }} defaultValue={mine?.summary_md ?? ""}
          placeholder={"What you tried, what worked, what failed, what you are trying next.\nMarkdown and $TeX$ allowed."} />
        <div className="hint">Even negative results help: they save the next person a week. Keep it current when you make progress.</div></div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div className="field-row" style={{ margin: 0 }}><label htmlFor="tstatus">Status</label>
          <select id="tstatus" name="status" defaultValue={mine?.status && mine.status !== "hidden" ? mine.status : "active"} style={{ width: "auto" }}>
            <option value="active">active</option><option value="paused">paused</option><option value="abandoned">abandoned</option><option value="done">done</option>
          </select></div>
        <label className="small" style={{ marginTop: 16 }}><input type="checkbox" name="open_to_collaborators" defaultChecked={mine ? mine.open_to_collaborators : true} /> open to collaborators</label>
      </div>
      <button className="btn primary" style={{ marginTop: 10 }}>{mine ? "Update my research" : "Share my research"}</button>
    </form>
  );
}
