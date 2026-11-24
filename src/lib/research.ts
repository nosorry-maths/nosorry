import "server-only";
import { one, q } from "./db";
import { rateLimit } from "./ratelimit";
import { canSubmit, type User } from "./auth";

export const REPO_RE = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[^\s]*)?$/;
export const THREAD_STATUSES = ["active", "paused", "abandoned", "done"] as const;

export function normalizeRepo(url: string | undefined | null): string | null {
  if (!url) return null;
  const u = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  return REPO_RE.test(u) ? u : null;
}

export type ThreadInput = { repo_url?: string; summary_md?: string; approach?: string; status?: string; open_to_collaborators?: boolean };

/** Create or update the caller's research thread on a problem (one per person per problem). */
export async function saveThread(user: User, problemRef: string, input: ThreadInput):
  Promise<{ ok: true; slug: string; id: number; created: boolean } | { ok: false; error: string }> {
  const blocked = canSubmit(user);
  if (blocked) return { ok: false, error: blocked };
  if (!(await rateLimit(`thread:${user.id}`, 30, 3600))) return { ok: false, error: "rate limit: too many research updates this hour" };
  const p = await one<{ id: number; slug: string }>("SELECT id, slug FROM problems WHERE slug=$1 OR ident=$1", [problemRef]);
  if (!p) return { ok: false, error: `unknown problem ${problemRef}` };
  const repo = normalizeRepo(input.repo_url);
  if (!repo) return { ok: false, error: "repo_url must be a public https://github.com/, gitlab.com/ or codeberg.org/ repository" };
  const summary = (input.summary_md ?? "").trim();
  if (summary.length < 30) return { ok: false, error: "summary_md: say in a few sentences what you have already done (at least 30 characters)" };
  if (summary.length > 20000) return { ok: false, error: "summary_md too long" };
  const status = THREAD_STATUSES.includes(input.status as (typeof THREAD_STATUSES)[number]) ? input.status! : "active";
  const approach = (input.approach ?? "").trim().slice(0, 200) || null;
  const row = await one<{ id: number; created: boolean }>(`
    INSERT INTO research_threads(problem_id, user_id, repo_url, summary_md, approach, status, open_to_collaborators)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (problem_id, user_id) DO UPDATE SET repo_url=EXCLUDED.repo_url, summary_md=EXCLUDED.summary_md,
      approach=EXCLUDED.approach, open_to_collaborators=EXCLUDED.open_to_collaborators, updated_at=now(),
      status = CASE WHEN research_threads.status='hidden' THEN 'hidden' ELSE EXCLUDED.status END
    RETURNING id, (xmax = 0) AS created`,
    [p.id, user.id, repo, summary, approach, status, input.open_to_collaborators !== false]);
  await q("UPDATE problems SET updated_at=now() WHERE id=$1", [p.id]);
  return { ok: true, slug: p.slug, id: row!.id, created: row!.created };
}

export type ThreadRow = {
  id: number; handle: string; user_id: number; repo_url: string; summary_md: string; approach: string | null; status: string;
  open_to_collaborators: boolean; created_at: string; updated_at: string; problem_slug?: string; problem_title?: string; problem_ident?: string;
};

export async function threadsForProblem(problemId: number) {
  return q<ThreadRow>(`
    SELECT t.id, u.handle, t.user_id, t.repo_url, t.summary_md, t.approach, t.status, t.open_to_collaborators, t.created_at, t.updated_at
    FROM research_threads t JOIN users u ON u.id=t.user_id
    WHERE t.problem_id=$1 AND t.status <> 'hidden' AND u.banned_at IS NULL
    ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, t.updated_at DESC`, [problemId]);
}

export async function recentThreads(limit = 6, userId?: number) {
  const args: unknown[] = [limit];
  let w = "t.status <> 'hidden' AND u.banned_at IS NULL";
  if (userId) { args.push(userId); w += ` AND t.user_id=$2`; }
  return q<ThreadRow>(`
    SELECT t.id, u.handle, t.user_id, t.repo_url, t.summary_md, t.approach, t.status, t.open_to_collaborators, t.created_at, t.updated_at,
           p.slug AS problem_slug, p.title AS problem_title, p.ident AS problem_ident
    FROM research_threads t JOIN users u ON u.id=t.user_id JOIN problems p ON p.id=t.problem_id
    WHERE ${w} ORDER BY t.updated_at DESC LIMIT $1`, args);
}

export const repoLabel = (url: string) => url.replace(/^https:\/\/(www\.)?/, "").replace(/^github\.com\//, "");
