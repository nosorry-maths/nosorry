import { one } from "@/lib/db";

// GET /random?subject=math.NT&collection=erdos — a random research problem that is open and not yet proved here,
// with a reviewed statement. (ORDER BY random() is fine at this size; switch to TABLESAMPLE beyond ~10^6 rows.)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const subject = u.searchParams.get("subject");
  const collection = u.searchParams.get("collection");
  const args: unknown[] = [];
  const where = [
    "p.status = 'open'", "NOT p.solved_on_platform", "p.variant_of IS NULL",
    "p.statement_status IN ('reviewed','frozen')", "NOT ('demo' = ANY(p.tags))",
  ];
  if (subject) { args.push(subject); where.push(`$${args.length} = ANY(p.subjects)`); }
  if (collection) { args.push(collection); where.push(`p.collection = $${args.length}`); }
  const p = await one<{ slug: string }>(`SELECT p.slug FROM problems p WHERE ${where.join(" AND ")} ORDER BY random() LIMIT 1`, args);
  const dest = p ? `/p/${p.slug}?from=random` : "/list/math?status=unsolved";
  // Relative Location: correct behind any proxy, whatever the internal origin is.
  return new Response(null, { status: 303, headers: { location: dest, "cache-control": "no-store" } });
}
