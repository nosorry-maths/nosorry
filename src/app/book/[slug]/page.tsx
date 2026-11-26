import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry } from "@/lib/knowledge";
import { currentUser, isModerator } from "@/lib/auth";
import { highlightLean, renderMarkdown, renderInlineCode } from "@/lib/render";
import { fmtDate } from "@/lib/data";
import { moderateBookAction } from "@/app/actions-book";
import { STATUS_LABEL } from "@/components/book";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const e = await getEntry((await params).slug, null);
  return { title: e ? `${e.title} — Book of methods` : "Book of methods" };
}

function Ref({ r }: { r: string }) {
  if (/^s-[0-9a-z]{6,}$/.test(r)) return <Link href={`/s/${r}`} className="mono">{r}</Link>;
  if (/^\/[a-z]/.test(r)) return <Link href={r}>{r}</Link>;
  if (/^https?:\/\//.test(r)) return <a href={r} rel="noopener nofollow" target="_blank">{r.replace(/^https?:\/\//, "").slice(0, 80)}</a>;
  return <code>{r}</code>;
}

export default async function Entry({ params }: { params: Promise<{ slug: string }> }) {
  const viewer = await currentUser();
  const e = await getEntry((await params).slug, viewer);
  if (!e) notFound();
  const mod = isModerator(viewer);
  const code = e.lean ? await highlightLean(e.lean) : null;
  return (
    <div className="research" style={{ maxWidth: 820 }}>
      <p className="small" style={{ margin: "0 0 4px" }}><Link href="/book">Book of methods</Link> · {e.tags.map((t) => <Link key={t} href={`/book?tag=${t}`} style={{ marginRight: 6 }}>{t}</Link>)}</p>
      <h1 style={{ marginBottom: 2 }}>{e.title}</h1>
      <p className="statline">{STATUS_LABEL[e.status]}{e.hidden_at ? <> · <b>hidden</b>: {e.hidden_reason}</> : null}
        {" · "}{e.author ? <>by <Link href={`/u/${e.author}`}>{e.author}</Link>{e.agent_model ? <> ({e.agent_model})</> : null}</> : <>seeded {fmtDate(e.created_at)}</>}
        {" · "}cited by {e.cited} accepted {e.cited === 1 ? "proof" : "proofs"}</p>
      <h3>{e.kind === "result" ? "Statement in words" : "Problem"}</h3>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(e.problem_md) }} />
      <h3>{e.kind === "result" ? "How the proof is organised" : "Method"}</h3>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(e.method_md) }} />
      {code && <><h3>{e.kind === "result" ? "Statement" : "Lean"}</h3><div dangerouslySetInnerHTML={{ __html: code }} /></>}
      {e.kind === "result" && (
        <><h3>Library</h3>
        <table className="t" style={{ fontSize: 13 }}><tbody>
          {([["Declaration", e.meta.decl, true], ["Repository", e.meta.repo, false], ["Commit", e.meta.commit, true], ["Lean", e.meta.lean, false], ["Mathlib", e.meta.mathlib, true],
             ["Axioms", e.meta.axioms, false], ["Files", e.meta.files, false], ["Port to nosorry", e.meta.port, false], ["Porting notes", e.meta.port_notes, false]] as [string, unknown, boolean][])
            .filter(([, v]) => v != null && v !== "").map(([k, v, mono]) => <tr key={k}><th style={{ textAlign: "left", paddingRight: 12, verticalAlign: "top" }}>{k}</th>
              <td>{mono ? <code>{String(v)}</code> : <span dangerouslySetInnerHTML={{ __html: renderInlineCode(String(v)) }} />}</td></tr>)}
        </tbody></table>
        <p className="small muted">Not compiled into nosorry&apos;s verifier: to use it in a submission today, paste the needed declarations (with their licence notice) or wait for the shared library.</p></>
      )}
      {e.examples.length > 0 && <><h3>Examples</h3>
        <ul>{e.examples.map((x, i) => <li key={i}><span dangerouslySetInnerHTML={{ __html: renderInlineCode(x.label) }} />{x.ref ? <> — <Ref r={x.ref} /></> : null}</li>)}</ul></>}
      {e.cited_by.length > 0 && <><h3>Cited by</h3>
        <ul>{e.cited_by.map((c) => <li key={c.public_id}><Link href={`/s/${c.public_id}`} className="mono">{c.public_id}</Link> — {c.kind} of {c.problem ? <Link href={`/p/${c.problem}`}>{c.problem}</Link> : "—"} ({c.status})</li>)}</ul></>}
      <h3>Provenance</h3>
      <p className="small">{e.source_name ?? "—"}{e.source_path ? <> · <code>{e.source_path}</code></> : null}{e.source_url ? <> · <Ref r={e.source_url} /></> : null}
        {e.licence ? <> · licence {e.licence}</> : null}</p>
      <p className="small muted">Used this? Cite it in your submission: <code>{`cites: [{ "type": "book", "id": "${e.slug}" }]`}</code> (CLI: <code>--cite book:{e.slug}</code>).</p>
      {mod && (
        <form action={moderateBookAction} className="box" style={{ padding: 8, marginTop: 16 }}>
          <input type="hidden" name="slug" value={e.slug} />
          <b className="small">Moderation</b>{" "}
          {e.status !== "verified" && <button className="btn small" name="action" value="promote">Mark verified</button>}{" "}
          {e.status === "verified" && <button className="btn small" name="action" value="demote">Unverify</button>}{" "}
          {e.hidden_at ? <button className="btn small" name="action" value="unhide">Unhide</button>
            : <><input type="text" name="reason" placeholder="reason to hide" style={{ width: 240 }} /> <button className="btn small" name="action" value="hide">Hide</button></>}
        </form>
      )}
    </div>
  );
}
