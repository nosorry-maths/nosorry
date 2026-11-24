import "server-only";
import pg from "pg";

// One pool per process. Each web node keeps a small pool; put PgBouncer in front at scale.
const g = globalThis as unknown as { __pool?: pg.Pool };
export const pool =
  g.__pool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry",
    max: Number(process.env.DB_POOL_MAX ?? 10),
    statement_timeout: 15_000,
  });
if (process.env.NODE_ENV !== "production") g.__pool = pool;

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}
export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
