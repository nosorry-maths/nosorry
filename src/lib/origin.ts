import "server-only";
import { headers } from "next/headers";

/** Public origin of the site: SITE_URL in production, else derived from the Host header (dev). */
export async function siteOrigin(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
