import "server-only";
import { q, one } from "./db";

export const LTS_BASE = "https://lefttosolve.com";
export const ltsProblemUrl = (id: string) => `${LTS_BASE}/p/${encodeURIComponent(id)}`;

export type LtsEvent = {
  lts_id: string; outcome: string; polarity: string | null; handle: string | null; agent: string | null; model: string | null;
  pr_url: string; title: string | null; step: boolean; created_at: string | null; problem_slug?: string | null; problem_title?: string | null;
};
export type LtsState = {
  /** What Left to Solve records about the problem itself (not its steps). */
  state: "proved" | "disproved" | "pending" | "misstated" | null;
  outcome: string | null; main: LtsEvent | null; events: LtsEvent[];
  steps: { total: number; solved: number }; lts_id: string | null;
};

const SETTLED = new Set(["open", "known", "warmup"]);

/** What Left to Solve records about one of our problems: results on it and on the reduction steps that serve it. */
export async function ltsOf(problemId: number | string): Promise<LtsState | null> {
  const events = await q<LtsEvent>(
    `SELECT lts_id, outcome, polarity, handle, agent, model, pr_url, title, step, created_at FROM lts_events
     WHERE problem_id=$1 ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 60`, [problemId]).catch(() => []);
  const item = await one<{ lts_id: string; steps: number; steps_solved: number }>(
    `SELECT i.lts_id,
       (SELECT count(*)::int FROM lts_items s WHERE s.root_id = i.lts_id AND s.lts_id <> i.lts_id) AS steps,
       (SELECT count(*)::int FROM lts_items s WHERE s.root_id = i.lts_id AND s.lts_id <> i.lts_id AND s.solved) AS steps_solved
     FROM lts_items i WHERE i.problem_id=$1 AND i.lts_id = i.root_id LIMIT 1`, [problemId]).catch(() => null);
  if (!events.length && !item) return null;
  const own = events.filter((e) => !e.step && e.lts_id === (item?.lts_id ?? e.lts_id));
  const settled = own.find((e) => SETTLED.has(e.outcome));
  const pending = own.find((e) => e.outcome === "pending");
  const misstated = own.find((e) => e.outcome === "misstated");
  const main = settled ?? misstated ?? pending ?? null;
  const state = settled ? (settled.polarity === "disproof" ? "disproved" : "proved") : misstated ? "misstated" : pending ? "pending" : null;
  return { state, outcome: main?.outcome ?? null, main, events, steps: { total: item?.steps ?? 0, solved: item?.steps_solved ?? 0 }, lts_id: item?.lts_id ?? main?.lts_id ?? null };
}

/** The stream: latest results merged on Left to Solve, with our problem when it maps to one. */
export async function ltsStream({ limit = 100, ours = false, outcome }: { limit?: number; ours?: boolean; outcome?: string } = {}) {
  const where = [ours ? "e.problem_id IS NOT NULL" : "true", outcome ? "e.outcome = $2" : "true"].join(" AND ");
  return q<LtsEvent>(
    `SELECT e.lts_id, e.outcome, e.polarity, e.handle, e.agent, e.model, e.pr_url, e.title, e.step, e.created_at,
            p.slug AS problem_slug, p.title AS problem_title
     FROM lts_events e LEFT JOIN problems p ON p.id = e.problem_id
     WHERE ${where} ORDER BY e.created_at DESC NULLS LAST, e.id DESC LIMIT $1`, outcome ? [limit, outcome] : [limit]).catch(() => []);
}

export async function ltsStats() {
  return one<{ events: number; on_ours: number; items: number; items_ours: number; settled_ours: number; misstated_ours: number; stream_at: string | null; catalog_at: string | null; ok: boolean | null }>(
    `SELECT (SELECT count(*)::int FROM lts_events) AS events,
            (SELECT count(*)::int FROM lts_events WHERE problem_id IS NOT NULL) AS on_ours,
            (SELECT count(*)::int FROM lts_items) AS items,
            (SELECT count(DISTINCT problem_id)::int FROM lts_items WHERE problem_id IS NOT NULL) AS items_ours,
            (SELECT count(DISTINCT problem_id)::int FROM lts_events WHERE problem_id IS NOT NULL AND NOT step AND outcome IN ('open','known','warmup')) AS settled_ours,
            (SELECT count(DISTINCT problem_id)::int FROM lts_events WHERE problem_id IS NOT NULL AND NOT step AND outcome = 'misstated') AS misstated_ours,
            s.stream_at, s.catalog_at, s.ok
     FROM (SELECT 1) x LEFT JOIN lts_sync s ON s.id = 1`).catch(() => null);
}

/** Compact form for agents (problem_state). */
export function ltsForAgents(s: LtsState | null) {
  if (!s) return undefined;
  return {
    site: "lefttosolve.com (its CI checks proofs against its own pinned statement; not verified on nosorry)",
    state: s.state, problem: s.lts_id ? ltsProblemUrl(s.lts_id) : undefined,
    pull_request: s.main?.pr_url, by: s.main?.handle ?? undefined, model: s.main?.model ?? undefined,
    steps: s.steps.total ? `${s.steps.solved}/${s.steps.total} reduction steps solved there` : undefined,
  };
}
