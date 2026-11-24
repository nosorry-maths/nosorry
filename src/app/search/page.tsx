import Link from "next/link";
import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { listProblems, PAGE } from "@/lib/data";
import { ProblemEntry, Pager } from "@/components/ui";

export const metadata = { title: "Search" };
export const dynamic = "force-dynamic";

// "Erdős 1196", "erdos #1196", "OEIS 123", an identifier, a slug or a Lean declaration name go straight to the problem.
async function directHit(qs: string): Promise<string | null> {
  const s = qs.trim();
  const exact = await one<{ slug: string }>(
    `SELECT p.slug FROM problems p JOIN problem_versions v ON v.id = p.current_version_id
     WHERE p.slug = lower($1) OR p.ident = upper($1) OR v.decl_name = $1 LIMIT 1`, [s]);
  if (exact) return exact.slug;
  const m = s.match(/^(.+?)\s*(?:problem|conjecture)?\s*(?:#|no\.?|n°)?\s*(\d+)$/i);
  if (m) {
    const hit = await one<{ slug: string }>(
      `SELECT p.slug FROM problems p JOIN collections c ON c.slug = p.collection
       WHERE (ns_fold(c.name) LIKE ns_fold($1) || '%' OR c.slug = ns_fold($1)) AND p.slug = c.slug || '-' || $2 LIMIT 1`, [m[1].trim(), m[2]]);
    if (hit) return hit.slug;
  }
  return null;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; status?: string }> }) {
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 200).trim();
  const status = sp.status ?? "all";
  if (query && !sp.page) {
    const hit = await directHit(query);
    if (hit) redirect(`/p/${hit}`);
  }
  const r = query ? await listProblems({ q: query, status, page: Number(sp.page ?? 1) }) : null;
  return (
    <>
      <h1>Search</h1>
      <form action="/search" style={{ display: "flex", gap: 6, maxWidth: 640, margin: "4px 0 10px" }}>
        <input type="search" name="q" defaultValue={query} autoFocus aria-label="Search term" />
        <select name="status" defaultValue={status} style={{ width: 160 }} aria-label="Status">
          <option value="all">All problems</option><option value="open">Open only</option><option value="solved">Known results</option>
        </select>
        <button className="btn primary">Search</button>
      </form>
      <p className="small muted">Every word must appear (accents ignored) in the title, identifier, Lean declaration name or statement. “Erdős 1196” or <code>Erdos488.erdos_488</code> jump straight to the problem.</p>
      {r && r.total > 0 && <p className="list-meta">Showing {(r.page - 1) * PAGE + 1}–{Math.min(r.page * PAGE, r.total)} of {r.total.toLocaleString("en")} results for <b>{query}</b></p>}
      {r && r.total === 0 && (
        <p>No problem matches “{query}”. Try fewer words, a number alone (e.g. “1196”), or <Link href="/list/math">browse by subject</Link>.</p>
      )}
      {r && <dl className="listing">{r.rows.map((p, i) => <ProblemEntry key={p.id} p={p} n={(r.page - 1) * PAGE + i + 1} />)}</dl>}
      {r && <Pager page={r.page} hasMore={r.hasMore} base={(p) => `/search?q=${encodeURIComponent(query)}&status=${status}&page=${p}`} />}
    </>
  );
}
