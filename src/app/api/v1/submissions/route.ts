import { q } from "@/lib/db";
import { err, ipOf, json, withUser } from "@/lib/api";
import { config } from "@/lib/config";
import { createSubmission, type SubmissionInput } from "@/lib/submissions";

const MAX_BODY = 40 * 1024 * 1024; // whole request, bulk included

/** Read the body as a stream and stop as soon as it exceeds the limit (Content-Length is not trusted). */
async function readJsonLimited(req: Request, max: number): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw Object.assign(new Error("too large"), { status: 413 }); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** One submission, or {items: [...]} for bulk (each item validated and queued independently). */
export async function POST(req: Request) {
  const u = await withUser(req, "submit");
  if (u instanceof Response) return u;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return err(413, "request too large");
  let body: SubmissionInput | { items: SubmissionInput[] };
  try { body = (await readJsonLimited(req, MAX_BODY)) as typeof body; }
  catch (e) { return (e as { status?: number }).status === 413 ? err(413, `request too large (max ${MAX_BODY / 1048576} MB)`) : err(400, "invalid JSON"); }
  if (!body || typeof body !== "object") return err(400, "invalid JSON");
  const ip = ipOf(req);
  if ("items" in body) {
    if (!Array.isArray(body.items) || body.items.length === 0) return err(400, "items must be a non-empty array");
    if (body.items.length > config.limits.bulkMaxItems) return err(400, `at most ${config.limits.bulkMaxItems} items per request`);
    const results = [];
    for (const item of body.items) results.push(await createSubmission(u, item, ip));
    const accepted = results.filter((r) => r.ok).length;
    return json({ accepted, rejected: results.length - accepted, results }, accepted ? 202 : 400);
  }
  const r = await createSubmission(u, body, ip);
  return r.ok ? json(r, 202, { location: r.url }) : json(r, 400);
}

export async function GET(req: Request) {
  const u = await withUser(req, "read");
  if (u instanceof Response) return u;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const rows = await q(
    `SELECT s.public_id AS id, s.kind, s.status, p.slug AS problem, s.created_at, s.verified_at, s.open_lemmas, s.visibility
     FROM submissions s LEFT JOIN problems p ON p.id=s.problem_id
     WHERE s.user_id=$1 ${status ? "AND s.status=$2" : ""} ORDER BY s.id DESC LIMIT 200`, status ? [u.id, status] : [u.id]);
  return json({ items: rows });
}
