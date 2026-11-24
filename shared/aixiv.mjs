// Cross-reference with aiXiv (https://aixiv.online), an open archive of AI-assisted research that tracks which problems
// are claimed solved. Once a day: read its problem list and its corpus (public API, no auth, ~20 requests), match them
// with our problems, and store what it records in aixiv_links. Everything stored is a CLAIM recorded by aiXiv, not a
// nosorry verification; pages say so.
//
// Matching is deliberately strict (a wrong "already solved" link would mislead solvers):
//   - Erdős problems: by number (our source path ErdosProblems/<n>.lean ↔ aiXiv erdos_problem / slug erdos-<n>);
//   - other problems: exact equality of normalized names (accents, dashes, "the", punctuation removed), 10+ chars.

const BASE = process.env.AIXIV_URL ?? "https://aixiv.online";
const UA = "nosorry-aixiv-sync/1.0 (+cross-reference of open problems)";
const SETTLING = new Set(["solves", "disproves"]);
const KIND_ORDER = ["solves", "disproves", "formalizes", "partial", "bound", "conditional", "new-proof", "computes", "theorem", "survey"];
const MAX_DETAILS = Number(process.env.AIXIV_MAX_DETAILS ?? 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, as = "json") {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 120_000);
      const r = await fetch(BASE + path, { headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*" }, signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 429) { await sleep(30_000); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
      return as === "json" ? await r.json() : await r.text();
    } catch (e) { last = e; await sleep(3000 * (attempt + 1)); }
  }
  throw last;
}

