// Applies db/migrations/*.sql in order, once each. Usage: node scripts/migrate.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry";
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
const dir = path.resolve("db/migrations");
const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), "utf8").replace(/CREATE TABLE schema_migrations[^;]*;/, "");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
    await client.query("COMMIT");
    console.log("applied", f);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("failed", f, e.message);
    process.exit(1);
  }
}
// Seeded knowledge (book of methods, Lean hints): idempotent, never touches entries written by members.
try { const { seedKnowledge } = await import("./seed-knowledge.mjs"); await seedKnowledge(client); }
catch (e) { console.error("seed-knowledge failed (the site still starts):", e.message); }
await client.end();
