import { one } from "@/lib/db";
import { currentUser, isModerator } from "@/lib/auth";
import { parseTranscript, redact } from "@/lib/transcript";

// Download a submission's agent transcript, cleaned (paths, user names, e-mails, IPs, hosts, secrets removed, shown as
// [redacted:…] marks). Same access as the page: public transcripts for everyone, otherwise its author and moderators.
//   /s/<id>/transcript?format=txt | md | json | jsonl   (&inline=1 to read it in the browser instead of downloading)
const TYPES = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
} as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "txt") as keyof typeof TYPES;
  if (!(format in TYPES)) return new Response("format: txt | md | json | jsonl", { status: 400 });
  const s = await one<{ id: number; public_id: string; user_id: number; visibility: string; transcript_public: boolean; kind: string; slug: string | null;
    agent_name: string | null; agent_model: string | null; created_at: string }>(
    `SELECT s.id, s.public_id, s.user_id, s.visibility, s.transcript_public, s.kind, p.slug, s.agent_name, s.agent_model, s.created_at
     FROM submissions s LEFT JOIN problems p ON p.id=s.problem_id WHERE s.public_id=$1`, [id]);
  if (!s) return new Response("not found", { status: 404 });
  const user = await currentUser();
  const owner = !!user && Number(user.id) === Number(s.user_id), mod = isModerator(user);
  if (!(owner || mod || (s.transcript_public && s.visibility !== "private"))) return new Response("not found", { status: 404 });
  const t = await one<{ format: string; content: string }>("SELECT format, content FROM transcripts WHERE submission_id=$1", [s.id]);
  if (!t) return new Response("this submission has no agent transcript", { status: 404 });

  const clean = redact(t.content);
  const turns = parseTranscript(t.format, clean.text);
  const head = `nosorry ${s.public_id} — ${s.kind}${s.slug ? ` of ${s.slug}` : ""} — agent ${s.agent_name ?? "?"} (${s.agent_model ?? "model not given"}) — ${new Date(s.created_at).toISOString()}`;
  const note = `Self-reported agent transcript, cleaned automatically: ${clean.count} item(s) removed (paths, user names, e-mails, IP addresses, host names, secrets), shown as [redacted:…], [path], [user], [ip] or …/file.`;
  let body: string;
  if (format === "jsonl") body = clean.text;
  else if (format === "json") body = JSON.stringify({ submission: s.public_id, problem: s.slug, kind: s.kind, agent: { name: s.agent_name, model: s.agent_model },
    source_format: t.format, redactions: clean.count, note, turns }, null, 2);
  else if (format === "md") body = `# ${head}\n\n> ${note}\n\n` + turns.map((x) => `### ${x.role}\n\n${x.text}\n`).join("\n");
  else body = `${head}\n${note}\n\n` + turns.map((x) => `── ${x.role} ──\n${x.text}\n`).join("\n");

  const inline = url.searchParams.get("inline") === "1";
  return new Response(body, { headers: {
    "content-type": TYPES[format],
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${s.public_id}-transcript.${format}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  } });
}