export function normName(s) {
  return String(s ?? "")
    .split(" · ")[0]
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\$[^$]*\$/g, " ")
    .replace(/[‐-―−-]+/g, " ")
    .replace(/['’`"“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function erdosNumber(p) {
  const m = String(p.source_path ?? "").match(/ErdosProblems\/(\d+)\.lean$/) ?? String(p.slug ?? "").match(/^erdos-(\d+)(?:$|--)/);
  return m ? Number(m[1]) : null;
}

/** aiXiv dates may be partial ("2026-07", "2026"); give a full ISO date or null. */
export function isoDate(s) {
  const m = String(s ?? "").match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  return m ? `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}` : null;
}

const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** Run one sync. `db` is a pg Pool or Client. Returns a summary. */
export async function syncAixiv(db, log = () => {}) {
  await db.query(`INSERT INTO aixiv_sync(id, started_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET started_at=now()`);
  try {
    // 1. aiXiv problems (paged, 500 per page).
    const problems = [];
    for (let offset = 0; offset < 100_000; offset += 500) {
      const page = await get(`/api/v1/problems?format=json&limit=500&offset=${offset}`);
      problems.push(...(page.problems ?? []));
      if (!page.problems?.length || problems.length >= (page.total ?? 0)) break;
      await sleep(1000);
    }
    log(`aixiv: ${problems.length} problems`);

    // 2. The corpus: every result with the problems it is about.
    const corpus = await get("/api/v1/corpus.jsonl", "text");
    const bySlug = new Map();
    let papers = 0;
    for (const line of corpus.split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      papers++;
      for (const r of o.results ?? []) for (const slug of r.problems ?? []) {
        if (!bySlug.has(slug)) bySlug.set(slug, []);
        bySlug.get(slug).push({
          kind: r.kind, statement: clip(r.statement, 500), aixiv_id: o.aixiv_id, title: clip(o.title, 200), date: o.date,
          url: o.url, standing: clip(o.standing, 200), lean: o.lean_formalization ?? null, withdrawn: !!o.withdrawn,
        });
      }
    }
    log(`aixiv: corpus ${papers} papers, results on ${bySlug.size} problems`);

    // 3. Match with our problems.
    const byErdos = new Map(), byName = new Map();
    for (const p of problems) {
      const n = p.erdos_problem ?? (String(p.slug).match(/^erdos-(\d+)$/) ? Number(p.slug.slice(6)) : null);
      if (n) byErdos.set(n, p);
      const k = normName(p.name);
      if (k.length >= 10) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); }
    }
    const { rows: ours } = await db.query(`SELECT id, slug, title, collection, source_path FROM problems WHERE status <> 'lemma'`);
    const links = [];
    for (const q of ours) {
      const n = erdosNumber(q);
      if (n != null) {
        const p = byErdos.get(n);
        if (p) links.push({ q, p, match: "erdos" });
        continue; // never name-match an Erdős problem: its title is generic
      }
      for (const p of byName.get(normName(q.title)) ?? []) links.push({ q, p, match: "name" });
    }
    const linked = links.filter((l) => (bySlug.get(l.p.slug)?.length ?? 0) > 0 || l.p.results > 0);
    log(`aixiv: ${linked.length} links to ${new Set(linked.map((l) => l.q.id)).size} of our problems`);

    // 4. Details (status, erdosproblems.com tracker) for the aiXiv problems we link to — one request per second.
    const details = new Map();
    for (const slug of [...new Set(linked.map((l) => l.p.slug))].slice(0, MAX_DETAILS)) {
      try { details.set(slug, await get(`/api/v1/problems/${encodeURIComponent(slug)}?format=json`)); } catch (e) { log(`aixiv: detail ${slug}: ${e.message}`); }
      await sleep(1000);
    }

    // 5. Replace the table in one transaction.
    const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    const rowsOut = linked.map(({ q, p, match }) => {
      const d = details.get(p.slug);
      const results = (bySlug.get(p.slug) ?? [])
        .sort((a, b) => (a.withdrawn - b.withdrawn) || (rank(a.kind) - rank(b.kind)) || String(b.date).localeCompare(String(a.date)))
        .slice(0, 8);
      const settled = d?.status ? d.status === "resolved" : results.some((r) => SETTLING.has(r.kind) && !r.withdrawn);
      const latest = isoDate(d?.latest ?? p.latest ?? results.map((r) => r.date).sort().pop());
      return [q.id, p.slug, match, clip(p.name, 300), p.url ?? `${BASE}/problems/${p.slug}`, d?.status ?? null, d?.status_text ? clip(d.status_text, 400) : null,
        d?.tracker ? JSON.stringify(d.tracker) : null, JSON.stringify(results), settled, latest];
    });
    const client = typeof db.connect === "function" && db.totalCount !== undefined ? await db.connect() : db;
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM aixiv_links");
      for (let i = 0; i < rowsOut.length; i += 200) {
        const chunk = rowsOut.slice(i, i + 200);
        const vals = chunk.map((_, j) => `(${Array.from({ length: 11 }, (__, k) => `$${j * 11 + k + 1}`).join(",")})`).join(",");
        await client.query(`INSERT INTO aixiv_links(problem_id, aixiv_slug, match, name, url, status, status_text, tracker, results, settled, latest)
          VALUES ${vals} ON CONFLICT DO NOTHING`, chunk.flat());
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { if (client !== db) client.release(); }

    const summary = { aixiv_problems: problems.length, papers, links: rowsOut.length, problems_linked: new Set(rowsOut.map((r) => r[0])).size,
      settled: rowsOut.filter((r) => r[9]).length, by_match: { erdos: rowsOut.filter((r) => r[2] === "erdos").length, name: rowsOut.filter((r) => r[2] === "name").length } };
    await db.query(`UPDATE aixiv_sync SET finished_at=now(), ok=true, summary=$1 WHERE id=1`, [JSON.stringify(summary)]);
    log(`aixiv: done ${JSON.stringify(summary)}`);
    return summary;
  } catch (e) {
    await db.query(`UPDATE aixiv_sync SET finished_at=now(), ok=false, summary=$1 WHERE id=1`, [JSON.stringify({ error: String(e.message ?? e) })]).catch(() => {});
    throw e;
  }
}

/** Run the sync if the last successful one is older than `hours` and no other process holds the lock. */
export async function maybeSyncAixiv(pool, log, hours = 20) {
  if (process.env.AIXIV_SYNC === "0") return null;
  const c = await pool.connect();
  try {
    const { rows: [l] } = await c.query("SELECT pg_try_advisory_lock(424242) AS ok");
    if (!l.ok) return null;
    try {
      const { rows: [s] } = await c.query("SELECT finished_at, ok FROM aixiv_sync WHERE id=1");
      const age = s?.finished_at ? Date.now() - new Date(s.finished_at).getTime() : Infinity;
      if (s?.ok && age < hours * 3600_000) return null;
      if (s && s.ok === false && age < 2 * 3600_000) return null; // failed recently: retry in two hours, not every hour
      return await syncAixiv(pool, log);
    } finally { await c.query("SELECT pg_advisory_unlock(424242)").catch(() => {}); }
  } finally { c.release(); }
}
