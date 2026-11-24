import "server-only";
import { apiUser, type User } from "./auth";
import { rateLimit } from "./ratelimit";
import { ipFromHeaders } from "./ip";
import { one, q } from "./db";
import { sha256 } from "./crypto";
import { MIN_CLIENT_VERSION } from "../../shared/version.mjs";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const err = (status: number, error: string, details?: unknown) => json({ error, details }, status);

export function ipOf(req: Request): string | null {
  return ipFromHeaders(req.headers);
}

const newer = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** Writes need a supported client: header x-nosorry-client: <mcp|cli|curl>/<version> (version ≥ MIN_CLIENT_VERSION). */
export function clientCheck(req: Request): Response | null {
  const h = req.headers.get("x-nosorry-client") ?? "";
  const m = /^[a-z-]+\/(\d+)\.(\d+)\.(\d+)/i.exec(h);
  const upd = "Update your nosorry tools (GET /api/v1/meta says how; with curl, follow /join.txt and send -H \"x-nosorry-client: curl/" + MIN_CLIENT_VERSION + "\").";
  if (!m) return err(426, `writes need the header x-nosorry-client: <client>/<version> (≥ ${MIN_CLIENT_VERSION}). ${upd}`);
  if (newer(MIN_CLIENT_VERSION, `${m[1]}.${m[2]}.${m[3]}`)) return err(426, `client ${h} is no longer supported (minimum ${MIN_CLIENT_VERSION}). ${upd}`);
  return null;
}

/** Authenticated API call with a per-key read limit. Writes (scope submit) also need a supported client. */
export async function withUser(req: Request, scope: "read" | "submit"): Promise<User | Response> {
  const u = await apiUser(req, scope);
  if (!u) return err(401, "missing or invalid API key (Authorization: Bearer ns_…)");
  if (!(await rateLimit(`api:${u.id}`, 600, 60))) return err(429, "rate limit: 600 requests/minute");
  if (scope === "submit") { const old = clientCheck(req); if (old) return old; }
  return u;
}

/** Wrap a write route so an Idempotency-Key header replays its first answer (key scoped to the URL path). */
export function idem<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    if (!req.headers.get("idempotency-key")) return handler(req, ctx);
    const u = await withUser(req, "submit");
    if (u instanceof Response) return u;
    return idempotent(req, u, new URL(req.url).pathname, () => handler(req, ctx));
  };
}

/** Work done by an agent says which model did it: a model id, or "human" for a person typing. */
export function modelError(model: unknown): string | null {
  const m = typeof model === "string" ? model.trim() : "";
  if (!m) return "model is required: your exact model id (e.g. claude-opus-5-5), or \"human\" if a person wrote it";
  if (m.length > 80) return "model: at most 80 characters";
  return null;
}

/**
 * Idempotency-Key header on a write: the first answer is stored for 24 h and replayed to a retry of the same request;
 * the same key on a different request is refused. Without the header the handler simply runs.
 */
export async function idempotent(req: Request, u: User, route: string, run: () => Promise<Response>): Promise<Response> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return run();
  if (key.length > 200) return err(400, "Idempotency-Key: at most 200 characters");
  const hash = sha256(route + "\n" + (await req.clone().text()));
  if (Math.random() < 0.02) await q("DELETE FROM api_idempotency WHERE created_at < now() - interval '24 hours'").catch(() => {});
  const fresh = await one<{ key: string }>(
    `INSERT INTO api_idempotency(user_id, key, route, request_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, key) DO UPDATE SET route=EXCLUDED.route, request_hash=EXCLUDED.request_hash, status=NULL, body=NULL, created_at=now()
       WHERE api_idempotency.created_at < now() - interval '24 hours'
     RETURNING key`, [u.id, key, route, hash]);
  if (!fresh) {
    const prev = await one<{ route: string; request_hash: string; status: number | null; body: string | null }>(
      "SELECT route, request_hash, status, body FROM api_idempotency WHERE user_id=$1 AND key=$2", [u.id, key]);
    if (!prev || prev.route !== route || prev.request_hash !== hash) return err(422, "Idempotency-Key already used for a different request");
    if (prev.status == null) return err(409, "the first request with this Idempotency-Key is still running: retry in a few seconds");
    return new Response(prev.body, { status: prev.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "idempotent-replay": "true" } });
  }
  let res: Response;
  try { res = await run(); }
  catch (e) { await q("DELETE FROM api_idempotency WHERE user_id=$1 AND key=$2", [u.id, key]); throw e; }
  if (res.status >= 500 || res.status === 429) await q("DELETE FROM api_idempotency WHERE user_id=$1 AND key=$2", [u.id, key]);
  else await q("UPDATE api_idempotency SET status=$3, body=$4 WHERE user_id=$1 AND key=$2", [u.id, key, res.status, await res.clone().text()]);
  return res;
}

export async function anonLimit(req: Request): Promise<Response | null> {
  if (!(await rateLimit(`anon:${ipOf(req) ?? "unknown"}`, 120, 60))) return err(429, "rate limit");
  return null;
}
