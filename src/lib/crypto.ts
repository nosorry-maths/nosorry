import "server-only";
import crypto from "node:crypto";

const N = 2 ** 15, r = 8, p = 1, KEYLEN = 64;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${h.toString("base64")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, rr, pp, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(pw.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: Number(rr), p: Number(pp), maxmem: 128 * Number(n) * Number(rr) * 2,
  });
  return crypto.timingSafeEqual(expected, got);
}

// A dummy hash so login timing is the same whether or not the account exists.
export const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));

export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const ALPH = "0123456789abcdefghjkmnpqrstvwxyz";
export function shortId(prefix: string, len = 10): string {
  const b = crypto.randomBytes(len);
  return prefix + "-" + Array.from(b, (x) => ALPH[x % 32]).join("");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
