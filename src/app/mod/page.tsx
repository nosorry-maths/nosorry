import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser, isModerator } from "@/lib/auth";
import { q } from "@/lib/db";
import { recentSubmissions, fmtDate } from "@/lib/data";
import { Md, SubmissionTable } from "@/components/ui";
import { resolveCritique } from "@/app/actions";

export const metadata = { title: "Moderation" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = await currentUser();
  if (!isModerator(user)) notFound();
  const [review, critiques, dead, audit, upstream, pending, aixiv] = await Promise.all([
    recentSubmissions({ statuses: ["needs_review"], limit: 200, publicOnly: false }),
    q<{ id: number; user_id: number; kind: string; body_md: string; proposed_source: string | null; handle: string; slug: string; title: string; created_at: string }>(
      `SELECT c.id, c.user_id, c.kind, c.body_md, c.proposed_source, u.handle, p.slug, p.title, c.created_at FROM critiques c
       JOIN users u ON u.id=c.user_id JOIN problems p ON p.id=c.problem_id WHERE c.status='open' ORDER BY c.created_at LIMIT 100`),
    q<{ id: number; last_error: string; public_id: string }>(
      "SELECT j.id, j.last_error, s.public_id FROM jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.state='dead' ORDER BY j.id DESC LIMIT 20"),
    q<{ action: string; target: string; handle: string | null; created_at: string }>(
      "SELECT a.action, a.target, u.handle, a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.action NOT IN ('login','signup') ORDER BY a.id DESC LIMIT 30"),
    q<{ base_commit: string | null; head_commit: string | null; head_date: string | null; ahead_by: number | null; base_toolchain: string | null; head_toolchain: string | null;
        checked_at: string | null; ok: boolean | null; summary: { error?: string; status_changes?: string[]; toolchain_changed?: boolean; mathlib_changed?: boolean; changed_files?: number } | null }>(
      "SELECT * FROM fc_upstream WHERE id=1").catch(() => []),
    q<{ slug: string; kind: string; title: string | null; status: string | null; detail: string | null; problem_id: number | null; first_seen: string }>(
      "SELECT slug, kind, title, status, detail, problem_id, first_seen FROM fc_pending ORDER BY kind, slug LIMIT 500").catch(() => []),
    q<{ finished_at: string | null; ok: boolean | null; summary: { links?: number; settled?: number; error?: string } | null }>(
      "SELECT finished_at, ok, summary FROM aixiv_sync WHERE id=1").catch(() => []),
  ]);
  const up = upstream[0];
  const short = (c: string | null | undefined) => (c ? c.slice(0, 8) : "—");
  const byKind = (k: string) => pending.filter((x) => x.kind === k);
  return (
    <>
      <h1>Moderation</h1>
      {msg && <div className="note small" role="status">{msg}</div>}
      <p className="muted">Machine checks settle correctness. People settle meaning: whether a statement is faithful, whether an answer is vacuous,
        whether a finding is new. Every decision here is logged and public on the item it concerns.</p>

      <h2>Waiting for review ({review.length})</h2>
      <p className="small muted">Results that would change a problem&apos;s status (first proof or disproof of an open problem: approve once the independent re-run agrees and someone other than the author found it sound), answer() proofs, findings and formalizations. Open each to accept or reject.</p>
      <SubmissionTable rows={review} />

      <h2>Open statement critiques ({critiques.length})</h2>
      {critiques.map((c) => (
        <div className="box" key={c.id}>
          <div className="small muted"><b>{c.kind}</b> on <Link href={`/p/${c.slug}#review`}>{c.title}</Link> by {c.handle} · {fmtDate(c.created_at)}</div>
          <Md src={c.body_md} className="small" />
          {c.user_id === user!.id ? (
            <p className="small muted">You wrote this critique, so another moderator has to decide on it: nobody judges their own work.</p>
          ) : (
          <form action={resolveCritique}>
            <input type="hidden" name="id" value={c.id} />
            <div className="field-row"><label>Resolution (public, required)</label><textarea name="resolution" rows={2} required style={{ fontFamily: "var(--font)" }} /></div>
            <div className="field-row"><label>Corrected Challenge.lean (accept only — creates v+1, freezes points and re-checks every proof; the statement becomes reviewed again when the last re-check finishes)</label>
              <textarea name="new_source" rows={4} defaultValue={c.proposed_source ?? ""} /></div>
            <div className="field-row"><label>Statement status afterwards</label>
              <select name="statement_status" defaultValue=""><option value="">automatic</option><option value="reviewed">reviewed</option>
                <option value="disputed">disputed (freeze points)</option><option value="frozen">frozen</option></select></div>
            <div className="field-row"><label>Decision</label>
              <select name="decision" defaultValue="" required><option value="" disabled>Choose…</option><option value="accept">Accept</option><option value="reject">Reject</option></select></div>
            <button className="btn small">Record decision</button>
          </form>
          )}
        </div>
      ))}
      {!critiques.length && <p className="muted small">None.</p>}

      <h2 id="upstream">formal-conjectures upstream</h2>
      {!up ? <p className="muted small">Not checked yet (the worker checks once a day; <span className="mono">node scripts/fc-watch.mjs</span> checks now).</p> : (<>
        <p className="small">
          Our statements and the verifier image come from <a className="mono" href={`https://github.com/google-deepmind/formal-conjectures/commit/${up.base_commit}`} rel="noopener" target="_blank">{short(up.base_commit)}</a>;
          main is <a className="mono" href={`https://github.com/google-deepmind/formal-conjectures/commit/${up.head_commit}`} rel="noopener" target="_blank">{short(up.head_commit)}</a>
          {up.ahead_by ? <>, <b>{up.ahead_by} commit{up.ahead_by > 1 ? "s" : ""} ahead</b> (<a href={`https://github.com/google-deepmind/formal-conjectures/compare/${up.base_commit}...${up.head_commit}`} rel="noopener" target="_blank">diff</a>)</> : <>, up to date</>}.
          {" "}Checked {up.checked_at ? fmtDate(up.checked_at) : "—"}{up.ok === false ? <> — <b>last check failed</b>: {up.summary?.error}</> : null}.
        </p>
        <p className="small muted">Applied automatically every day: titles, descriptions, subjects and statuses (each status change is posted on the problem&apos;s stream).
          Listed below and applied only by the batch update (a verifier image built from the newer commit, then the import of that same commit): everything that needs Lean.</p>
        {(up.summary?.toolchain_changed || up.summary?.mathlib_changed) && (
          <p className="small"><b>Toolchain change upstream:</b> {up.base_toolchain} → {up.head_toolchain}{up.summary?.mathlib_changed ? " · Mathlib or dependencies changed (lake-manifest.json)" : ""}. This needs the full image rebuild; it is never done automatically.</p>
        )}
        <table className="meta small"><tbody>
          <tr><td className="k">New problems:</td><td>{byKind("new").length}</td></tr>
          <tr><td className="k">Changed statements:</td><td>{byKind("statement").length} <span className="muted">(statement, or a definition it uses; each becomes a new version and its proofs are re-checked)</span></td></tr>
          <tr><td className="k">Removed upstream:</td><td>{byKind("removed").length} <span className="muted">(never deleted here; proofs and points stay)</span></td></tr>
          <tr><td className="k">Status changes applied:</td><td>{up.summary?.status_changes?.length ?? 0} on the last check</td></tr>
        </tbody></table>
        {pending.length > 0 && (
          <details className="small"><summary>Pending items ({pending.length})</summary>
            <ul>{pending.map((x) => (
              <li key={x.slug}><span className="muted">{x.kind}</span>{" "}
                {x.problem_id ? <Link href={`/p/${x.slug}`}>{x.slug}</Link> : <span className="mono">{x.slug}</span>}
                {x.detail ? <span className="muted"> — {x.detail}</span> : null}<span className="muted"> · since {fmtDate(x.first_seen)}</span></li>
            ))}</ul>
          </details>
        )}
      </>)}

      <h2>aiXiv cross-reference</h2>
      {aixiv[0] ? <p className="small">Last sync {aixiv[0].finished_at ? fmtDate(aixiv[0].finished_at) : "—"}{aixiv[0].ok === false ? <> — <b>failed</b>: {aixiv[0].summary?.error}</> : <>: {aixiv[0].summary?.links ?? 0} links, {aixiv[0].summary?.settled ?? 0} claimed solved on aiXiv</>}. Daily, by the worker.</p>
        : <p className="muted small">Not synced yet.</p>}

      <h2>Dead jobs</h2>
      <ul className="small">{dead.map((d) => <li key={d.id}><Link href={`/s/${d.public_id}`}>{d.public_id}</Link> — {d.last_error}</li>)}</ul>
      {!dead.length && <p className="muted small">None.</p>}

      <h2>Audit log</h2>
      <table className="t"><tbody>
        {audit.map((a, i) => <tr key={i}><td>{a.action}</td><td className="mono">{a.target}</td><td>{a.handle}</td><td className="muted">{fmtDate(a.created_at)}</td></tr>)}
      </tbody></table>
    </>
  );
}
