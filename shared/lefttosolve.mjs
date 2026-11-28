// Mirror of Left to Solve (https://lefttosolve.com, repository lefttosolve2/open-math-agents).
//   - stream (every 10 minutes): GET /api/solved, every result merged there (proof, disproof, reduction step, statement
//     found misstated, proof pending review), with the pull request that carries it;
//   - catalogue (once a day): GET /api/problems, paged by 200, one request per second.
// Their problem ids for statements from google-deepmind/formal-conjectures are the Lean declaration names, which we also
// store (problem_versions.decl_name): that is the only match we make — exact, so a link never points at the wrong problem.
// Reduction steps are "<id>.R<n>.H<k>" (recursively); they attach to the problem they ultimately serve.
// Everything stored is what that site records (its CI checks proofs against its own pinned statements), not a nosorry
// verification; pages say so and link to the pull request.

import { semanticHash } from "./fc-parse.mjs";

const BASE = process.env.LTS_URL ?? "https://lefttosolve.com";
const FC_RAW = "https://raw.githubusercontent.com/google-deepmind/formal-conjectures";
const UA = "nosorry-lefttosolve-sync/1.0 (+mirror of results, links back to each pull request)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** The problem a reduction step ultimately serves: "Erdos723.erdos_723.R1.H2.R1.H1" → "Erdos723.erdos_723". */
export const rootOf = (id) => String(id).replace(/(?:\.R\d+\.H\d+)+$/, "");

async function get(path) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 120_000);
      const r = await fetch(BASE + path, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 429) { await sleep(30_000); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
      return await r.json();
    } catch (e) { last = e; await sleep(3000 * (attempt + 1)); }
  }
  throw last;
}

/** decl name → our problem id (current statement version; lemmas excluded). */
async function declMap(db) {
  const { rows } = await db.query(`SELECT p.id, v.decl_name FROM problems p JOIN problem_versions v ON v.id = p.current_version_id
    WHERE p.status <> 'lemma' AND v.decl_name IS NOT NULL ORDER BY p.id`);
  const m = new Map();
  for (const r of rows) if (!m.has(r.decl_name)) m.set(r.decl_name, Number(r.id));
  return m;
}

async function upsertItems(db, items) {
  for (let i = 0; i < items.length; i += 300) {
    const chunk = items.slice(i, i + 300);
    const vals = chunk.map((_, j) => `(${Array.from({ length: 12 }, (__, k) => `$${j * 12 + k + 1}`).join(",")})`).join(",");
    await db.query(`INSERT INTO lts_items(lts_id, title, source, kind, excerpt, fields, difficulty, solved, claimed, root_id, problem_id, in_catalog)
      VALUES ${vals}
      ON CONFLICT (lts_id) DO UPDATE SET
        title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE lts_items.title END,
        source = coalesce(EXCLUDED.source, lts_items.source), kind = coalesce(EXCLUDED.kind, lts_items.kind),
        excerpt = coalesce(EXCLUDED.excerpt, lts_items.excerpt),
        fields = CASE WHEN cardinality(EXCLUDED.fields) > 0 THEN EXCLUDED.fields ELSE lts_items.fields END,
        difficulty = coalesce(EXCLUDED.difficulty, lts_items.difficulty),
        solved = EXCLUDED.solved OR (lts_items.solved AND NOT EXCLUDED.in_catalog),
        claimed = EXCLUDED.claimed, problem_id = EXCLUDED.problem_id,
        match = CASE WHEN EXCLUDED.problem_id IS NULL THEN NULL ELSE 'decl' END,
        in_catalog = lts_items.in_catalog OR EXCLUDED.in_catalog, updated_at = now()`,
      chunk.flatMap((x) => [x.lts_id, x.title, x.source, x.kind, x.excerpt, x.fields, x.difficulty, x.solved, x.claimed, x.root_id, x.problem_id, x.in_catalog]));
  }
  await db.query(`UPDATE lts_items SET match='decl' WHERE problem_id IS NOT NULL AND match IS NULL`);
}

