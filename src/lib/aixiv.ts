import "server-only";
import { q, one } from "./db";

export type AixivResult = { kind: string; statement: string; aixiv_id: string; title: string; date: string; url: string; standing: string; lean: string | null; withdrawn: boolean };
export type AixivLink = {
  aixiv_slug: string; match: "erdos" | "name"; name: string; url: string; status: string | null; status_text: string | null;
  tracker: { source?: string; status?: string; updated?: string; url?: string } | null; results: AixivResult[]; settled: boolean; latest: string | null; synced_at: string;
};

/** What aiXiv (aixiv.online) records about a problem. Claims gathered by aiXiv — not nosorry verifications. */
export async function aixivOf(problemId: number | string) {
  const rows = await q<AixivLink>(
    `SELECT aixiv_slug, match, name, url, status, status_text, tracker, results, settled, latest::text, synced_at
     FROM aixiv_links WHERE problem_id=$1 ORDER BY settled DESC, latest DESC NULLS LAST`, [problemId]).catch(() => []);
  return rows;
}

export async function aixivSyncInfo() {
  return one<{ finished_at: string | null; ok: boolean | null }>("SELECT finished_at, ok FROM aixiv_sync WHERE id=1").catch(() => null);
}

/** Compact form for agents (problem_state, solve kit). */
export function aixivForAgents(links: AixivLink[]) {
  return links.map((l) => ({
    problem: l.name, url: l.url, status: l.status ?? (l.settled ? "resolved" : "progress"), summary: l.status_text,
    tracker: l.tracker?.status ? `${l.tracker.source ?? "tracker"}: ${l.tracker.status}` : undefined,
    results: l.results.filter((r) => !r.withdrawn).slice(0, 5).map((r) => ({ kind: r.kind, aixiv_id: r.aixiv_id, date: r.date, statement: r.statement, standing: r.standing, lean: r.lean ?? undefined, url: r.url })),
  }));
}
