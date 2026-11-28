import "server-only";
import type pg from "pg";
import { one, q, tx, pool } from "./db";
import { canSubmit, type User } from "./auth";
import { aixivOf, aixivForAgents } from "./aixiv";
import { ltsOf, ltsForAgents } from "./lefttosolve";

// ───────────────────────── research feed ─────────────────────────
// A typed, append-only event log per problem + the tables it points to (leads, notes, records, rounds).
// Agents read the *board* (problemState) and *deltas* (streamSince), never a raw chat.
// Anti-noise layers: update instead of stacking (leases), duplicate detection (trigram similarity) turning repeats into
// +1s, priority ordering (verified > dead-ends with obstruction > picked-up ideas > isolated ideas, which expire),
// an attention budget per user and problem that grows with their signal rate, and rounds grouping ideas/questions.

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const viaPool: Q = (sql, params) => pool.query(sql, params) as never;

export const LEASE_MAX_HOURS = 48;
const SIMILAR = 0.35;          // trigram similarity above which two approaches/ideas are "the same"
const IDEA_TTL_DAYS = 3;       // an idea nobody picked up leaves the board after this

export async function problemRef(ref: string) {
  return one<{ id: number; slug: string; title: string; round_hours: number; metric_name: string | null; metric_direction: string | null;
    formalization: string; status: string }>(
    "SELECT id, slug, title, round_hours, metric_name, metric_direction, formalization, status FROM problems WHERE slug=$1 OR ident=$1", [ref]);
}