/** The repository was transferred to lefttosolve2; old pull request links (still redirected by GitHub) use its new home. */
const prUrl = (u) => String(u).replace(/^https:\/\/github\.com\/GuillaumeBAUD-coder\/open-math-agents\//, "https://github.com/lefttosolve2/open-math-agents/");

/** The stream of merged results. Returns how many events were new. */
export async function syncStream(db, log = () => {}) {
  const d = await get("/api/solved");
  const solved = Array.isArray(d.solved) ? d.solved : [];
  const decls = await declMap(db);
  const items = new Map();
  const events = [];
  for (const s of solved) {
    if (!s.problem_id || !s.pr_url || !s.outcome) continue;
    const root = rootOf(s.problem_id);
    const pid = decls.get(root) ?? null;
    events.push([s.problem_id, s.outcome, s.polarity ?? null, clip(s.handle, 80) || null, clip(s.agent, 80) || null, clip(s.model, 120) || null,
      prUrl(s.pr_url), Number.isFinite(s.points) ? s.points : null, clip(s.title, 300), !!s.step, s.created_at ?? null, pid]);
    if (!items.has(s.problem_id)) items.set(s.problem_id, {
      lts_id: s.problem_id, title: clip(s.title, 300), source: null, kind: s.step ? "step" : null, excerpt: null, fields: [], difficulty: null,
      solved: ["open", "known", "warmup", "step"].includes(s.outcome), claimed: false, root_id: root, problem_id: pid, in_catalog: false });
    else if (["open", "known", "warmup", "step"].includes(s.outcome)) items.get(s.problem_id).solved = true;
  }
  await upsertItems(db, [...items.values()]);
  let added = 0;
  for (let i = 0; i < events.length; i += 300) {
    const chunk = events.slice(i, i + 300);
    const vals = chunk.map((_, j) => `(${Array.from({ length: 12 }, (__, k) => `$${j * 12 + k + 1}`).join(",")})`).join(",");
    const r = await db.query(`INSERT INTO lts_events(lts_id, outcome, polarity, handle, agent, model, pr_url, points, title, step, created_at, problem_id)
      VALUES ${vals} ON CONFLICT (lts_id, pr_url, outcome) DO UPDATE SET problem_id = EXCLUDED.problem_id
      RETURNING (xmax = 0) AS inserted`, chunk.flat());
    added += r.rows.filter((x) => x.inserted).length;
  }
  const matched = events.filter((e) => e[11] != null).length;
  log(`lefttosolve: stream ${events.length} results (${added} new, ${matched} on our problems)`);
  return { results: events.length, new: added, on_our_problems: matched };
}

// Settled HERE by a result verified THERE — only when the statement pinned there is the same as ours.
const LOCAL_RES = `(CASE WHEN EXISTS (SELECT 1 FROM submissions x WHERE x.problem_id=p.id AND x.kind='proof' AND x.status='verified') THEN 'proved'
                        WHEN EXISTS (SELECT 1 FROM submissions x WHERE x.problem_id=p.id AND x.kind='disproof' AND x.status='verified') THEN 'disproved' END)`;

/** Their pinned formal-conjectures commit (all their formal-conjectures statements are taken from it). */
async function pinnedCommit() {
  const d = await get("/api/problems?limit=1");
  const c = d?.upstream?.commit;
  return typeof c === "string" && /^[0-9a-f]{40}$/.test(c) ? c : null;
}

async function rawFile(commit, path, cache) {
  const k = `${commit}:${path}`;
  if (cache.has(k)) return cache.get(k);
  let txt = null;
  try {
    const r = await fetch(`${FC_RAW}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: { "user-agent": UA } });
    if (r.ok) txt = await r.text();
  } catch { /* network: retried next run */ }
  cache.set(k, txt);
  return txt;
}

/**
 * Apply results merged on Left to Solve to our problems: a proof (or disproof) merged there of the same declaration,
 * not followed by a "misstated" report, settles our problem IF the statement they pin has the same semantic
 * fingerprint as ours (shared/fc-parse.mjs semanticHash on both files). Results that went away are withdrawn.
 */
export async function settleFromLts(db, log = () => {}, { maxChecks = 400, announce = true } = {}) {
  const commit = await pinnedCommit();
  if (!commit) { log("lefttosolve: no pinned commit, settlement skipped"); return { settle_skipped: true }; }
  const { rows: cands } = await db.query(`
    SELECT DISTINCT ON (p.id) p.id, p.source_path, v.id AS vid, v.decl_name, v.challenge_source, v.upstream_commit,
           e.polarity, e.pr_url, e.handle, e.model, e.agent, e.created_at, e.lts_id
    FROM lts_events e JOIN problems p ON p.id = e.problem_id JOIN problem_versions v ON v.id = p.current_version_id
    WHERE NOT e.step AND e.lts_id = v.decl_name AND e.outcome IN ('open', 'known', 'warmup')
      AND NOT EXISTS (SELECT 1 FROM lts_events m WHERE m.lts_id = e.lts_id AND m.outcome = 'misstated' AND m.created_at >= e.created_at)
    ORDER BY p.id, e.created_at DESC`);
  const cache = new Map();
  let checked = 0;
  const desired = new Map();
  for (const c of cands) {
    let { rows: [chk] } = await db.query("SELECT same FROM lts_statement_checks WHERE problem_version_id=$1 AND commit=$2", [c.vid, commit]);
    if (!chk) {
      if (checked >= maxChecks) continue;   // the rest on the next run
      let same = null, note = null;
      if (c.upstream_commit === commit) { same = true; note = "same commit"; }
      else if (!c.source_path || !c.challenge_source) note = "no source to compare";
      else {
        checked++;
        const theirs = await rawFile(commit, c.source_path, cache);
        if (theirs == null) note = "file not found at their commit";
        else {
          const a = semanticHash(c.challenge_source, c.decl_name), b = semanticHash(theirs, c.decl_name);
          if (a == null || b == null) note = "declaration not found"; else { same = a === b; note = same ? "same statement" : "statement differs"; }
        }
        await sleep(150);
      }
      await db.query("INSERT INTO lts_statement_checks(problem_version_id, commit, same, note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [c.vid, commit, same, note]);
      chk = { same };
    }
    if (chk.same === true) desired.set(Number(c.id), {
      res: c.polarity === "disproof" ? "disproved" : "proved",
      origin: { site: "Left to Solve", site_url: BASE, url: c.pr_url, problem_url: `${BASE}/p/${encodeURIComponent(c.lts_id)}`, handle: c.handle, model: c.model,
        agent: c.agent, at: c.created_at, commit },
    });
  }
  // Withdraw what is no longer backed (result removed, reported misstated, statement changed on either side).
  const { rows: cur } = await db.query("SELECT id, external_resolution, external_origin->>'url' AS url FROM problems WHERE external_resolution IS NOT NULL");
  const touched = new Set();
  for (const r of cur) if (!desired.has(Number(r.id))) {
    await db.query("UPDATE problems SET external_resolution=NULL, external_origin=NULL WHERE id=$1", [r.id]);
    touched.add(Number(r.id));
  }
  const curBy = new Map(cur.map((r) => [Number(r.id), r]));
  let added = 0;
  for (const [id, d] of desired) {
    const was = curBy.get(id);
    if (was && was.external_resolution === d.res && was.url === d.origin.url) continue;
    await db.query("UPDATE problems SET external_resolution=$2, external_origin=$3 WHERE id=$1", [id, d.res, JSON.stringify(d.origin)]);
    touched.add(id);
    if (!was) {
      added++;
      if (announce) await db.query(`INSERT INTO problem_events(problem_id, type, ref_type, summary, unverified)
        VALUES ($1, 'verified', 'external', $2, false)`, [id, `Settled on Left to Solve (${d.res}) by ${d.origin.handle ?? "an agent"}: ${d.origin.url}`]).catch(() => {});
    }
  }
  if (touched.size) await db.query(`UPDATE problems p SET resolution = coalesce(${LOCAL_RES}, p.external_resolution),
      solved_on_platform = coalesce(${LOCAL_RES}, p.external_resolution) IS NOT NULL, updated_at = now() WHERE p.id = ANY($1)`, [[...touched]]);
  const out = { settled_here: desired.size, settled_new: added, withdrawn: [...touched].filter((i) => !desired.has(i)).length, statement_checks: checked, pinned_commit: commit };
  log(`lefttosolve: ${JSON.stringify(out)}`);
  return out;
}

/** The whole catalogue (about 62,000 problems, 200 per page). */
export async function syncCatalog(db, log = () => {}) {
  const decls = await declMap(db);
  const all = [];
  for (let offset = 0; offset < 200_000; offset += 200) {
    const page = await get(`/api/problems?limit=200&offset=${offset}`);
    const its = page.items ?? [];
    all.push(...its);
    if (!its.length || all.length >= (page.total ?? 0)) break;
    await sleep(1000);
  }
  const items = all.filter((x) => x?.id).map((x) => {
    const root = rootOf(x.id);
    return { lts_id: x.id, title: clip(x.title, 300), source: clip(x.source, 120) || null, kind: clip(x.kind, 40) || null, excerpt: x.excerpt ? clip(x.excerpt, 600) : null,
      fields: Array.isArray(x.fields) ? x.fields.slice(0, 8).map((f) => clip(f, 60)) : [], difficulty: Number.isFinite(x.difficulty) ? x.difficulty : null,
      solved: !!x.solved, claimed: !!x.claimed, root_id: root, problem_id: decls.get(root) ?? null, in_catalog: true };
  });
  await upsertItems(db, items);
  const matched = items.filter((x) => x.problem_id != null).length;
  log(`lefttosolve: catalogue ${items.length} problems (${matched} match ours)`);
  return { catalogue: items.length, catalogue_matched: matched };
}

/** Called by the worker every few minutes: stream every 10 minutes, catalogue every 20 hours; one process at a time. */
export async function maybeSyncLeftToSolve(pool, log) {
  if (process.env.LTS_SYNC === "0") return null;
  const c = await pool.connect();
  try {
    const { rows: [l] } = await c.query("SELECT pg_try_advisory_lock(424243) AS ok");
    if (!l.ok) return null;
    try {
      await c.query("INSERT INTO lts_sync(id) VALUES (1) ON CONFLICT DO NOTHING");
      const { rows: [s] } = await c.query("SELECT stream_at, catalog_at, summary FROM lts_sync WHERE id=1");
      const age = (t) => (t ? Date.now() - new Date(t).getTime() : Infinity);
      const out = { ...(s?.summary ?? {}) };
      let ok = true;
      if (age(s?.stream_at) > 9 * 60_000) {
        try {
          Object.assign(out, await syncStream(c, log), { stream_error: undefined });
          // the first settlement backfills ~1,800 problems: no activity event for each, only for later ones
          Object.assign(out, await settleFromLts(c, log, { announce: s?.summary?.settled_here !== undefined }));
          await c.query("UPDATE lts_sync SET stream_at=now() WHERE id=1");
        }
        catch (e) { ok = false; out.stream_error = String(e.message ?? e); log("lefttosolve stream failed", out.stream_error); }
      }
      if (age(s?.catalog_at) > 20 * 3600_000) {
        try { Object.assign(out, await syncCatalog(c, log), { catalog_error: undefined }); await c.query("UPDATE lts_sync SET catalog_at=now() WHERE id=1"); }
        catch (e) { ok = false; out.catalog_error = String(e.message ?? e); log("lefttosolve catalogue failed", out.catalog_error); }
      }
      await c.query("UPDATE lts_sync SET ok=$1, summary=$2 WHERE id=1", [ok, JSON.stringify(out)]);
      return out;
    } finally { await c.query("SELECT pg_advisory_unlock(424243)").catch(() => {}); }
  } finally { c.release(); }
}
