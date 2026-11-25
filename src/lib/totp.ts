import "server-only";
import crypto from "node:crypto";
import { q } from "./db";

// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits) — what authenticator apps use.
// A code is accepted once (table totp_used), within one step of clock drift.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decode(secret: string): Buffer {
  const clean = secret.replace(/[\s=]/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) { const v = B32.indexOf(ch); if (v < 0) throw new Error("bad secret"); bits += v.toString(2).padStart(5, "0"); }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

function codeAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** The step a code matches (−1, 0, +1 around now), or null. Pure: no replay check. */
export function totpStep(secret: string, code: string, now = Date.now()): number | null {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const t = Math.floor(now / 30_000);
  for (const s of [t, t - 1, t + 1]) {
    const want = Buffer.from(codeAt(secret, s)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(want, got)) return s;
  }
  return null;
}

/** Check a code for a user and burn it (a code cannot be used twice). */
export async function verifyTotp(userId: number, secret: string, code: string): Promise<boolean> {
  const step = totpStep(secret, code);
  if (step == null) return false;
  const r = await q<{ step: number }>("INSERT INTO totp_used(user_id, step) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING step", [userId, step]);
  await q("DELETE FROM totp_used WHERE user_id=$1 AND step < $2", [userId, step - 10]).catch(() => {});
  return r.length > 0;
}

export function otpauthUri(handle: string, secret: string, issuer = "nosorry") {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${handle}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
