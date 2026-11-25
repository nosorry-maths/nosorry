import Link from "next/link";
import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { currentUser, isModerator } from "@/lib/auth";
import { highlightLean, renderInline } from "@/lib/render";
import { parseTranscript, redact } from "@/lib/transcript";
import { fmtDateTime } from "@/lib/data";
import { queuePosition } from "@/lib/submissions";
import { Md, Status, reasonLabel } from "@/components/ui";
import { ConfirmSubmit } from "@/components/forms";
import { setVisibility, reviewSubmission, revokeSubmission } from "@/app/actions";
import { scoreOf, threadOf } from "@/lib/reviews";
import { ReviewSection } from "@/components/review";
import { shareLemmasAction } from "@/app/actions-research";
import AutoRefresh from "./refresh";
import { CopyText, Elapsed, TranscriptTools } from "@/components/clip";
import { Redacted, redactionCounts } from "@/components/transcript";

export const dynamic = "force-dynamic";

// Metadata only: content columns (source, notes, transcript) are fetched separately, and only for people allowed to see them.
type S = {
  id: number; public_id: string; user_id: number; handle: string; kind: string; status: string; title: string | null;
  agent_name: string | null; agent_model: string | null; created_at: string; verified_at: string | null;
  review_note: string | null; visibility: string; transcript_public: boolean; novelty: string; repo_url: string | null;
  source_repo: string | null; source_commit: string | null; source_module: string | null;
  badge_compiles: boolean | null; badge_axioms: boolean | null; badge_statement: boolean | null; badge_faithful: boolean | null;
  problem_slug: string | null; problem_title: string | null; problem_ident: string | null; statement_status: string | null;
  version: number | null; current_version: number | null; decl_name: string | null;
  review_required: boolean; reviewed_at: string | null; reviewer: string | null; revision_of: string | null;
};
type Content = { body_md: string | null; explanation_md: string | null; lean_source: string | null; derived_from: string | null; open_lemmas: string[] | null; verdict: Record<string, unknown> | null };
type Stage = { name: string; status: string; ms?: number; detail?: string | null; started?: string };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Submission ${(await params).id}` };
}

export default async function Submission({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { id } = await params;
  const s = await one<S>(`
    SELECT s.id, s.public_id, s.user_id, u.handle, s.kind, s.status, s.title, s.agent_name, s.agent_model, s.created_at, s.verified_at,
           s.review_note, s.visibility, s.transcript_public, s.novelty, s.repo_url, s.source_repo, s.source_commit, s.source_module, s.badge_compiles, s.badge_axioms, s.badge_statement, s.badge_faithful,
           p.slug AS problem_slug, p.title AS problem_title, p.ident AS problem_ident, p.statement_status,
           v.version, v.decl_name, cv.version AS current_version,
           s.review_required, s.reviewed_at, ru.handle AS reviewer, rv.public_id AS revision_of
    FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN problems p ON p.id=s.problem_id LEFT JOIN users ru ON ru.id=s.reviewed_by
    LEFT JOIN submissions rv ON rv.id=s.revision_of
    LEFT JOIN problem_versions v ON v.id=s.problem_version_id LEFT JOIN problem_versions cv ON cv.id=p.current_version_id
    WHERE s.public_id=$1`, [id]);
  if (!s) notFound();
  const user = await currentUser();
  const owner = user?.id === s.user_id, mod = isModerator(user);
  const checked = ["verified", "partial", "accepted", "needs_review", "revoked", "superseded"].includes(s.status);
  const pending = s.status === "queued" || s.status === "running";
  if (!checked && !pending && !owner && !mod) notFound();
  const showContent = s.visibility === "public" || owner || mod;

  // Lemmas this submission shared (statements of its open lemmas) or reused (proved lemmas it depends on). Public.
  const [lemmasShared, lemmasUsed] = await Promise.all([
    q<{ slug: string; lemma_name: string; lemma_state: string }>("SELECT slug, lemma_name, lemma_state FROM problems WHERE origin_submission_id=$1 AND status='lemma' ORDER BY id", [s.id]),
    q<{ slug: string; lemma_name: string }>("SELECT l.slug, l.lemma_name FROM lemma_uses u JOIN problems l ON l.id=u.lemma_id WHERE u.submission_id=$1 ORDER BY l.id", [s.id]),
  ]);
  const [score, thread] = s.review_required ? await Promise.all([scoreOf(s.id, user?.id), threadOf(s.id)]) : [null, null];
  const [content, runs, transcript, points, qpos] = await Promise.all([
    showContent ? one<Content>("SELECT body_md, explanation_md, lean_source, derived_from, open_lemmas, verdict FROM submissions WHERE id=$1", [s.id]) : null,
    q<{ id: number; toolchain: string; sandbox: string; started_at: string; result: string | null; stages: Stage[]; job_kind: string | null }>(
      `SELECT r.id, r.toolchain, r.sandbox, r.started_at, r.result, r.stages, j.kind AS job_kind FROM verification_runs r
       LEFT JOIN jobs j ON j.id=r.job_id WHERE r.submission_id=$1 ORDER BY r.id DESC`, [s.id]),
    (s.transcript_public || owner || mod) ? one<{ format: string; content: string; redactions: number; captured_by: string; byte_size: number }>(
      "SELECT format, content, redactions, captured_by, byte_size FROM transcripts WHERE submission_id=$1", [s.id]) : null,
    q<{ delta: number; reason: string; note: string | null; created_at: string }>(
      "SELECT delta, reason, note, created_at FROM point_events WHERE submission_id=$1 ORDER BY id", [s.id]),
    s.status === "queued" ? queuePosition(s.id) : null,
  ]);
  const code = content?.lean_source ? await highlightLean(content.lean_source.slice(0, 200_000)) : null;
  // Cleaned again on display: transcripts stored before a cleaning rule existed benefit from it too.
  const cleaned = transcript ? redact(transcript.content) : null;
  const turns = transcript && cleaned ? parseTranscript(transcript.format, cleaned.text).slice(0, 400) : [];
  const legend = cleaned ? redactionCounts(cleaned.text) : [];
  const answers = (content?.verdict?.answers as string[] | undefined) ?? [];
  const isProofKind = s.kind === "proof" || s.kind === "disproof" || s.kind === "partial";
  const Check = ({ v, title, yes, no }: { v: boolean | null; title: string; yes: string; no: string }) => (
    <tr><td>{title}</td><td className={v === true ? "yes" : v === false ? "no" : "na"}>{v === true ? "yes" : v === false ? "no" : "—"}</td>
      <td className="muted">{v === true ? yes : v === false ? no : "not assessed yet"}</td></tr>
  );

  return (
    <div className="narrow" style={{ maxWidth: 900 }}>
      {pending && <AutoRefresh />}
      <div className="crumbs">
        {s.problem_slug ? <><Link href={`/p/${s.problem_slug}`}>{s.problem_ident} · <span dangerouslySetInnerHTML={{ __html: renderInline(s.problem_title) }} /></Link> &gt; </> : <>New formalization &gt; </>}
        <span className="mono">{s.public_id}</span>
      </div>
      {msg && <div className="note small" role="status">{msg}</div>}
      <header>
        <div className="ident">{s.public_id} · {s.kind}{s.version ? ` · against statement v${s.version}` : ""}</div>
        <h1 className="abs-title" dangerouslySetInnerHTML={{ __html: renderInline(s.title ?? `${s.kind[0].toUpperCase()}${s.kind.slice(1)} for ${s.problem_title ?? "a new problem"}`) }} />
        <div className="abs-line dots">
          <Status s={s.status} />
          <span>by <Link href={`/u/${s.handle}`}>{s.handle}</Link></span>
          <span>{[s.agent_name, s.agent_model].filter(Boolean).join(" / ") || "no agent declared"}</span>
          <span>submitted {fmtDateTime(s.created_at)}</span>
          {s.verified_at && <span>checked {fmtDateTime(s.verified_at)}</span>}
          {s.visibility === "private" && <span className="st st-draft">sealed</span>}
        </div>
        {s.status === "error" && (
          <div className="note small" role="status"><b>The check could not run — this is a problem on our side, not in this proof.</b>{" "}
            The verifier failed before looking at the submission (see the stage marked “fail” below). It was retried automatically;
            once the server is fixed it will be re-run, with no change needed from the author and no effect on priority.</div>
        )}
        {s.repo_url && showContent && (
          <div className="abs-line"><span className="descriptor">Repository:</span><a href={s.repo_url} rel="nofollow ugc noopener noreferrer" target="_blank" className="mono">{s.repo_url.replace(/^https:\/\//, "")}</a></div>
        )}
      </header>

      {s.status === "queued" && (
        <div className="note" role="status">
          {qpos ? <>Position <b>{qpos.pos}</b> in the verification queue. </> : null}
          {qpos && qpos.workers === 0 ? <>No verification worker is online right now; it will be checked as soon as one is. </> : null}
          Your timestamp is already recorded ({fmtDateTime(s.created_at)}): it decides priority, not the time the check finishes.
        </div>
      )}
      {s.version && s.current_version && s.version < s.current_version && (
        <div className="note">This submission targets statement v{s.version}; the current statement is v{s.current_version}.</div>
      )}
      {s.review_note && <div className="note"><b>Moderator note:</b> <Md src={s.review_note} /></div>}

      {isProofKind && (
        <table className="checks"><tbody>
          <Check v={s.badge_compiles} title="Lean accepts it" yes="compiles under the pinned toolchain" no="does not compile" />
          <Check v={s.badge_axioms} title="Standard axioms" yes="propext, Classical.choice, Quot.sound only" no={s.kind === "partial" ? "depends on sorry (partial)" : "extra axioms or sorry"} />
          <Check v={s.badge_statement} title="Right theorem" yes={s.kind === "disproof" ? "proves exactly the negation of the reference" : "type identical to the reference, definitions unchanged"} no="statement differs" />
          <Check v={s.badge_faithful ?? (s.statement_status === "reviewed" || s.statement_status === "frozen" ? true : s.statement_status === "disputed" ? false : null)}
            title="Faithful statement" yes="the reference statement has been reviewed" no="the reference statement is disputed" />
          {s.review_required && (
            <Check v={s.reviewed_at && s.status === "verified" ? true : s.status === "rejected" ? false : null} title="Reviewed"
              yes={`community review, approved by ${s.reviewer ?? "a moderator"}`} no="rejected after review" />
          )}
        </tbody></table>
      )}

      {s.revision_of && <div className="note small">A revision of <Link href={`/s/${s.revision_of}`} className="mono">{s.revision_of}</Link>, from a suggested change made during its review.</div>}
      {s.review_required && score && thread && (
        <ReviewSection s={s} source={showContent ? content?.lean_source ?? null : null} viewer={user ? { id: user.id, mod } : null}
          score={score} comments={thread.comments} suggestions={thread.suggestions} />
      )}

      {s.kind === "partial" && content?.open_lemmas && content.open_lemmas.length > 0 && (
        <div className="box"><h4>Open lemmas</h4><div className="in">
          <p className="small" style={{ margin: 0 }}>This partial proof reduces <code>{s.decl_name}</code> to: {content.open_lemmas.map((l) => <code key={l} style={{ marginRight: 6 }}>{l}</code>)}</p>
          {lemmasShared.length > 0 ? (
            <p className="small" style={{ margin: "6px 0 0" }}>Shared as intermediate lemmas: {lemmasShared.map((l, i) => <span key={l.slug}>{i > 0 && ", "}<Link href={`/p/${l.slug}`} className="mono">{l.lemma_name}</Link> <span className="muted">({l.lemma_state})</span></span>)}</p>
          ) : owner && s.status === "partial" ? (
            <form action={shareLemmasAction} style={{ marginTop: 6 }}>
              <input type="hidden" name="id" value={s.public_id} />
              <button className="btn small">Share them as intermediate lemmas</button>{" "}
              <span className="small muted">Others can then prove them (only their statements are published, not your proof).</span>
            </form>
          ) : null}
        </div></div>
      )}
      {lemmasUsed.length > 0 && (
        <div className="box"><h4>Lemmas reused</h4><div className="in small">
          This proof uses {lemmasUsed.map((l, i) => <span key={l.slug}>{i > 0 && ", "}<Link href={`/p/${l.slug}`} className="mono">{l.lemma_name}</Link></span>)}; their authors are credited.
        </div></div>
      )}
      {mod && answers.length > 0 && (
        <div className="box"><h4>Answer supplied (check it is not vacuous)</h4><div className="in">{answers.map((a, i) => <pre key={i} style={{ margin: "2px 0" }}>{a}</pre>)}</div></div>
      )}

      <h2>Verification pipeline</h2>
      {!runs.length && <p className="muted small">{s.kind === "finding" ? "Findings are reviewed by people, not by Lean." : "Waiting for a worker…"}</p>}
      {!showContent && runs.length > 0 && <p className="small muted">Stage logs are sealed with the submission; the verdict of each stage is public.</p>}
      {runs.map((r, i) => (
        <details key={r.id} open={i === 0}>
          <summary>Run #{r.id} · {r.result === "abandoned" ? "abandoned (superseded by a later run)" : r.result ?? "in progress"} · {fmtDateTime(r.started_at)} · {r.toolchain.replace("leanprover/lean4:", "Lean ")} · sandbox {r.sandbox}</summary>
          <ol className="pipeline">
            {r.stages.map((st, j) => (
              <li key={j}>
                <b>{st.name}</b> — <span className={st.status === "pass" ? "yes" : st.status === "fail" || st.status === "error" ? "no" : "na"}>{st.status}</span>
                {st.ms != null && <span className="ms">{(st.ms / 1000).toFixed(2)} s</span>}
                {st.ms == null && st.status === "running" && !r.result && (
                  <Elapsed since={st.started ?? new Date(new Date(r.started_at).getTime() + r.stages.slice(0, j).reduce((a, x) => a + (x.ms ?? 0), 0)).toISOString()} />
                )}
                {st.detail && showContent && <pre>{st.detail}</pre>}
              </li>
            ))}
          </ol>
        </details>
      ))}

      {points.length > 0 && (<>
        <h2>Points</h2>
        <table className="t" style={{ maxWidth: 760 }}><tbody>
          {points.map((p, i) => <tr key={i}><td className="num mono">{p.delta > 0 ? "+" : ""}{p.delta}</td><td title={p.reason}>{reasonLabel(p.reason)}</td><td className="muted">{p.note}</td><td className="muted">{fmtDateTime(p.created_at)}</td></tr>)}
        </tbody></table>
      </>)}

      {content?.body_md && (<><h2>{s.kind === "finding" ? "Finding" : "Notes"}</h2><Md src={content.body_md} className="prose" /></>)}
      {content?.explanation_md && (<><h2>Explanation</h2><Md src={content.explanation_md} className="prose" /></>)}
      {content?.derived_from && (<><h2>Declared prior work</h2><Md src={content.derived_from} className="small" /></>)}

      {s.source_repo ? (<>
        <h2>Lean source</h2>
        <p>A repository submission: the proof is the Lake project{" "}
          <a href={`${s.source_repo}/tree/${s.source_commit}`} rel="noopener" target="_blank" className="mono">{s.source_repo.replace("https://github.com/", "")}@{String(s.source_commit).slice(0, 12)}</a>,
          module <span className="mono">{s.source_module}</span>. It was built on the verifier with the repository&apos;s own toolchain, and every declaration of the
          repository the theorem depends on was replayed in the kernel.
          {content?.verdict?.foreign_toolchain ? <> <b>Checked with {String(content.verdict.toolchain)}</b>, not the statement&apos;s {String(content.verdict.reference_toolchain)}: the reference statement was compiled with the same versions as the proof.</> : null}</p>
      </>) : code && content?.lean_source && (
        <details className="leansrc">
          <summary><h2>Lean source</h2>
            <span className="muted small">{content.lean_source.split("\n").length} lines · {(content.lean_source.length / 1024).toFixed(1)} KB<span className="when-closed"> · click to show</span></span>
            <CopyText text={content.lean_source} label="Copy to clipboard" />
          </summary>
          <div dangerouslySetInnerHTML={{ __html: code }} />
          {content.lean_source.length > 200_000 && <p className="small muted">Highlighted up to 200 KB; the copy button copies the whole file.</p>}
        </details>
      )}
      {!showContent && checked && (
        <div className="note">Its author has <b>sealed</b> this submission: its verdict and timestamp are public, the source is not.</div>
      )}

      {transcript && (<>
        <h2 className="tr-head" id="transcript">Agent transcript
          {s.transcript_public
            ? <span className="public-tag">public</span>
            : <span className="private-tag">not public — only {owner ? "you" : "its author"} and moderators can see it</span>}
          {owner && checked && s.status !== "revoked" && s.visibility !== "private" && (
            <form action={setVisibility} className="inline-form">
              <input type="hidden" name="id" value={s.public_id} />
              <input type="hidden" name="transcript" value={s.transcript_public ? "private" : "public"} />
              <button className={`btn small${s.transcript_public ? "" : " primary"}`}>{s.transcript_public ? "Make it private" : "Publish the transcript"}</button>
            </form>
          )}
        </h2>
        {owner && !s.transcript_public && (
          <p className="small" style={{ marginTop: 0 }}>Read it before publishing: paths, e-mail addresses, IP addresses, private host names and secrets are removed automatically
            ({cleaned?.count ?? 0} removed here), but anything else you or your agent typed would be public.</p>
        )}
        <p className="muted small">
          {transcript.captured_by === "platform" ? "Captured by the nosorry agent connector." : "Self-reported by the submitter — a claim, not evidence; only the Lean proof is checked."}
          {" "}{(transcript.byte_size / 1024).toFixed(0)} KB, {Math.max(transcript.redactions, cleaned?.count ?? 0)} automatic redaction{Math.max(transcript.redactions, cleaned?.count ?? 0) === 1 ? "" : "s"}.
        </p>
        <TranscriptTools base={`/s/${s.public_id}/transcript`} />
        {legend.length > 0 && (
          <p className="tr-legend"><span className="redact" title="Removed automatically before publication"><span aria-hidden="true">🔒</span> hidden</span>{" "}
            marks what was removed automatically before anyone could read it: {legend.map(([k, n], i) => <span key={k}>{i > 0 && ", "}{n} {k}{n === 1 ? "" : "s"}</span>)}.
            File names are kept; the folders above them are not.</p>
        )}
        <details className="tr-body">
          <summary>Show the {turns.length} turns{turns.length >= 400 ? " (the first 400; the download has all of them)" : ""}</summary>
          {turns.map((t, i) => <div key={i} className={`turn ${t.role}`}><div className="who">{t.role}</div>
            <div className="body"><Redacted text={t.text.length > 8000 ? t.text.slice(0, 8000) + " … (cut here; the download has the whole turn)" : t.text} /></div></div>)}
        </details>
      </>)}

      {owner && checked && s.status !== "revoked" && (
        <form action={setVisibility} className="box" style={{ marginTop: 24 }}>
          <h4>Visibility</h4><div className="in">
          <input type="hidden" name="id" value={s.public_id} />
          <p className="small" style={{ marginTop: 0 }}>The proof and its verdict are public{s.visibility === "private" ? " — except this one, which you sealed" : ""}.{" "}
            {transcript ? <>The agent transcript is {s.transcript_public ? "public" : "private: only you and moderators see it"} (see <a href="#transcript">above</a>).</>
              : <>No agent transcript was attached to this submission (the CLI attaches the session log by default; the MCP <code>submit</code> tool does from tools 0.8.1).</>}</p>
          {s.visibility === "private"
            ? <><input type="hidden" name="visibility" value="public" /><button className="btn primary">Make the proof public</button></>
            : transcript ? <><input type="hidden" name="transcript" value={s.transcript_public ? "private" : "public"} />
                <button className="btn">{s.transcript_public ? "Make the transcript private" : "Publish the transcript too"}</button></> : null}
        </div></form>
      )}

      {mod && !owner && (s.status === "needs_review" || checked) && s.status !== "revoked" && s.status !== "superseded" && (
        <div className="box" style={{ marginTop: 24 }}>
          <h4>Moderation</h4><div className="in">
          {s.status === "needs_review" && (
            <form action={reviewSubmission} style={{ marginBottom: 14 }}>
              <input type="hidden" name="id" value={s.public_id} />
              <div className="field-row"><label>Decision</label>
                <select name="decision" defaultValue="" required><option value="" disabled>Choose…</option><option value="accept">Accept</option><option value="reject">Reject</option></select></div>
              <div className="field-row"><label>Public note</label><input type="text" name="note" /></div>
              {(s.kind === "partial" || s.kind === "finding" || s.kind === "formalization") && (
                <div className="field-row"><label>Points (0 = default rule, max 100)</label><input type="text" name="points" defaultValue="0" /></div>
              )}
              <button className="btn small primary">Record decision</button>
            </form>
          )}
          <form action={revokeSubmission}>
            <input type="hidden" name="id" value={s.public_id} />
            <div className="field-row"><label>Revoke — reason</label>
              <select name="reason"><option value="wrong">Proof found wrong</option><option value="cheating">Cheating (adds a −50 penalty)</option>
                <option value="plagiarism">Plagiarism / misattribution</option><option value="other">Other</option></select></div>
            <div className="field-row"><label>Public note (required)</label><input type="text" name="note" required /></div>
            <ConfirmSubmit label="Revoke and reverse points" message="Revoke this submission? Its points are reversed in the public ledger." />
          </form>
        </div></div>
      )}
    </div>
  );
}
