// Daily watch of google-deepmind/formal-conjectures (run by the worker; also scripts/fc-watch.mjs).
//
// Compares the commit our statements and verifier image come from (fc_upstream.base_commit) with main:
//   * what needs no Lean is applied at once: title, description, status (open → solved…), subjects, tags — a status
//     change is posted on the problem's stream so agents working on it see it;
//   * what needs a verifier image built from the newer commit is only recorded in fc_pending, for the batch update:
//     new problems, changed statements (by semantic hash), removed problems, a toolchain/Mathlib bump.
// Nothing is ever deleted here, and no statement version is created here.
import { parseSource, semanticHash, subjectsFor } from "./fc-parse.mjs";

const REPO = "google-deepmind/formal-conjectures";
const UA = "nosorry-upstream-watch/1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(path) {
  const headers = { "user-agent": UA, accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
  return r.json();
}
async function raw(rev, file) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${rev}/${file}`, { headers: { "user-agent": UA } });
    if (r.ok) return r.text();
    if (r.status === 404) return null;
    await sleep(2000 * (i + 1));
  }
  throw new Error(`raw ${file}@${rev.slice(0, 8)}: unavailable`);
}

/** Post an "upstream" event on a problem's stream (status changed in formal-conjectures). */
export async function upstreamEvent(db, problemId, from, to, commit) {
  await db.query(`INSERT INTO problem_events(problem_id, type, summary) VALUES ($1,'upstream',$2)`,
    [problemId, `formal-conjectures now lists this problem as ${to} (was ${from})${commit ? ` — commit ${String(commit).slice(0, 8)}` : ""}`]);
}

export async function checkUpstream(db, log = () => {}) {
  const { rows: [st] } = await db.query("SELECT * FROM fc_upstream WHERE id=1");
  let base = st?.base_commit;
  if (!base) {
    const { rows: [r] } = await db.query(`SELECT v.upstream_commit FROM problem_versions v JOIN problems p ON p.current_version_id=v.id
      WHERE p.source_path LIKE 'FormalConjectures/%' AND v.upstream_commit IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
    base = r?.upstream_commit;
    if (!base) throw new Error("no formal-conjectures import found");
  }
  const head = await gh("/commits/main");
  const headSha = head.sha;
  const summary = { changed_files: 0, deleted_files: 0, metadata_updated: 0, metadata_slugs: [], status_changes: [], new: 0, statement: 0, removed: 0, toolchain_changed: false, mathlib_changed: false };
  let aheadBy = 0, baseTool = null, headTool = null;
  const pending = new Map(); // slug -> row

  if (headSha !== base) {
    const cmp = await gh(`/compare/${base}...${headSha}?per_page=1`);
    aheadBy = cmp.ahead_by ?? 0;
    // Whole trees (2 calls) rather than the compare file list, which stops at 300 files.
    const [tb, th] = await Promise.all([gh(`/git/trees/${base}?recursive=1`), gh(`/git/trees/${headSha}?recursive=1`)]);
    if (tb.truncated || th.truncated) throw new Error("repository tree truncated by GitHub");
    const blobs = (t) => new Map(t.tree.filter((x) => x.type === "blob").map((x) => [x.path, x.sha]));
    const B = blobs(tb), H = blobs(th);
    const isProblemFile = (f) => f.startsWith("FormalConjectures/") && f.endsWith(".lean") && !f.startsWith("FormalConjectures/Util/");
    const changed = [...H].filter(([f, s]) => isProblemFile(f) && B.get(f) !== s).map(([f]) => f);
    const deleted = [...B.keys()].filter((f) => isProblemFile(f) && !H.has(f));
    summary.changed_files = changed.length; summary.deleted_files = deleted.length;
    [baseTool, headTool] = await Promise.all([raw(base, "lean-toolchain"), raw(headSha, "lean-toolchain")]).then((x) => x.map((s) => s?.trim() ?? null));
    summary.toolchain_changed = baseTool !== headTool;
    summary.mathlib_changed = B.get("lake-manifest.json") !== H.get("lake-manifest.json");
    log(`upstream: ${aheadBy} commits ahead, ${changed.length} changed and ${deleted.length} deleted problem files`);

    for (const file of changed) {
      const src = await raw(headSha, file);
      await sleep(150);
      if (src == null) continue;
      const decls = parseSource(src, file);
      const seen = new Set();
      for (const p of decls) {
        if (seen.has(p.slug)) continue; // same rule as the importer: the first declaration with a slug wins
        seen.add(p.slug);
        const { rows: [ex] } = await db.query(
          `SELECT pr.id, pr.status, pr.title, v.semantic_hash, v.version FROM problems pr LEFT JOIN problem_versions v ON v.id=pr.current_version_id WHERE pr.slug=$1`, [p.slug]);
        if (!ex) { pending.set(p.slug, { kind: "new", problem_id: null, path: file, title: p.title, status: p.status, detail: p.decl }); continue; }
        // Metadata never needs Lean: apply it now.
        const s = subjectsFor(p);
        const { rowCount } = await db.query(
          `UPDATE problems SET title=$2, statement_md=$3, status = CASE WHEN status IN ('withdrawn','lemma') THEN status ELSE $4 END,
             primary_subject=$5, subjects=$6, tags=$7, source_url=coalesce($8, source_url), needs_answer=$9, updated_at=now()
           WHERE id=$1 AND (title, coalesce(statement_md,''), status, primary_subject, subjects, tags, coalesce(source_url,''), needs_answer)
             IS DISTINCT FROM ($2, coalesce($3,''), CASE WHEN status IN ('withdrawn','lemma') THEN status ELSE $4 END, $5, $6::text[], $7::text[], coalesce($8, source_url, ''), $9)`,
          [ex.id, p.title, p.doc, p.status, s.primary, s.subjects, s.tags, p.refUrl, p.needsAnswer]);
        if (rowCount) { summary.metadata_updated++; if (summary.metadata_slugs.length < 100) summary.metadata_slugs.push(p.slug); }
        if (ex.status !== p.status && !["withdrawn", "lemma"].includes(ex.status)) {
          await upstreamEvent(db, ex.id, ex.status, p.status, headSha);
          summary.status_changes.push(`${p.slug}: ${ex.status} → ${p.status}`);
        }
        const sem = semanticHash(src, p.decl);
        if (sem && ex.semantic_hash && sem !== ex.semantic_hash) {
          pending.set(p.slug, { kind: "statement", problem_id: ex.id, path: file, title: p.title, status: p.status, detail: `statement or a definition it uses changed (current: v${ex.version})` });
        }
      }
      // problems of this file that no longer exist upstream
      const { rows: gone } = await db.query(`SELECT id, slug, title, status FROM problems WHERE source_path=$1 AND status NOT IN ('withdrawn','lemma')`, [file]);
      for (const g of gone) if (!seen.has(g.slug)) pending.set(g.slug, { kind: "removed", problem_id: g.id, path: file, title: g.title, status: g.status, detail: "declaration no longer in the file" });
    }
    for (const file of deleted) {
      const { rows: gone } = await db.query(`SELECT id, slug, title, status FROM problems WHERE source_path=$1 AND status NOT IN ('withdrawn','lemma')`, [file]);
      for (const g of gone) pending.set(g.slug, { kind: "removed", problem_id: g.id, path: file, title: g.title, status: g.status, detail: "file deleted (or moved) upstream" });
    }
  }

  // Pending changes: replace the set (an item that went away upstream disappears), keep first_seen.
  const slugs = [...pending.keys()];
  await db.query(`DELETE FROM fc_pending WHERE NOT (slug = ANY($1::text[]))`, [slugs]);
  for (const [slug, x] of pending) {
    await db.query(`INSERT INTO fc_pending(slug, kind, problem_id, path, title, status, detail, head_commit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (slug) DO UPDATE SET kind=EXCLUDED.kind, problem_id=EXCLUDED.problem_id, path=EXCLUDED.path, title=EXCLUDED.title,
        status=EXCLUDED.status, detail=EXCLUDED.detail, head_commit=EXCLUDED.head_commit, seen_at=now()`,
      [slug, x.kind, x.problem_id, x.path, x.title, x.status, x.detail, headSha]);
  }
  for (const x of pending.values()) summary[x.kind]++;
  summary.status_changes = summary.status_changes.slice(0, 200);
  await db.query(`INSERT INTO fc_upstream(id, base_commit, head_commit, head_date, ahead_by, base_toolchain, head_toolchain, checked_at, ok, summary)
    VALUES (1,$1,$2,$3,$4,$5,$6,now(),true,$7)
    ON CONFLICT (id) DO UPDATE SET base_commit=$1, head_commit=$2, head_date=$3, ahead_by=$4, base_toolchain=coalesce($5, fc_upstream.base_toolchain),
      head_toolchain=coalesce($6, fc_upstream.head_toolchain), checked_at=now(), ok=true, summary=$7`,
    [base, headSha, head.commit?.committer?.date ?? null, aheadBy, baseTool, headTool, JSON.stringify(summary)]);
  log(`upstream: done ${JSON.stringify({ ...summary, status_changes: summary.status_changes.length })}`);
  return summary;
}

/** Daily, one process at a time (advisory lock), like the aiXiv sync. */
export async function maybeCheckUpstream(pool, log, hours = 20) {
  if (process.env.FC_WATCH === "0") return null;
  const c = await pool.connect();
  try {
    const { rows: [l] } = await c.query("SELECT pg_try_advisory_lock(424243) AS ok");
    if (!l.ok) return null;
    try {
      const { rows: [s] } = await c.query("SELECT checked_at, ok FROM fc_upstream WHERE id=1");
      const age = s?.checked_at ? Date.now() - new Date(s.checked_at).getTime() : Infinity;
      if (s?.ok && age < hours * 3600_000) return null;
      if (s && s.ok === false && age < 2 * 3600_000) return null;
      try { return await checkUpstream(pool, log); }
      catch (e) {
        await pool.query(`INSERT INTO fc_upstream(id, checked_at, ok, summary) VALUES (1, now(), false, $1)
          ON CONFLICT (id) DO UPDATE SET checked_at=now(), ok=false, summary=$1`, [JSON.stringify({ error: String(e.message ?? e) })]).catch(() => {});
        throw e;
      }
    } finally { await c.query("SELECT pg_advisory_unlock(424243)").catch(() => {}); }
  } finally { c.release(); }
}
