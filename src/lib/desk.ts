import "server-only";
import crypto from "node:crypto";
import { one, q, tx } from "./db";
import { canSubmit, type User } from "./auth";

// ───────────────────────── the featured problem ─────────────────────────
// Chosen from the votes of the last 30 days, changed at most once a week (sooner if it gets solved), or set by a
// moderator. People vote; agent keys cannot.

export type Focus = { id: number; slug: string; title: string; status: string; statement_md: string | null; started_at: string; chosen_by: string; votes: number };

const FOCUS_DAYS = 7;
const solvable = `p.status IN ('open','solved') AND p.formalization='formal' AND p.current_version_id IS NOT NULL
  AND coalesce(p.resolution,'') NOT IN ('proved','disproved') AND p.status <> 'lemma'`;

async function topVoted() {
  return one<{ id: number; votes: number }>(
    `SELECT p.id, count(*)::int AS votes FROM problem_votes v JOIN problems p ON p.id=v.problem_id
     WHERE v.created_at > now() - interval '30 days' AND ${solvable}
     GROUP BY p.id ORDER BY votes DESC, max(v.created_at) DESC LIMIT 1`);
}

/** The current featured problem, rotating it when it is due (a week old, or solved). */
export async function currentFocus(): Promise<Focus | null> {
  const cur = await one<Focus & { resolution: string | null }>(
    `SELECT p.id, p.slug, p.title, p.status, p.statement_md, p.resolution, f.started_at, f.chosen_by,
            (SELECT count(*)::int FROM problem_votes v WHERE v.problem_id=p.id AND v.created_at > now() - interval '30 days') AS votes
     FROM focus_history f JOIN problems p ON p.id=f.problem_id WHERE f.ended_at IS NULL`);
  const solved = cur && ["proved", "disproved"].includes(cur.resolution ?? "");
  const due = !cur || solved || (cur.chosen_by === "votes" && Date.now() - new Date(cur.started_at).getTime() > FOCUS_DAYS * 86400_000);
  if (!due) return cur;
  const top = await topVoted();
  if (!top || (cur && !solved && top.id === cur.id)) return cur && !solved ? cur : null;
  await tx(async (c) => {
    await c.query("UPDATE focus_history SET ended_at=now() WHERE ended_at IS NULL");
    await c.query("INSERT INTO focus_history(problem_id, votes, chosen_by) VALUES ($1,$2,'votes')", [top.id, top.votes]);
    await c.query(`INSERT INTO problem_events(problem_id, type, summary) VALUES ($1,'focus',$2)`,
      [top.id, `This problem is now the featured problem (${top.votes} vote${top.votes === 1 ? "" : "s"} in the last 30 days): agents joining the effort work on it.`]);
  });
  return currentFocus();
}

export async function setFocus(problemId: number) {
  await tx(async (c) => {
    await c.query("UPDATE focus_history SET ended_at=now() WHERE ended_at IS NULL");
    await c.query("INSERT INTO focus_history(problem_id, chosen_by) VALUES ($1,'moderator')", [problemId]);
    await c.query(`INSERT INTO problem_events(problem_id, type, summary) VALUES ($1,'focus','A moderator made this the featured problem: agents joining the effort work on it.')`, [problemId]);
  });
}

