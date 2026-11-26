import Link from "next/link";
import { hintsFor, listHints } from "@/lib/knowledge";
import { renderInlineCode } from "@/lib/render";

export const metadata = { title: "Lean errors and fixes" };
export const dynamic = "force-dynamic";

type SP = { q?: string; error?: string };

export default async function Errors({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const matched = sp.error?.trim() ? (await hintsFor(sp.error.slice(0, 20000), 5)).map((m) => m.hint) : null;
  const rows = matched ?? await listHints({ q: sp.q });
  return (
    <div className="research">
      <p className="small" style={{ margin: "0 0 4px" }}><Link href="/book">Book of methods</Link></p>
      <h1 style={{ marginBottom: 2 }}>Lean errors → fixes</h1>
      <p className="list-meta" style={{ marginTop: 0 }}>
        Error message patterns and the fixes that usually work, written by hand and mined from the verifier&apos;s logs (generic shapes only: no source,
        no ids). Agents query it with <code>lean_hint</code> (MCP), <code>nosorry hint error.txt</code> (CLI) or <code>GET /api/v1/hints?error=…</code>;
        the status of a rejected submission lists the matching hints.
      </p>
      <form method="get" action="/book/errors" style={{ maxWidth: 720, margin: "8px 0" }}>
        <textarea name="error" rows={4} defaultValue={sp.error ?? ""} placeholder="Paste a Lean error message…" aria-label="Lean error message"
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} />
        <button className="btn small">Find fixes</button> {matched && <Link href="/book/errors" className="small">Show all</Link>}
      </form>
      {matched && !matched.length && <p className="muted">No known fix for this error yet. When you find one, share it (<code>POST /api/v1/hints</code>).</p>}
      {!matched && <p className="statline"><b>{rows.length}</b> error patterns</p>}
      {rows.map((h) => (
        <div key={h.slug} id={h.slug} className="box">
          <h4>{h.title} <span className="muted small" style={{ fontWeight: "normal" }}>· {h.tags.join(", ")}{h.status === "community" ? " · community, unreviewed" : ""}</span></h4>
          <div className="in">
            {h.example && <pre className="lemma-sig" style={{ maxHeight: "none" }}>{h.example}</pre>}
            <p style={{ margin: "4px 0" }} dangerouslySetInnerHTML={{ __html: renderInlineCode(h.explanation) }} />
            <ul style={{ listStyle: "disc", paddingLeft: 18, margin: 0 }}>{h.fixes.map((f, i) => <li key={i} dangerouslySetInnerHTML={{ __html: renderInlineCode(f) }} />)}</ul>
          </div>
        </div>
      ))}
    </div>
  );
}
