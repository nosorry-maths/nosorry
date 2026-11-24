import "server-only";
import { q } from "./db";
import { sha256, token } from "./crypto";
import { audit } from "./auth";

// Never export this from a "use server" module: it would become a callable server action.
export async function newApiKey(userId: number, name: string): Promise<string> {
  const prefix = token(6).toLowerCase().replace(/[^a-z0-9]/g, "x").slice(0, 8).padEnd(8, "0");
  const key = `ns_${prefix}_${token(24)}`;
  await q("INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,$2,$3,$4,$5)", [userId, name, prefix, sha256(key), ["submit", "read"]]);
  await audit(userId, "api_key.create", `key:${prefix}`, { name });
  return key;
}