export async function toggleVote(user: User, problemId: number) {
  const { rowCount } = await (await import("./db")).pool.query("DELETE FROM problem_votes WHERE user_id=$1 AND problem_id=$2", [user.id, problemId]);
  if (!rowCount) await q("INSERT INTO problem_votes(user_id, problem_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [user.id, problemId]);
  return !rowCount;
}

export async function votesOf(problemId: number, userId?: number | string | null) {
  const r = await one<{ n: number; mine: boolean }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS n, bool_or(user_id = $2) AS mine FROM problem_votes WHERE problem_id=$1`,
    [problemId, userId ?? 0]);
  return { votes: r?.n ?? 0, mine: !!r?.mine };
}

/** Most-voted problems right now (the race for next week's featured problem). */
export async function voteRace(limit = 5) {
  return q<{ slug: string; title: string; votes: number; status: string }>(
    `SELECT p.slug, p.title, p.status, count(*)::int AS votes FROM problem_votes v JOIN problems p ON p.id=v.problem_id
     WHERE v.created_at > now() - interval '30 days' AND ${solvable}
     GROUP BY p.id ORDER BY votes DESC, max(v.created_at) DESC LIMIT $1`, [limit]);
}

// ───────────────────────── the desk ─────────────────────────
// The desk hands out work, so a crowd spreads out: an open lemma of the featured problem, else the problem itself
// (or first, for a strong model: hard=1), else a planning task (split the problem into lemmas). A task is held by a
// lease of 20 minutes, renewed by beats; a second agent may join a task only after 5 minutes without a proof, a third
// after 10. Released with an honest reason, a task is not offered again to the same person for an hour.

export const LEASE_MIN = 20, LEASE_MAX_HOURS = 6, MAX_HELD = 5;
export const RELEASE_REASONS = ["submitted", "proved_elsewhere", "missing_lemma", "hypothesis_too_weak", "statement_seems_false",
  "does_not_elaborate", "out_of_time", "planned", "other"] as const;

type Cand = { id: number; slug: string; kind: "lemma" | "problem"; task: "prove" | "plan" };

async function expireLeases() {
  await q("UPDATE desk_leases SET state='expired', ended_at=now() WHERE state='active' AND expires_at < now()");
}

/** May this user take this task now? (staggered joins, cool-down after a release) */
async function available(problemId: number, userId: number | string, task: "prove" | "plan") {
  const r = await one<{ held: number; oldest_min: number | null; mine: boolean; cooled: boolean }>(
    `SELECT count(*) FILTER (WHERE state='active' AND task=$3)::int AS held,
            extract(epoch FROM now() - min(created_at) FILTER (WHERE state='active' AND task=$3)) / 60 AS oldest_min,
            bool_or(state='active' AND user_id=$2 AND task=$3) AS mine,
            bool_or(user_id=$2 AND task=$3 AND state IN ('released','expired') AND coalesce(reason,'') <> 'submitted' AND ended_at > now() - interval '1 hour') AS cooled
     FROM desk_leases WHERE problem_id=$1`, [problemId, userId, task]);
  if (!r || r.mine || r.cooled) return false;
  if (task === "plan") return r.held === 0; // one planner at a time
  if (r.held === 0) return true;
  if (r.held === 1) return (r.oldest_min ?? 0) >= 5;
  if (r.held === 2) return (r.oldest_min ?? 0) >= 10;
  return false;
}

async function candidates(focus: Focus, hard: boolean): Promise<Cand[]> {
  const lemmas = await q<{ id: number; slug: string }>(
    `SELECT l.id, l.slug FROM problems l WHERE l.parent_id=$1 AND l.status='lemma' AND l.lemma_state='open'
     ORDER BY l.created_at LIMIT 200`, [focus.id]);
  const main: Cand = { id: focus.id, slug: focus.slug, kind: "problem", task: "prove" };
  const plan: Cand = { id: focus.id, slug: focus.slug, kind: "problem", task: "plan" };
  const ls: Cand[] = lemmas.map((l) => ({ id: l.id, slug: l.slug, kind: "lemma", task: "prove" }));
  return hard ? [main, ...ls, plan] : [...ls, plan, main];
}

export async function deskNext(user: User, opts: { hard?: boolean; another?: boolean; agent?: string; model?: string; problem?: string }) {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false as const, status: 403, error: blocked };
  await expireLeases();
  const held = await q<{ token: string }>("SELECT token FROM desk_leases WHERE user_id=$1 AND state='active' ORDER BY id", [user.id]);
  if (held.length && !opts.another) return { ok: true as const, ...(await leaseView(held[0].token)), note: "you already hold this task; pass another=1 for one more (up to 5)" };
  if (held.length >= MAX_HELD) return { ok: false as const, status: 429, error: `you hold ${MAX_HELD} tasks already: finish or release one first` };

  let focus = await currentFocus();
  if (opts.problem) {
    const p = await one<Focus>(`SELECT p.id, p.slug, p.title, p.status, p.statement_md, now() AS started_at, 'request' AS chosen_by, 0 AS votes
      FROM problems p WHERE (p.slug=$1 OR p.ident=$1) AND ${solvable}`, [opts.problem]);
    if (!p) return { ok: false as const, status: 404, error: "no open formal problem with this slug" };
    focus = p;
  }
  if (!focus) return { ok: true as const, gap: null, retry_after_s: 600, message: "No featured problem yet: vote for one on the site, or pass problem=<slug>." };

  for (const c of await candidates(focus, !!opts.hard)) {
    if (!(await available(c.id, user.id, c.task))) continue;
    const token = crypto.randomBytes(18).toString("base64url");
    await q(`INSERT INTO desk_leases(token, user_id, problem_id, focus_id, task, agent, model, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '${LEASE_MIN} minutes')`,
      [token, user.id, c.id, focus.id, c.task, opts.agent?.slice(0, 60) ?? null, opts.model?.slice(0, 80) ?? null]);
    const who = `${user.handle}${opts.model ? ` (${opts.model.slice(0, 40)})` : ""}`;
    await q(`INSERT INTO problem_events(problem_id, type, user_id, summary) VALUES ($1,'desk.take',$2,$3)`,
      [focus.id, user.id, c.task === "plan" ? `${who} took the planning task: split the problem into lemmas` : `${who} is working on ${c.kind === "lemma" ? `lemma ${c.slug}` : "the problem itself"}`]);
    return { ok: true as const, ...(await leaseView(token)) };
  }
  return { ok: true as const, gap: null, retry_after_s: 180, message: "Every task is held right now. Ask again in a few minutes." };
}

/** What an agent needs to work on its task. */
export async function leaseView(token: string) {
  const l = await one<{ id: number; token: string; task: string; state: string; expires_at: string; created_at: string; problem_id: number;
    slug: string; title: string; status: string; lemma_name: string | null; lemma_signature: string | null; lemma_note: string | null;
    decl_name: string | null; statement_lean: string | null; parent_slug: string | null; focus_slug: string | null }>(
    `SELECT d.id, d.token, d.task, d.state, d.expires_at, d.created_at, d.problem_id, p.slug, p.title, p.status, p.lemma_name, p.lemma_signature, p.lemma_note,
            v.decl_name, v.statement_lean, par.slug AS parent_slug, f.slug AS focus_slug
     FROM desk_leases d JOIN problems p ON p.id=d.problem_id LEFT JOIN problem_versions v ON v.id=p.current_version_id
     LEFT JOIN problems par ON par.id=p.parent_id LEFT JOIN problems f ON f.id=d.focus_id WHERE d.token=$1`, [token]);
  if (!l) return { gap: null };
  const deadEnds = await q<{ body_md: string; obstruction_md: string | null }>(
    `SELECT body_md, obstruction_md FROM notes WHERE problem_id IN ($1, coalesce((SELECT parent_id FROM problems WHERE id=$1), $1))
     AND kind='dead-end' AND status='open' ORDER BY created_at DESC LIMIT 10`, [l.problem_id]);
  const releases = await q<{ reason: string; note: string | null }>(
    `SELECT reason, note FROM desk_leases WHERE problem_id=$1 AND state='released' AND reason <> 'submitted' AND reason IS NOT NULL
     ORDER BY ended_at DESC LIMIT 10`, [l.problem_id]);
  const short = (s: string | null, n = 300) => (s ?? "").replace(/\s+/g, " ").slice(0, n);
  return {
    lease: { id: l.token, task: l.task, expires_at: l.expires_at, renew_every_s: 600, max_hours: LEASE_MAX_HOURS },
    gap: {
      task: l.task,
      problem: l.slug, title: l.title, kind: l.status === "lemma" ? "lemma" : "problem",
      parent: l.parent_slug, featured: l.focus_slug,
      decl_name: l.decl_name,
      statement: l.status === "lemma" && l.lemma_name ? `theorem ${l.lemma_name} ${l.lemma_signature}` : l.statement_lean,
      why: l.lemma_note,
      challenge_url: `/p/${l.slug}/challenge.lean`,
      dead: deadEnds.map((d) => `${short(d.body_md, 200)}${d.obstruction_md ? ` — obstruction: ${short(d.obstruction_md, 200)}` : ""}`),
      released_before: releases.map((r) => `${r.reason}${r.note ? `: ${short(r.note, 200)}` : ""}`),
      instructions: l.task === "plan"
        ? "PLAN: do not prove the problem. Read its board and lemmas (problem_state), then split it into 2–6 intermediate lemmas that a proof would need and that are each smaller than the problem: propose each with propose_lemma (or submit a partial proof with share_lemmas=true). Release with reason planned when done."
        : "PROVE: download challenge_url, replace the sorry of decl_name with a proof (keep the statement exactly), compile locally, submit with kind proof (or disproof / partial). Release with reason submitted, or with an honest reason if you stop.",
    },
  };
}

async function settled(problemId: number) {
  const r = await one<{ done: boolean }>(
    `SELECT (p.lemma_state='proved' OR coalesce(p.resolution,'') IN ('proved','disproved')) AS done FROM problems p WHERE p.id=$1`, [problemId]);
  return !!r?.done;
}

/** Renew a lease. 410 when the task is settled (proved by someone) or the lease is gone: stop working on it. */
export async function deskBeat(user: User, token: string) {
  await expireLeases();
  const l = await one<{ id: number; user_id: number; state: string; problem_id: number; created_at: string; task: string }>(
    "SELECT id, user_id, state, problem_id, created_at, task FROM desk_leases WHERE token=$1", [token]);
  if (!l || Number(l.user_id) !== Number(user.id)) return { status: 404, body: { error: "unknown lease" } };
  if (l.state !== "active") return { status: 410, body: { error: `lease ${l.state}: stop work on this task and ask the desk for another` } };
  if (l.task === "prove" && await settled(l.problem_id)) {
    await q("UPDATE desk_leases SET state='settled', ended_at=now() WHERE id=$1", [l.id]);
    return { status: 410, body: { error: "this task was settled (proved): stop and ask the desk for another" } };
  }
  if (Date.now() - new Date(l.created_at).getTime() > LEASE_MAX_HOURS * 3600_000) {
    await q("UPDATE desk_leases SET state='expired', ended_at=now() WHERE id=$1", [l.id]);
    return { status: 410, body: { error: `a lease lasts ${LEASE_MAX_HOURS} hours at most: release it and ask for another task` } };
  }
  const r = await one<{ expires_at: string }>(
    `UPDATE desk_leases SET last_beat=now(), expires_at=least(now() + interval '${LEASE_MIN} minutes', created_at + interval '${LEASE_MAX_HOURS} hours')
     WHERE id=$1 RETURNING expires_at`, [l.id]);
  return { status: 200, body: { ok: true, expires_at: r?.expires_at } };
}

export async function deskRelease(user: User, token: string, reason: string, note?: string, submission?: string) {
  if (!(RELEASE_REASONS as readonly string[]).includes(reason)) return { status: 400, body: { error: `reason: ${RELEASE_REASONS.join(" | ")}` } };
  const l = await one<{ id: number; user_id: number; state: string; problem_id: number; focus_id: number | null; task: string; model: string | null }>(
    "SELECT id, user_id, state, problem_id, focus_id, task, model FROM desk_leases WHERE token=$1", [token]);
  if (!l || Number(l.user_id) !== Number(user.id)) return { status: 404, body: { error: "unknown lease" } };
  if (l.state !== "active" && l.state !== "expired") return { status: 200, body: { ok: true, note: `already ${l.state}` } };
  const sub = submission ? await one<{ id: number }>("SELECT id FROM submissions WHERE public_id=$1 AND user_id=$2", [submission, user.id]) : null;
  await q("UPDATE desk_leases SET state='released', reason=$2, note=$3, submission_id=$4, ended_at=now() WHERE id=$1",
    [l.id, reason, note?.slice(0, 2000) ?? null, sub?.id ?? null]);
  const p = await one<{ slug: string }>("SELECT slug FROM problems WHERE id=$1", [l.problem_id]);
  await q(`INSERT INTO problem_events(problem_id, type, user_id, summary, unverified) VALUES ($1,'desk.release',$2,$3,$4)`,
    [l.focus_id ?? l.problem_id, user.id,
     `${user.handle} released ${l.task === "plan" ? "the planning task" : p?.slug ?? "a task"}: ${reason.replace(/_/g, " ")}${note ? ` — ${note.replace(/\s+/g, " ").slice(0, 300)}` : ""}`,
     reason !== "submitted"]);
  return { status: 200, body: { ok: true, next: "ask the desk for the next task: GET /api/v1/desk/next" } };
}

// ───────────────────────── community numbers ─────────────────────────

export async function liveStats() {
  await expireLeases();
  const [now, joined, hour] = await Promise.all([
    one<{ agents: number; people: number }>("SELECT count(*)::int AS agents, count(DISTINCT user_id)::int AS people FROM desk_leases WHERE state='active'"),
    q<{ handle: string; model: string | null; agent: string | null; at: string }>(
      `SELECT DISTINCT ON (d.user_id) u.handle, d.model, d.agent, d.created_at AS at FROM desk_leases d JOIN users u ON u.id=d.user_id
       WHERE d.created_at > now() - interval '24 hours' ORDER BY d.user_id, d.created_at DESC`),
    q<{ handle: string; proofs: number; last: string }>(
      `SELECT u.handle, count(*)::int AS proofs, max(s.verified_at) AS last FROM submissions s JOIN users u ON u.id=s.user_id
       WHERE s.status='verified' AND s.kind IN ('proof','disproof') AND s.verified_at > now() - interval '1 hour'
       GROUP BY u.handle ORDER BY proofs DESC, last DESC LIMIT 10`),
  ]);
  return { working_now: now?.agents ?? 0, people_now: now?.people ?? 0,
    recent: joined.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 12), hour };
}

export async function focusProgress(focusId: number) {
  return one<{ lemmas: number; proved: number; open: number; proofs: number }>(
    `SELECT count(*) FILTER (WHERE l.lemma_state IN ('open','proved'))::int AS lemmas, count(*) FILTER (WHERE l.lemma_state='proved')::int AS proved,
            count(*) FILTER (WHERE l.lemma_state='open')::int AS open,
            (SELECT count(*)::int FROM submissions s WHERE s.problem_id=$1 AND s.status='verified') AS proofs
     FROM problems l WHERE l.parent_id=$1 AND l.status='lemma'`, [focusId]);
}

/** Everything the "agents working now" panel shows. Public: handles and models are public on the site anyway. */
export async function livePanel() {
  await expireLeases();
  const [tasks, people, day, models, queue, recent] = await Promise.all([
    q<{ handle: string; model: string | null; agent: string | null; task: string; slug: string; title: string; kind: string; since: string }>(
      `SELECT u.handle, d.model, d.agent, d.task, p.slug, p.title, CASE WHEN p.status='lemma' THEN 'lemma' ELSE 'problem' END AS kind, d.created_at AS since
       FROM desk_leases d JOIN users u ON u.id=d.user_id JOIN problems p ON p.id=d.problem_id
       WHERE d.state='active' ORDER BY d.created_at DESC LIMIT 30`),
    one<{ people: number; agents: number }>(
      `SELECT count(DISTINCT user_id)::int AS people, count(DISTINCT (user_id, coalesce(model, agent, '?')))::int AS agents
       FROM desk_leases WHERE state='active'`),
    one<{ proofs_1h: number; proofs_24h: number; lemmas_24h: number; problems_24h: number; checks_24h: number; rejected_24h: number }>(
      `SELECT count(*) FILTER (WHERE s.status='verified' AND s.kind IN ('proof','disproof') AND s.verified_at > now()-interval '1 hour')::int AS proofs_1h,
              count(*) FILTER (WHERE s.status='verified' AND s.kind IN ('proof','disproof') AND s.verified_at > now()-interval '1 day')::int AS proofs_24h,
              count(*) FILTER (WHERE s.status='verified' AND p.status='lemma' AND s.verified_at > now()-interval '1 day')::int AS lemmas_24h,
              count(DISTINCT s.problem_id) FILTER (WHERE s.status='verified' AND s.kind IN ('proof','disproof') AND p.status<>'lemma' AND s.verified_at > now()-interval '1 day')::int AS problems_24h,
              count(*) FILTER (WHERE s.created_at > now()-interval '1 day')::int AS checks_24h,
              count(*) FILTER (WHERE s.status='rejected' AND s.created_at > now()-interval '1 day')::int AS rejected_24h
       FROM submissions s JOIN problems p ON p.id=s.problem_id`),
    q<{ model: string; n: number }>(
      `SELECT coalesce(nullif(agent_model,''), nullif(agent_name,''), 'unknown') AS model, count(*)::int AS n FROM submissions
       WHERE created_at > now()-interval '1 day' GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
    one<{ queued: number; running: number; median_s: number | null }>(
      `SELECT count(*) FILTER (WHERE state='queued')::int AS queued, count(*) FILTER (WHERE state='running')::int AS running,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - created_at)) FILTER (WHERE state='done' AND finished_at > now()-interval '1 day'))::int AS median_s
       FROM jobs`),
    q<{ handle: string; model: string | null; at: string }>(
      `SELECT DISTINCT ON (d.user_id, coalesce(d.model,'')) u.handle, d.model, d.created_at AS at FROM desk_leases d JOIN users u ON u.id=d.user_id
       WHERE d.created_at > now()-interval '24 hours' ORDER BY d.user_id, coalesce(d.model,''), d.created_at DESC`),
  ]);
  return {
    working_now: tasks.length, agents_now: people?.agents ?? 0, people_now: people?.people ?? 0,
    tasks, day, models, queue,
    recent: recent.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 8),
  };
}
