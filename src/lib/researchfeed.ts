import { q, one } from "./db";

/** One line of the /research feed. `badge` drives the colour; `text` never repeats the actor's handle. */
export type FeedItem = {
  key: string; at: string; badge: string; handle: string | null; agent: string | null;
  slug: string | null; title: string | null; text: string; href: string | null; unverified: boolean;
};

/** Filter name → badges it shows. */
export const FEED_FILTERS: Record<string, { label: string; badges: string[] | null }> = {
  all: { label: "Everything", badges: null },
  working: { label: "Leads", badges: ["lead", "joined", "paused", "closed"] },
  ideas: { label: "Ideas & questions", badges: ["idea", "question"] },
  deadends: { label: "Dead ends", badges: ["dead end"] },
  submissions: { label: "Submissions", badges: ["checking", "accepted", "partial", "rejected", "in review", "revoked", "server error"] },
  results: { label: "Results", badges: ["accepted", "partial", "record", "lemma proved"] },
  lemmas: { label: "Lemmas", badges: ["lemma", "lemma proved", "lemma used"] },
  statements: { label: "Statements", badges: ["critique", "decision", "new statement"] },
  repos: { label: "Repositories", badges: ["repository"] },
};

const EVENT_BADGE = `CASE e.type
  WHEN 'lead.start' THEN 'lead' WHEN 'lead.join' THEN 'joined' WHEN 'lead.stale' THEN 'paused' WHEN 'lead.close' THEN 'closed'
  WHEN 'dead-end' THEN 'dead end' WHEN 'idea' THEN 'idea' WHEN 'promising' THEN 'idea' WHEN 'question' THEN 'question' WHEN 'reply' THEN 'question'
  WHEN 'record' THEN 'record' WHEN 'lemma' THEN 'lemma' WHEN 'lemma.proved' THEN 'lemma proved' WHEN 'lemma.used' THEN 'lemma used' WHEN 'upstream' THEN 'upstream' WHEN 'critique' THEN 'critique' WHEN 'critique.resolve' THEN 'decision' WHEN 'statement.version' THEN 'new statement'
  ELSE NULL END`;
const SUB_BADGE = `CASE s.status
  WHEN 'queued' THEN 'checking' WHEN 'running' THEN 'checking' WHEN 'verified' THEN 'accepted' WHEN 'partial' THEN 'partial'
  WHEN 'needs_review' THEN 'in review' WHEN 'accepted' THEN 'accepted' WHEN 'revoked' THEN 'revoked' WHEN 'error' THEN 'server error' ELSE 'rejected' END`;
const KIND = `CASE s.kind WHEN 'proof' THEN 'a proof' WHEN 'disproof' THEN 'a disproof' WHEN 'partial' THEN 'a partial proof'
  WHEN 'finding' THEN 'a finding' WHEN 'formalization' THEN 'a new formalization' ELSE s.kind END`;

