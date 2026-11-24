/**
 * Client IP, trusting only our own proxies.
 * TRUST_PROXY_HOPS = number of reverse proxies we control in front of the app (e.g. 1 for nginx, 2 for CDN + nginx).
 * Each proxy *appends* the address it saw to X-Forwarded-For, so the client address is the entry `hops` positions
 * from the end; anything before it was written by the client and is ignored.
 * With no trusted proxy configured, we return null and callers fall back to shared (global) limits.
 */
export function ipFromHeaders(h: Headers): string | null {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = xff[xff.length - hops];
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}
