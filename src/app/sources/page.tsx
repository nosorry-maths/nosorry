import Link from "next/link";
import { q } from "@/lib/db";
import { fmtDate } from "@/lib/data";
import { DocsNav } from "@/components/docsnav";

export const metadata = { title: "Problem sources" };
export const dynamic = "force-dynamic";

type Row = { source: string; collection: string; n: number; open: number; settled: number; first: string; last: string; attribution: string | null; license: string | null };

// Where every statement comes from, how it is kept in sync, and when it was last checked. One block per upstream; the
// list grows when a new source is added (classified by the problems' attribution).
const SOURCES: Record<string, { name: string; url: string; sync: string; licence: string; about: string }> = {
  fc: {
    name: "formal-conjectures (Google DeepMind)",
    url: "https://github.com/google-deepmind/formal-conjectures",
    sync: "synced — metadata and statuses daily, statements in reviewed batches",
    licence: "Apache-2.0",
    about: "Open conjectures and problems formalized in Lean 4 by Google DeepMind and contributors: Erdős problems, OEIS conjectures, Wikipedia lists, research papers, Ben Green's 100 problems, quantum and other fields.",
  },
  physlib: {
    name: "Physlib (Lean community)",
    url: "https://github.com/leanprover-community/physlib",
    sync: "static snapshot — imported once at a fixed commit, not synced",
    licence: "Apache-2.0",
    about: "Statements left as `sorry` in the Lean physics library, imported as problems for the physics section.",
  },
  community: {
    name: "Community formalizations on nosorry",
    url: "/docs/manual",
    sync: "live — added when a moderator accepts a formalization",
    licence: "Apache-2.0",
    about: "Problems formalized by nosorry members. A new statement is a draft (no points) until reviewed.",
  },
};