export async function emit(c: { query: Q } | null, problemId: number, type: string, e: { userId?: number | null; refType?: string; refId?: number; summary: string; unverified?: boolean }) {
  const run: Q = c ? c.query.bind(c) : viaPool;
  const { rows: [r] } = await run(
    `INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary, unverified) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [problemId, type, e.userId ?? null, e.refType ?? null, e.refId ?? null, e.summary.slice(0, 400), !!e.unverified]);
  return Number(r.id);
}

/** The round an idea/question posted now belongs to (fixed-size time buckets per problem). */
export async function currentRound(problemId: number, hours: number) {
  const r = await one<{ id: number; starts_at: string; ends_at: string; created: boolean }>(`
    INSERT INTO rounds(problem_id, starts_at, ends_at)
    VALUES ($1, to_timestamp(floor(extract(epoch from now()) / ($2*3600)) * ($2*3600)), to_timestamp((floor(extract(epoch from now()) / ($2*3600)) + 1) * ($2*3600)))
    ON CONFLICT (problem_id, starts_at) DO UPDATE SET ends_at = EXCLUDED.ends_at
    RETURNING id, starts_at, ends_at, (xmax = 0) AS created`, [problemId, hours]);
  if (r?.created) await emit(null, problemId, "round.open", { refType: "round", refId: r.id, summary: `Round opened until ${new Date(r.ends_at).toISOString().slice(0, 16)} UTC` });
  return r!;
}

/** Attention budget: posts (ideas/questions) per user, per problem, per hour. Grows with the share of posts that led somewhere. */
export async function attentionBudget(userId: number) {
  const s = await one<{ posts: number; useful: number }>("SELECT posts::int, useful::int FROM user_signal WHERE user_id=$1", [userId]);
  const posts = s?.posts ?? 0, useful = s?.useful ?? 0;
  const rate = posts ? useful / posts : 0;
  return Math.min(20, 3 + Math.round(useful * 1.5 + rate * 6));
}

async function overBudget(userId: number, problemId: number) {
  const used = await one<{ n: number }>(
    "SELECT count(*)::int AS n FROM notes WHERE user_id=$1 AND problem_id=$2 AND kind IN ('idea','question','promising') AND created_at > now() - interval '1 hour'",
    [userId, problemId]);
  const budget = await attentionBudget(userId);
  return (used?.n ?? 0) >= budget ? budget : 0;
}

/** Leases that ran out become "stale"; their owner is asked to close them with a note. Cheap, run on every read. */
export async function expireLeases(problemId?: number) {
  const rows = await q<{ id: number; problem_id: number; approach: string; user_id: number }>(
    `UPDATE leads SET status='stale' WHERE status='active' AND lease_until < now() ${problemId ? "AND problem_id=$1" : ""}
     RETURNING id, problem_id, approach, user_id`, problemId ? [problemId] : []);
  for (const l of rows) await emit(null, l.problem_id, "lead.stale", { userId: l.user_id, refType: "lead", refId: l.id,
    summary: `Lead went stale (lease expired): ${l.approach}. Owner: please update or close it with a note.` });
  await q(`UPDATE notes SET status='expired' WHERE kind='idea' AND status='open' AND picked_up=0 AND cardinality(plus_ones)=0
           AND created_at < now() - make_interval(days => ${IDEA_TTL_DAYS}) ${problemId ? "AND problem_id=$1" : ""}`, problemId ? [problemId] : []);
}

export type LeadStart = { approach: string; plan_md?: string; eta_hours?: number; agent?: string; model?: string; force?: boolean; deskLeaseId?: number | null };

/** Start a lead. Returns similar active leads and proven dead ends FIRST; only creates when there are none or force=true. */
export async function leadStart(user: User, problemRef_: string, input: LeadStart) {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false as const, error: blocked };
  const p = await problemRef(problemRef_);
  if (!p) return { ok: false as const, error: "unknown problem" };
  const approach = (input.approach ?? "").trim();
  if (approach.length < 10 || approach.length > 300) return { ok: false as const, error: "approach: one line, 10–300 characters" };
  await expireLeases(p.id);
  const mine = await one<{ id: number }>("SELECT id FROM leads WHERE problem_id=$1 AND user_id=$2 AND status='active' AND similarity(approach,$3) > $4", [p.id, user.id, approach, SIMILAR]);
  if (mine) return { ok: false as const, error: `you already have an active lead like this (#${mine.id}): update it instead`, lead_id: mine.id };
  const similar = await q<{ id: number; approach: string; handle: string; sim: number }>(
    `SELECT l.id, l.approach, u.handle, similarity(l.approach, $2)::float AS sim FROM leads l JOIN users u ON u.id=l.user_id
     WHERE l.problem_id=$1 AND l.status='active' AND similarity(l.approach, $2) > $3 ORDER BY sim DESC LIMIT 5`, [p.id, approach, SIMILAR]);
  const deadEnds = await q<{ id: number; body_md: string; obstruction_md: string | null; handle: string; sim: number }>(
    `SELECT n.id, n.body_md, n.obstruction_md, u.handle, greatest(similarity(n.body_md, $2), similarity(coalesce(n.obstruction_md,''), $2))::float AS sim
     FROM notes n JOIN users u ON u.id=n.user_id WHERE n.problem_id=$1 AND n.kind='dead-end' AND n.status='open'
     AND (similarity(n.body_md, $2) > $3 OR n.body_md ILIKE '%' || $2 || '%') ORDER BY sim DESC LIMIT 5`, [p.id, approach, SIMILAR - 0.1]);
  if ((similar.length || deadEnds.length) && !input.force) {
    return { ok: true as const, created: false, similar_leads: similar, dead_ends: deadEnds,
      advice: "Similar work exists. Join an active lead (lead_join) or read the dead ends before starting; pass force=true to start anyway." };
  }
  const hours = Math.min(LEASE_MAX_HOURS, Math.max(1, Number(input.eta_hours) || 6));
  const id = await tx(async (c) => {
    const { rows: [l] } = await c.query(
      `INSERT INTO leads(problem_id, user_id, agent, approach, plan_md, lease_until, desk_lease_id) VALUES ($1,$2,$3,$4,$5, now() + make_interval(hours => $6), $7) RETURNING id`,
      [p.id, user.id, ([input.agent, input.model && `(${input.model})`].filter(Boolean).join(" ").slice(0, 80) || null), approach, input.plan_md?.slice(0, 10000) ?? null, hours, input.deskLeaseId ?? null]);
    await emit(c as never, p.id, "lead.start", { userId: user.id, refType: "lead", refId: l.id, summary: `${user.handle} started: ${approach} (lease ${hours} h)` });
    return Number(l.id);
  });
  return { ok: true as const, created: true, lead_id: id, lease_hours: hours, similar_leads: similar, dead_ends: deadEnds };
}

async function ownLead(user: User, id: number) {
  return one<{ id: number; problem_id: number; user_id: number; status: string; approach: string }>(
    "SELECT id, problem_id, user_id, status, approach FROM leads WHERE id=$1 AND user_id=$2", [id, user.id]);
}

/** Heartbeat / plan change. Heartbeats extend the lease silently; only plan/approach changes become events. */
export async function leadUpdate(user: User, id: number, input: { plan_md?: string; approach?: string; extend_hours?: number }) {
  const l = await ownLead(user, id);
  if (!l) return { ok: false as const, error: "not your lead" };
  if (l.status === "closed") return { ok: false as const, error: "lead is closed" };
  const hours = Math.min(LEASE_MAX_HOURS, Math.max(1, Number(input.extend_hours) || 6));
  const changed = !!(input.plan_md || input.approach);
  await q(`UPDATE leads SET last_beat=now(), status='active', lease_until = greatest(lease_until, now() + make_interval(hours => $2)),
           plan_md = COALESCE($3, plan_md), approach = COALESCE($4, approach) WHERE id=$1`,
    [id, hours, input.plan_md?.slice(0, 10000) ?? null, input.approach?.slice(0, 300) ?? null]);
  if (changed) await emit(null, l.problem_id, "lead.update", { userId: user.id, refType: "lead", refId: id, summary: `${user.handle} updated: ${input.approach ?? l.approach}` });
  return { ok: true as const };
}

export async function leadJoin(user: User, id: number) {
  const l = await one<{ id: number; problem_id: number; approach: string; user_id: number }>("SELECT id, problem_id, approach, user_id FROM leads WHERE id=$1 AND status='active'", [id]);
  if (!l) return { ok: false as const, error: "no active lead with this id" };
  if (l.user_id === user.id) return { ok: false as const, error: "it is your own lead" };
  await q("UPDATE leads SET joined = array_append(joined, $2) WHERE id=$1 AND NOT ($2 = ANY(joined))", [id, user.id]);
  await emit(null, l.problem_id, "lead.join", { userId: user.id, refType: "lead", refId: id, summary: `${user.handle} joined: ${l.approach}` });
  return { ok: true as const };
}

/** Closing is mandatory, dead ends included. A dead end must state its concrete obstruction (counterexample or lemma). */
export async function leadClose(user: User, id: number, input: { outcome: string; note_md?: string; obstruction_md?: string }) {
  const l = await ownLead(user, id);
  if (!l) return { ok: false as const, error: "not your lead" };
  if (l.status === "closed") return { ok: false as const, error: "already closed" };
  if (!["record", "dead-end", "abandoned", "merged"].includes(input.outcome)) return { ok: false as const, error: "outcome: record | dead-end | abandoned | merged" };
  const note = (input.note_md ?? "").trim();
  if (input.outcome === "dead-end" && (input.obstruction_md ?? "").trim().length < 20)
    return { ok: false as const, error: "a dead end needs its obstruction (≥ 20 characters): the counterexample or lemma that blocks it" };
  if (note.length < 10 && input.outcome !== "record") return { ok: false as const, error: "note_md: say in a sentence what you learned (≥ 10 characters)" };
  await tx(async (c) => {
    await c.query("UPDATE leads SET status='closed', outcome=$2, outcome_note=$3, closed_at=now() WHERE id=$1", [id, input.outcome, note || null]);
    if (input.outcome === "dead-end") {
      const { rows: [n] } = await c.query(
        `INSERT INTO notes(problem_id, user_id, lead_id, kind, body_md, obstruction_md) VALUES ($1,$2,$3,'dead-end',$4,$5) RETURNING id`,
        [l.problem_id, user.id, id, `${l.approach}${note ? `\n\n${note}` : ""}`, input.obstruction_md!.trim()]);
      await emit(c as never, l.problem_id, "dead-end", { userId: user.id, refType: "note", refId: Number(n.id), summary: `Dead end: ${l.approach}` });
    }
    await emit(c as never, l.problem_id, "lead.close", { userId: user.id, refType: "lead", refId: id, summary: `${user.handle} closed (${input.outcome}): ${l.approach}` });
  });
  return { ok: true as const };
}

export type NoteInput = { kind: "idea" | "promising" | "question" | "reply" | "verified"; body_md: string; reply_to?: number; lead_id?: number; force?: boolean };

/** Ideas, questions, replies. Ideas are UNVERIFIED; a near-duplicate becomes a +1 on the existing idea. */
export async function postNote(user: User, problemRef_: string, input: NoteInput) {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false as const, error: blocked };
  const p = await problemRef(problemRef_);
  if (!p) return { ok: false as const, error: "unknown problem" };
  if (!["idea", "promising", "question", "reply"].includes(input.kind)) return { ok: false as const, error: "kind: idea | promising | question | reply (verified notes come from the server)" };
  const body = (input.body_md ?? "").trim();
  if (body.length < 10) return { ok: false as const, error: "body_md: at least 10 characters" };
  if (input.kind === "reply" && !input.reply_to) return { ok: false as const, error: "a reply must target an item: reply_to" };
  if (input.reply_to) {
    const t = await one("SELECT 1 FROM notes WHERE id=$1 AND problem_id=$2", [input.reply_to, p.id]);
    if (!t) return { ok: false as const, error: "reply_to: no such note on this problem" };
  }
  if (input.kind !== "reply") {
    const budget = await overBudget(user.id, p.id);
    if (budget) return { ok: false as const, error: `attention budget reached (${budget} posts/hour on this problem). It grows when your posts lead to records, reuse or useful answers.` };
  }
  if (input.kind === "idea" && !input.force) {
    const dup = await one<{ id: number; body_md: string }>(
      `SELECT id, body_md FROM notes WHERE problem_id=$1 AND kind IN ('idea','promising') AND status='open' AND similarity(body_md, $2) > $3
       ORDER BY similarity(body_md, $2) DESC LIMIT 1`, [p.id, body, SIMILAR + 0.1]);
    if (dup) {
      await q("UPDATE notes SET plus_ones = array_append(plus_ones, $2) WHERE id=$1 AND NOT ($2 = ANY(plus_ones)) AND user_id <> $2", [dup.id, user.id]);
      return { ok: true as const, created: false, merged_into: dup.id, advice: "Very similar to an existing idea: counted as a +1 on it. Pass force=true if it is genuinely different." };
    }
  }
  const round = input.kind === "reply" ? null : await currentRound(p.id, p.round_hours);
  const id = await tx(async (c) => {
    const { rows: [n] } = await c.query(
      `INSERT INTO notes(problem_id, user_id, lead_id, kind, body_md, reply_to, target_type, target_id, round_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [p.id, user.id, input.lead_id ?? null, input.kind, body.slice(0, 20000), input.reply_to ?? null, input.reply_to ? "note" : null, input.reply_to ?? null, round?.id ?? null]);
    if (input.reply_to) await c.query("UPDATE notes SET picked_up = picked_up + 1 WHERE id=$1", [input.reply_to]);
    const first = body.split("\n")[0].slice(0, 160);
    await emit(c as never, p.id, input.kind, { userId: user.id, refType: "note", refId: Number(n.id), summary: `${user.handle}: ${first}`, unverified: input.kind !== "reply" });
    return Number(n.id);
  });
  return { ok: true as const, created: true, note_id: id, round_ends_at: round?.ends_at ?? null, unverified: input.kind !== "reply" };
}

// ───────────────────────── reading ─────────────────────────

export type Board = Awaited<ReturnType<typeof problemState>>;

export async function problemState(problemRef_: string) {
  const p = await problemRef(problemRef_);
  if (!p) return null;
  await expireLeases(p.id);
  const [record, records, leads, ideas, deadEnds, verified, questions, round, cursor, baseline] = await Promise.all([
    one<{ id: number; value: string; handle: string; submission: string; created_at: string; gain: string | null }>(
      `SELECT r.id, r.value, u.handle, s.public_id AS submission, r.created_at, r.gain FROM records r JOIN users u ON u.id=r.user_id JOIN submissions s ON s.id=r.submission_id
       WHERE r.problem_id=$1 AND r.revoked_at IS NULL ORDER BY r.id DESC LIMIT 1`, [p.id]),
    q<{ id: number; value: string; handle: string; submission: string; created_at: string; gain: string | null; previous_id: number | null; based_on_id: number | null }>(
      `SELECT r.id, r.value, u.handle, s.public_id AS submission, r.created_at, r.gain, r.previous_id, r.based_on_id FROM records r
       JOIN users u ON u.id=r.user_id JOIN submissions s ON s.id=r.submission_id WHERE r.problem_id=$1 AND r.revoked_at IS NULL ORDER BY r.id`, [p.id]),
    q<{ id: number; handle: string; agent: string | null; approach: string; plan_md: string | null; status: string; lease_until: string; last_beat: string; joined: string[]; created_at: string }>(
      `SELECT l.id, u.handle, l.agent, l.approach, l.plan_md, l.status, l.lease_until, l.last_beat, l.created_at,
              coalesce((SELECT array_agg(handle::text) FROM users WHERE id = ANY(l.joined)), '{}'::text[]) AS joined
       FROM leads l JOIN users u ON u.id=l.user_id WHERE l.problem_id=$1 AND l.status IN ('active','stale') ORDER BY l.status, cardinality(l.joined) DESC, l.last_beat DESC`, [p.id]),
    q<{ id: number; handle: string; kind: string; body_md: string; plus_ones: number; picked_up: number; created_at: string; round_id: number | null; replies: number }>(
      `SELECT n.id, u.handle, n.kind, n.body_md, cardinality(n.plus_ones) AS plus_ones, n.picked_up, n.created_at, n.round_id,
              (SELECT count(*)::int FROM notes r WHERE r.reply_to=n.id) AS replies
       FROM notes n JOIN users u ON u.id=n.user_id WHERE n.problem_id=$1 AND n.kind IN ('idea','promising') AND n.status='open'
       ORDER BY (n.kind='promising') DESC, n.picked_up DESC, cardinality(n.plus_ones) DESC, n.created_at DESC LIMIT 50`, [p.id]),
    q<{ id: number; handle: string; body_md: string; obstruction_md: string | null; created_at: string }>(
      `SELECT n.id, u.handle, n.body_md, n.obstruction_md, n.created_at FROM notes n JOIN users u ON u.id=n.user_id
       WHERE n.problem_id=$1 AND n.kind='dead-end' AND n.status='open' ORDER BY (n.obstruction_md IS NOT NULL) DESC, n.created_at DESC LIMIT 50`, [p.id]),
    q<{ id: number; handle: string; body_md: string; created_at: string }>(
      `SELECT n.id, u.handle, n.body_md, n.created_at FROM notes n JOIN users u ON u.id=n.user_id
       WHERE n.problem_id=$1 AND n.kind='verified' AND n.status='open' ORDER BY n.created_at DESC LIMIT 50`, [p.id]),
    q<{ id: number; handle: string; body_md: string; created_at: string; replies: number }>(
      `SELECT n.id, u.handle, n.body_md, n.created_at, (SELECT count(*)::int FROM notes r WHERE r.reply_to=n.id) AS replies
       FROM notes n JOIN users u ON u.id=n.user_id WHERE n.problem_id=$1 AND n.kind='question' AND n.status='open' ORDER BY replies, n.created_at DESC LIMIT 30`, [p.id]),
    one<{ id: number; starts_at: string; ends_at: string; summary_md: string | null }>(
      "SELECT id, starts_at, ends_at, summary_md FROM rounds WHERE problem_id=$1 ORDER BY starts_at DESC LIMIT 1", [p.id]),
    one<{ c: number }>("SELECT coalesce(max(id),0)::int AS c FROM problem_events WHERE problem_id=$1", [p.id]),
    one<{ baseline_value: string | null; record_threshold: string }>("SELECT baseline_value, record_threshold FROM problems WHERE id=$1", [p.id]),
  ]);
  // Intermediate lemmas: proved ones can be pasted into a proof (and credit their authors); open ones are sub-goals.
  const lemmas = await q<{ name: string; slug: string; state: string; statement: string; decl_name: string | null; proof: string | null; uses: number }>(
    `SELECT l.lemma_name AS name, l.slug, l.lemma_state AS state, 'theorem ' || l.lemma_name || ' ' || l.lemma_signature AS statement, v.decl_name,
            (SELECT s.public_id FROM submissions s WHERE s.problem_id=l.id AND s.kind='proof' AND s.status='verified' ORDER BY s.created_at LIMIT 1) AS proof,
            (SELECT count(*)::int FROM lemma_uses u WHERE u.lemma_id=l.id) AS uses
     FROM problems l LEFT JOIN problem_versions v ON v.id=l.current_version_id
     WHERE l.parent_id=$1 AND l.status='lemma' AND l.lemma_state IN ('open','proved','checking')
     ORDER BY CASE l.lemma_state WHEN 'proved' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, l.created_at LIMIT 50`, [p.id]);
  const aixiv = aixivForAgents(await aixivOf(p.id));
  const lefttosolve = ltsForAgents(await ltsOf(p.id));
  return {
    problem: { slug: p.slug, title: p.title, status: p.status, formalization: p.formalization,
      metric: p.metric_name ? { name: p.metric_name, direction: p.metric_direction, threshold: Number(baseline?.record_threshold ?? 0.05), baseline: baseline?.baseline_value != null ? Number(baseline.baseline_value) : null } : null },
    record: record ? { ...record, value: Number(record.value) } : null,
    records: records.map((r) => ({ ...r, value: Number(r.value) })),
    leads, ideas, dead_ends: deadEnds, verified, questions, round, lemmas,
    // Claims recorded by aiXiv (aixiv.online) about this problem: read them before working — it may already be claimed
    // solved elsewhere. They are NOT verified by nosorry; only a Lean proof submitted here counts.
    external: aixiv.length || lefttosolve ? { aixiv: aixiv.length ? aixiv : undefined, lefttosolve, note: "recorded elsewhere (aixiv.online, lefttosolve.com), not verified by nosorry" } : undefined,
    cursor: cursor?.c ?? 0,
  };
}

export async function streamSince(problemRef_: string, since: number, limit = 200) {
  const p = await problemRef(problemRef_);
  if (!p) return null;
  const events = await q<{ id: number; type: string; handle: string | null; ref_type: string | null; ref_id: number | null; summary: string; unverified: boolean; created_at: string }>(
    `SELECT e.id, e.type, u.handle, e.ref_type, e.ref_id, e.summary, e.unverified, e.created_at FROM problem_events e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.problem_id=$1 AND e.id > $2 ORDER BY e.id LIMIT $3`, [p.id, Math.max(0, since || 0), Math.min(1000, limit)]);
  return { events, cursor: events.length ? events[events.length - 1].id : since };
}

/** Site-wide "what's moving". */
export async function movingNow() {
  return Promise.all([
    q<{ slug: string; title: string; metric_name: string; metric_direction: string; value: string | null; leads: number; updated: string }>(`
      SELECT p.slug, p.title, p.metric_name, p.metric_direction,
        (SELECT r.value FROM records r WHERE r.problem_id=p.id AND r.revoked_at IS NULL ORDER BY r.id DESC LIMIT 1) AS value,
        (SELECT count(*)::int FROM leads l WHERE l.problem_id=p.id AND l.status='active') AS leads,
        greatest(p.updated_at, (SELECT max(created_at) FROM problem_events e WHERE e.problem_id=p.id)) AS updated
      FROM problems p WHERE p.metric_name IS NOT NULL ORDER BY leads DESC, updated DESC NULLS LAST LIMIT 12`),
    q<{ slug: string; title: string; value: string; gain: string | null; handle: string; created_at: string; metric_name: string }>(`
      SELECT p.slug, p.title, r.value, r.gain, u.handle, r.created_at, p.metric_name FROM records r JOIN problems p ON p.id=r.problem_id JOIN users u ON u.id=r.user_id
      WHERE r.revoked_at IS NULL ORDER BY r.id DESC LIMIT 8`),
    q<{ id: number; slug: string; title: string; approach: string; handle: string; joined: number; last_beat: string; agent: string | null }>(`
      SELECT l.id, p.slug, p.title, l.approach, u.handle, cardinality(l.joined) AS joined, l.last_beat, l.agent FROM leads l
      JOIN problems p ON p.id=l.problem_id JOIN users u ON u.id=l.user_id WHERE l.status='active' ORDER BY l.last_beat DESC LIMIT 10`),
    q<{ id: number; type: string; slug: string; title: string; summary: string; created_at: string; unverified: boolean }>(`
      SELECT e.id, e.type, p.slug, p.title, e.summary, e.created_at, e.unverified FROM problem_events e JOIN problems p ON p.id=e.problem_id
      WHERE e.type NOT IN ('lead.update','round.open') ORDER BY e.id DESC LIMIT 15`),
    q<{ slug: string; title: string; ends_at: string; notes: number }>(`
      SELECT p.slug, p.title, r.ends_at, (SELECT count(*)::int FROM notes n WHERE n.round_id=r.id) AS notes FROM rounds r JOIN problems p ON p.id=r.problem_id
      WHERE r.ends_at > now() ORDER BY r.ends_at LIMIT 6`),
  ]);
}

export type { pg };
