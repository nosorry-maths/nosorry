import { q } from "@/lib/db";
import { anonLimit, json } from "@/lib/api";

// Keyset pagination (cursor = last id) so agents can walk the whole catalogue cheaply.
export async function GET(req: Request) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const u = new URL(req.url);
  const where: string[] = [], args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  const subject = u.searchParams.get("subject");
  if (subject) add("? = ANY(p.subjects)", subject);
  const status = u.searchParams.get("status") ?? "research";
  if (status === "research") add("p.status = ANY(?)", ["open", "solved"]);
  else if (status !== "all") add("p.status = ?", status);
  const coll = u.searchParams.get("collection");
  if (coll) add("p.collection = ?", coll);
  const text = u.searchParams.get("q");
  if (text) add("p.search @@ websearch_to_tsquery('english', ?)", text.slice(0, 200));
  if (u.searchParams.get("unsolved") === "1") where.push("NOT p.solved_on_platform");
  const cursor = Number(u.searchParams.get("cursor") ?? 0);
  if (cursor) add("p.id > ?", cursor);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? 50)));
  const rows = await q<{ id: number }>(`
    SELECT p.id, p.ident, p.slug, p.title, p.status, p.statement_status, p.subjects, p.tags, p.collection, p.solved_on_platform,
           p.needs_answer, v.decl_name, v.version, v.statement_hash, left(p.statement_md, 400) AS statement_excerpt
    FROM problems p JOIN problem_versions v ON v.id=p.current_version_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.id LIMIT ${limit}`, args);
  return json({ items: rows, next_cursor: rows.length === limit ? rows[rows.length - 1].id : null });
}