export default async function Page() {
  const [rows, up, aixiv] = await Promise.all([
    q<Row>(`
      SELECT CASE WHEN attribution ILIKE 'google-deepmind/formal-conjectures%' THEN 'fc' WHEN attribution ILIKE 'Physlib%' THEN 'physlib' ELSE 'community' END AS source,
             coalesce(collection, 'other') AS collection, count(*)::int AS n,
             count(*) FILTER (WHERE status='open' AND coalesce(resolution,'') = '')::int AS open,
             count(*) FILTER (WHERE resolution IN ('proved','disproved'))::int AS settled,
             min(created_at) AS first, max(updated_at) AS last, min(attribution) AS attribution, min(license) AS license
      FROM problems WHERE status NOT IN ('lemma','withdrawn') GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
    q<{ base_commit: string | null; head_commit: string | null; ahead_by: number | null; checked_at: string | null; ok: boolean | null; base_toolchain: string | null }>(
      "SELECT base_commit, head_commit, ahead_by, checked_at, ok, base_toolchain FROM fc_upstream WHERE id=1").catch(() => []),
    q<{ finished_at: string | null; ok: boolean | null; summary: { links?: number; settled?: number } | null }>("SELECT finished_at, ok, summary FROM aixiv_sync WHERE id=1").catch(() => []),
  ]);
  const short = (c: string | null | undefined) => (c ? c.slice(0, 8) : "—");
  const fc = up[0];
  const groups = Object.keys(SOURCES).map((k) => ({ k, s: SOURCES[k], rows: rows.filter((r) => r.source === k) })).filter((g) => g.rows.length);
  const physCommit = rows.find((r) => r.source === "physlib")?.attribution?.match(/@ ?([0-9a-f]{7,40})/)?.[1];
  return (
    <div className="cols left">
      <DocsNav current="sources" />
      <div className="prose" style={{ maxWidth: 900 }}>
        <h1>Problem sources</h1>
        <p className="lede">Every statement on nosorry comes from a public source, keeps its licence and attribution, and is shown with the exact
          version it was taken from. This page lists the sources, how each is kept up to date, and when it was last checked.</p>

        {groups.map(({ k, s, rows: rs }) => (
          <section key={k}>
            <h2 id={k}>{s.url.startsWith("http") ? <a href={s.url} rel="noopener" target="_blank">{s.name}</a> : <Link href={s.url}>{s.name}</Link>}</h2>
            <p>{s.about}</p>
            <table className="meta small"><tbody>
              <tr><td className="k">Sync:</td><td>{s.sync}</td></tr>
              <tr><td className="k">Licence:</td><td>{s.licence} — attribution kept on every problem page</td></tr>
              {k === "fc" && fc && <>
                <tr><td className="k">Statements from:</td><td>commit <a className="mono" href={`${s.url}/commit/${fc.base_commit}`} rel="noopener" target="_blank">{short(fc.base_commit)}</a>{fc.base_toolchain ? <> · {fc.base_toolchain.replace("leanprover/lean4:", "Lean ")}</> : null}</td></tr>
                <tr><td className="k">Upstream:</td><td>{fc.ahead_by ? <><b>{fc.ahead_by}</b> new commit{fc.ahead_by > 1 ? "s" : ""} since (statement changes arrive in the next reviewed batch)</> : "up to date"} ·
                  last checked {fc.checked_at ? fmtDate(fc.checked_at) : "—"}{fc.ok === false ? " (the last check failed; retried daily)" : ""}</td></tr>
              </>}
              {k === "physlib" && physCommit && <tr><td className="k">Snapshot:</td><td>commit <a className="mono" href={`${s.url}/commit/${physCommit}`} rel="noopener" target="_blank">{physCommit.slice(0, 8)}</a></td></tr>}
              <tr><td className="k">Imported:</td><td>{fmtDate(rs.reduce((a, r) => (r.first < a ? r.first : a), rs[0].first))} · last change {fmtDate(rs.reduce((a, r) => (r.last > a ? r.last : a), rs[0].last))}</td></tr>
            </tbody></table>
            <table className="t" style={{ maxWidth: 700 }}>
              <thead><tr><th>Collection</th><th className="num">Problems</th><th className="num">Open</th><th className="num">Settled here</th></tr></thead>
              <tbody>{rs.map((r) => (
                <tr key={r.collection}><td><Link href={`/list/${r.source === "physlib" ? "physics" : "math"}?collection=${encodeURIComponent(r.collection)}`}>{r.collection}</Link></td>
                  <td className="num">{r.n.toLocaleString("en")}</td><td className="num">{r.open.toLocaleString("en")}</td><td className="num">{r.settled}</td></tr>
              ))}</tbody>
            </table>
          </section>
        ))}

        <h2 id="cross-references">Cross-references (not sources of statements)</h2>
        <ul>
          <li><b>aiXiv</b> (aixiv.online): claims of solutions made elsewhere, shown on problem pages as <em>not verified here</em>.{" "}
            {aixiv[0]?.finished_at ? <>Last sync {fmtDate(aixiv[0].finished_at)}{aixiv[0].ok === false ? " (failed; retried daily)" : `: ${aixiv[0].summary?.links ?? 0} links`}.</> : "Not synced yet."} Daily.</li>
          <li><b>Original problem pages</b> (erdosproblems.com, OEIS, arXiv, MathOverflow…): each problem links to where it was posed.</li>
        </ul>

        <h2 id="suggest">Suggest a source</h2>
        <p>A good source states open problems precisely in Lean 4, builds against a recent Mathlib, is maintained and reviewed, and has an open licence.
          Candidates under review: Lean FRO&apos;s <a href="https://github.com/leanprover/lean-eval" rel="noopener" target="_blank">lean-eval</a>, the open problems of
          OpenFrontiers, Mathlib&apos;s <code>proof_wanted</code>. Propose one with a <Link href="/docs/manual">formalization</Link> or by contacting the operator (see <Link href="/about">About</Link>).</p>
      </div>
    </div>
  );
}
