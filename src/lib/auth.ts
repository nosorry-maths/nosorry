import "server-only";
import { cookies, headers } from "next/headers";
import { one, q } from "./db";
import { sha256, token, safeEqual } from "./crypto";
import { config } from "./config";
import { ipFromHeaders } from "./ip";

export type User = {
  id: number; handle: string; display_name: string | null; role: "user" | "moderator" | "admin";
  email: string | null; email_verified_at: string | null; created_at: string; banned_at: string | null;
};
// In production the cookie is __Host- prefixed: HTTPS only, this exact host, path / (no subdomain can set or read it).
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-ns_session" : "ns_session";
/** A session not used for this many days ends, even before its absolute expiry. */
const IDLE_DAYS = 14;
const USER_COLS = "u.id, u.handle, u.display_name, u.role, u.email, u.email_verified_at, u.created_at, u.banned_at";

export async function clientIp(): Promise<string | null> {
  return ipFromHeaders(await headers());
}

export async function createSession(userId: number) {
  const raw = token(32);
  const h = await headers();
  await q(
    `INSERT INTO sessions(id, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + make_interval(days => $3), $4, $5)`,
    [sha256(raw), userId, config.sessionDays, await clientIp(), h.get("user-agent")?.slice(0, 300) ?? null],
  );
  (await cookies()).set(COOKIE, raw, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: config.sessionDays * 86400,
  });
}

/** The hashed id of the current session (to mark it in the session list), or null. */
export async function currentSessionId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  return raw ? sha256(raw) : null;
}

export async function destroySession() {
  const c = await cookies();
  const raw = c.get(COOKIE)?.value;
  if (raw) await q("DELETE FROM sessions WHERE id = $1", [sha256(raw)]);
  // Expire it with the same attributes it was set with (a __Host- cookie is only replaced by a Secure, path=/ one).
  c.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  return one<User>(
    `WITH s AS (
       UPDATE sessions SET last_seen_at = now()
       WHERE id = $1 AND expires_at > now() AND last_seen_at > now() - make_interval(days => ${IDLE_DAYS})
         AND last_seen_at < now() - interval '5 minutes'
       RETURNING user_id)
     SELECT ${USER_COLS} FROM sessions ss JOIN users u ON u.id = ss.user_id
     WHERE ss.id = $1 AND ss.expires_at > now() AND ss.last_seen_at > now() - make_interval(days => ${IDLE_DAYS})
       AND u.banned_at IS NULL AND u.deleted_at IS NULL`,
    [sha256(raw)],
  );
}

/** Bearer API key auth for agents. Keys look like ns_<prefix>_<secret>. */
export async function apiUser(req: Request, scope: "submit" | "read" = "read"): Promise<User | null> {
  const m = req.headers.get("authorization")?.match(/^Bearer (ns_[a-z0-9]{8}_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const prefix = m[1].split("_")[1];
  const row = await one<User & { key_id: number; key_hash: string; scopes: string[] }>(
    `SELECT ${USER_COLS}, k.id AS key_id, k.key_hash, k.scopes FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.prefix = $1 AND k.revoked_at IS NULL AND u.banned_at IS NULL`,
    [prefix],
  );
  if (!row || !safeEqual(row.key_hash, sha256(m[1])) || !row.scopes.includes(scope)) return null;
  q("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.key_id]).catch(() => {});
  return row;
}

export function canSubmit(u: User): string | null {
  if (u.banned_at) return "account suspended";
  if (config.requireEmailVerification && !u.email_verified_at) return "email not verified";
  return null;
}

export const isModerator = (u: User | null) => !!u && (u.role === "moderator" || u.role === "admin");

export async function audit(actorId: number | null, action: string, target: string, data?: unknown) {
  await q("INSERT INTO audit_log(actor_id, action, target, data, ip) VALUES ($1,$2,$3,$4,$5)", [
    actorId, action, target, data ? JSON.stringify(data) : null, await clientIp().catch(() => null),
  ]);
}
