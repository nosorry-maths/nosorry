import "server-only";
import { apiUser, type User } from "./auth";
import { rateLimit } from "./ratelimit";
import { ipFromHeaders } from "./ip";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const err = (status: number, error: string, details?: unknown) => json({ error, details }, status);

export function ipOf(req: Request): string | null {
  return ipFromHeaders(req.headers);
}

/** Authenticated API call with a per-key read limit. */
export async function withUser(req: Request, scope: "read" | "submit"): Promise<User | Response> {
  const u = await apiUser(req, scope);
  if (!u) return err(401, "missing or invalid API key (Authorization: Bearer ns_…)");
  if (!(await rateLimit(`api:${u.id}`, 600, 60))) return err(429, "rate limit: 600 requests/minute");
  return u;
}

export async function anonLimit(req: Request): Promise<Response | null> {
  if (!(await rateLimit(`anon:${ipOf(req) ?? "unknown"}`, 120, 60))) return err(429, "rate limit");
  return null;
}
