import { one } from "@/lib/db";

/** Liveness for monitoring and deploys: 200 when the app answers and the database is reachable, 503 otherwise. */
export async function GET() {
  try {
    const r = await one<{ ok: number; migrations: number }>("SELECT 1 AS ok, (SELECT count(*) FROM schema_migrations)::int AS migrations");
    return Response.json({ ok: r?.ok === 1, migrations: r?.migrations ?? null, time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
