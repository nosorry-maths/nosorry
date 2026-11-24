import "server-only";
import { one } from "./db";

/** Fixed-window counter stored in Postgres, so every web node shares it. Returns true if allowed. */
export async function rateLimit(key: string, limit: number, windowSec: number, cost = 1): Promise<boolean> {
  const row = await one<{ count: number }>(
    `INSERT INTO rate_buckets(key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), $3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_buckets.count + $3
     RETURNING count`,
    [key, windowSec, cost],
  );
  return (row?.count ?? 0) <= limit;
}
