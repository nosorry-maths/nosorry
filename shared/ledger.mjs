// Single source of truth for proof points. Used by the worker and by moderation actions.
//
// rescoreProblem() recomputes what every verified proof/disproof of a problem *should* have earned,
// compares it with the active (non-reversed) ledger entries, and writes only the difference:
// reversing entries for awards that are no longer right, new entries for missing ones.
// Consequences:
//   • priority goes to the earliest *submitted* valid proof, not the first one to finish verifying;
//   • when the first proof is revoked, the next one is promoted (with a visible ledger trail);
//   • running it twice changes nothing (idempotent), so double payment is impossible.

import { proofPoints } from "./scoring.mjs";

const LOCK_NS = 7001; // advisory-lock namespace for "proof awards"

/** @param {any} c pg client in a transaction  @param {number} pid  @param {number | null} [actorId] */
export async function rescoreProblem(c, pid, actorId = null) {
  await c.query("SELECT pg_advisory_xact_lock($1, $2)", [LOCK_NS, Number(pid)]);
  const { rows: [pr] } = await c.query(
    `SELECT p.id, p.status, p.statement_status,
            (SELECT created_by FROM problem_versions WHERE problem_id=p.id ORDER BY version LIMIT 1) AS formalized_by
     FROM problems p WHERE p.id=$1`, [pid]);
  if (!pr) return;
  // Points are frozen while the statement is not trusted.
  const frozen = !["reviewed", "frozen"].includes(pr.statement_status);
  const { rows: valid } = await c.query(
    `SELECT id, user_id, kind FROM submissions
     WHERE problem_id=$1 AND kind IN ('proof','disproof') AND status='verified'
     ORDER BY created_at, id`, [pid]);

  // Desired awards: one per user, earliest submission first.
  const desired = new Map(); // submission id -> {user_id, delta, reason}
  if (!frozen) {
    const seenUsers = new Set();
    let firstGiven = false;
    for (const s of valid) {
      if (seenUsers.has(s.user_id)) continue;
      seenUsers.add(s.user_id);
      // The author of a user formalization cannot take the first-proof bonus on their own statement.
      const eligibleFirst = !firstGiven && s.user_id !== pr.formalized_by;
      const delta = proofPoints(pr.status, eligibleFirst);
      if (eligibleFirst) firstGiven = true;
      if (delta > 0) desired.set(s.id, { user_id: s.user_id, delta, reason: `proof:${eligibleFirst ? "first" : "later"}:${pr.status}` });
    }
  }

  // Active proof awards currently in the ledger for this problem.
  const { rows: active } = await c.query(
    `SELECT e.* FROM point_events e JOIN submissions s ON s.id=e.submission_id
     WHERE s.problem_id=$1 AND e.reason LIKE 'proof:%' AND e.delta > 0
       AND NOT EXISTS (SELECT 1 FROM point_events r WHERE r.reverses_id=e.id)`, [pid]);
  const activeBySub = new Map(active.map((e) => [e.submission_id, e]));

  for (const e of active) {
    const want = desired.get(e.submission_id);
    if (!want || want.delta !== e.delta || want.reason !== e.reason) {
      await c.query(
        `INSERT INTO point_events(user_id, submission_id, delta, reason, note, reverses_id, created_by)
         VALUES ($1,$2,$3,'rescore:reverse',$4,$5,$6)`,
        [e.user_id, e.submission_id, -e.delta, frozen ? "statement not reviewed: points frozen" : "award recomputed (priority or validity changed)", e.id, actorId]);
      activeBySub.delete(e.submission_id);
    }
  }
  for (const [sid, want] of desired) {
    if (activeBySub.has(sid)) continue;
    await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, created_by) VALUES ($1,$2,$3,$4,$5)",
      [want.user_id, sid, want.delta, want.reason, actorId]);
  }

  await c.query(`UPDATE problems p SET
      resolution = CASE WHEN EXISTS (SELECT 1 FROM submissions x WHERE x.problem_id=p.id AND x.kind='proof' AND x.status='verified') THEN 'proved'
                        WHEN EXISTS (SELECT 1 FROM submissions x WHERE x.problem_id=p.id AND x.kind='disproof' AND x.status='verified') THEN 'disproved'
                        ELSE p.external_resolution END,   -- settled by a result verified elsewhere (shared/lefttosolve.mjs)
      updated_at = now()
     WHERE p.id=$1`, [pid]);
  await c.query("UPDATE problems SET solved_on_platform = (resolution IS NOT NULL) WHERE id=$1", [pid]);
}