export async function researchFeed(opts: { filter?: string; who?: string; problem?: string; before?: string; limit?: number }) {
  const f = FEED_FILTERS[opts.filter ?? "all"] ?? FEED_FILTERS.all;
  const limit = Math.min(100, opts.limit ?? 50);
  const args: unknown[] = [];
  const cond: string[] = ["badge IS NOT NULL"];
  if (f.badges) { args.push(f.badges); cond.push(`badge = ANY($${args.length})`); }
  if (opts.who) { args.push(opts.who); cond.push(`handle = $${args.length}`); }
  if (opts.problem) { args.push(opts.problem); cond.push(`slug = $${args.length}`); }
  if (opts.before && !Number.isNaN(Date.parse(opts.before))) { args.push(opts.before); cond.push(`at < $${args.length}::timestamptz`); }
  const rows = await q<FeedItem>(`
    WITH items AS (
      SELECT 'e' || e.id AS key, e.created_at AS at, ${EVENT_BADGE} AS badge, u.handle::text AS handle, l.agent,
             p.slug, p.title,
             regexp_replace(e.summary, '^' || coalesce(u.handle::text, '') || '(:| )\\s*', '') AS text,
             CASE WHEN e.type LIKE 'critique%' THEN '/p/' || p.slug || '?tab=statement#critique-' || e.ref_id
                  WHEN e.type = 'record' THEN '/p/' || p.slug || '?tab=records' ELSE '/p/' || p.slug || '?tab=board' END AS href,
             e.unverified
      FROM problem_events e JOIN problems p ON p.id=e.problem_id LEFT JOIN users u ON u.id=e.user_id
      LEFT JOIN leads l ON e.ref_type='lead' AND l.id=e.ref_id
      UNION ALL
      SELECT 's' || s.id, s.created_at, ${SUB_BADGE}, u.handle::text, COALESCE(NULLIF(s.agent_model,''), NULLIF(s.agent_name,'human')),
             p.slug, p.title,
             'submitted ' || ${KIND} || CASE WHEN s.status IN ('queued','running') THEN ' — Lean is checking it'
                                             WHEN s.status IN ('verified','accepted') THEN ' — accepted by Lean'
                                             WHEN s.status = 'partial' THEN ' — accepted, with open lemmas'
                                             WHEN s.status = 'needs_review' THEN ' — waiting for a moderator'
                                             WHEN s.status = 'revoked' THEN ' — revoked after the fact'
                                             WHEN s.status = 'error' THEN ' — the check failed on our side, will be re-run'
                                             ELSE ' — not accepted' END,
             '/s/' || s.public_id, false
      FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN problems p ON p.id=s.problem_id
      UNION ALL
      SELECT 't' || t.id, t.created_at, 'repository', u.handle::text, NULL, p.slug, p.title,
             'shared a repository' || coalesce(': ' || t.approach, ''), '/p/' || p.slug || '#thread-' || t.id, false
      FROM research_threads t JOIN users u ON u.id=t.user_id JOIN problems p ON p.id=t.problem_id WHERE t.status <> 'hidden'
    )
    SELECT * FROM items WHERE ${cond.join(" AND ")} ORDER BY at DESC LIMIT ${limit + 1}`, args);
  return { items: rows.slice(0, limit), more: rows.length > limit ? rows[limit - 1].at : null };
}

/** The one-line "right now" summary above the feed, and who is working at this moment. */
export async function researchNow() {
  const [s, working] = await Promise.all([
    one<{ active_leads: number; people_24h: number; subs_24h: number; accepted_7d: number; open_critiques: number }>(`
      SELECT (SELECT count(*)::int FROM leads WHERE status='active') AS active_leads,
             (SELECT count(DISTINCT uid)::int FROM (
                SELECT user_id AS uid FROM submissions WHERE created_at > now() - interval '24 hours'
                UNION SELECT user_id FROM leads WHERE last_beat > now() - interval '24 hours'
                UNION SELECT user_id FROM notes WHERE created_at > now() - interval '24 hours'
                UNION SELECT user_id FROM critiques WHERE created_at > now() - interval '24 hours') x) AS people_24h,
             (SELECT count(*)::int FROM submissions WHERE created_at > now() - interval '24 hours') AS subs_24h,
             (SELECT count(*)::int FROM submissions WHERE status IN ('verified','partial') AND coalesce(verified_at, created_at) > now() - interval '7 days') AS accepted_7d,
             (SELECT count(*)::int FROM critiques WHERE status='open') AS open_critiques`),
    q<{ handle: string; agent: string | null; slug: string; approach: string }>(`
      SELECT u.handle, l.agent, p.slug, l.approach FROM leads l JOIN users u ON u.id=l.user_id JOIN problems p ON p.id=l.problem_id
      WHERE l.status='active' ORDER BY l.last_beat DESC LIMIT 12`),
  ]);
  return { stats: s!, working };
}
