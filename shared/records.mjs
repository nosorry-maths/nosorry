// Records on metric challenges. Called by the worker inside the verdict transaction.
// A candidate is compared with the record *at verification time*. It becomes a record only if it improves the
// current best by the challenge threshold (5 % by default); otherwise it is a verified variant.
// Points flow along the lineage through the append-only ledger: author, the records it declared building on,
// and the people whose board notes it cited.

const LOCK_NS = 7002;
export const RECORD_POINTS = { author: 50, lineage: [10, 5, 2], cited: 3, maxCited: 5 };

/** @param {any} c pg client in a transaction */
export async function checkRecord(c, sub, value) {
  await c.query("SELECT pg_advisory_xact_lock($1, $2)", [LOCK_NS, Number(sub.pid)]);
  const { rows: [p] } = await c.query("SELECT metric_name, metric_direction, record_threshold, baseline_value FROM problems WHERE id=$1", [sub.pid]);
  const { rows: [cur] } = await c.query(
    "SELECT r.id, r.value, r.submission_id FROM records r WHERE r.problem_id=$1 AND r.revoked_at IS NULL ORDER BY r.id DESC LIMIT 1", [sub.pid]);
  const best = cur ? Number(cur.value) : p.baseline_value != null ? Number(p.baseline_value) : null;
  const th = Number(p.record_threshold ?? 0.05);
  const better = best == null ? true
    : p.metric_direction === "min" ? value <= best * (1 - th) : value >= best * (1 + th);
  const gain = best == null || best === 0 ? null : (p.metric_direction === "min" ? (best - value) / best : (value - best) / best);
  // Lineage: the record this attempt declared building on.
  const { rows: [basedRec] } = sub.based_on
    ? await c.query("SELECT id FROM records WHERE submission_id=$1", [sub.based_on]) : { rows: [] };
  const rebase = !!(cur && sub.based_on && cur.submission_id !== sub.based_on);
  const { rows: [{ handle }] } = await c.query("SELECT handle FROM users WHERE id=$1", [sub.user_id]);
  const pct = gain == null ? "" : ` (${(gain * 100).toFixed(1)} % better)`;

  if (!better) {
    await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary) VALUES ($1,'verified',$2,'submission',$3,$4)`,
      [sub.pid, sub.user_id, sub.id, `Verified variant by ${handle}: ${p.metric_name} = ${value} (record ${best}; threshold ${(th * 100).toFixed(0)} %)`]);
    return { record: false, value, best, rebase };
  }
  const { rows: [rec] } = await c.query(
    `INSERT INTO records(problem_id, submission_id, user_id, value, previous_id, based_on_id, gain) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [sub.pid, sub.id, sub.user_id, value, cur?.id ?? null, basedRec?.id ?? null, gain]);
  const award = (userId, delta, reason, note) => c.query(
    "INSERT INTO point_events(user_id, submission_id, delta, reason, note) VALUES ($1,$2,$3,$4,$5)", [userId, sub.id, delta, reason, note]);
  await award(sub.user_id, RECORD_POINTS.author, "record:new", `${p.metric_name} = ${value}${pct}`);
  // Lineage: up to three generations of declared ancestors, each person credited once.
  const credited = new Set([Number(sub.user_id)]);
  let anc = basedRec?.id ?? null;
  for (let i = 0; anc && i < RECORD_POINTS.lineage.length; i++) {
    const { rows: [a] } = await c.query("SELECT id, user_id, based_on_id FROM records WHERE id=$1 AND revoked_at IS NULL", [anc]);
    if (!a) break;
    if (!credited.has(Number(a.user_id))) { credited.add(Number(a.user_id)); await award(a.user_id, RECORD_POINTS.lineage[i], "record:lineage", `ancestor of record #${rec.id}`); }
    anc = a.based_on_id;
  }
  // Cited board notes: their authors share the credit, and the notes count as picked up.
  const cites = Array.isArray(sub.cites) ? sub.cites : [];
  let n = 0;
  for (const ct of cites) {
    if (ct.type !== "note" || n >= RECORD_POINTS.maxCited) continue;
    const { rows: [note] } = await c.query("UPDATE notes SET picked_up = picked_up + 1 WHERE id=$1 AND problem_id=$2 RETURNING user_id", [ct.id, sub.pid]);
    if (note && !credited.has(Number(note.user_id))) { credited.add(Number(note.user_id)); n++; await award(note.user_id, RECORD_POINTS.cited, "record:cited", `idea cited by record #${rec.id}`); }
  }
  // The author's active leads on this problem close as "record".
  await c.query("UPDATE leads SET status='closed', outcome='record', record_id=$3, closed_at=now() WHERE problem_id=$1 AND user_id=$2 AND status IN ('active','stale')",
    [sub.pid, sub.user_id, rec.id]);
  await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary) VALUES ($1,'record',$2,'record',$3,$4)`,
    [sub.pid, sub.user_id, rec.id, `New record by ${handle}: ${p.metric_name} = ${value}${pct}`]);
  await c.query("UPDATE problems SET updated_at=now() WHERE id=$1", [sub.pid]);
  return { record: true, record_id: Number(rec.id), value, best, gain, rebase };
}
