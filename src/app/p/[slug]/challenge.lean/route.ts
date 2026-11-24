import { one } from "@/lib/db";

// GET /p/<slug>/challenge.lean            view in the browser
// GET /p/<slug>/challenge.lean?download=1 download as <Ident>-Challenge.lean
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const r = await one<{ challenge_source: string; ident: string; version: number }>(
    `SELECT v.challenge_source, p.ident, v.version FROM problems p JOIN problem_versions v ON v.id=p.current_version_id WHERE p.slug=$1`,
    [(await params).slug]);
  if (!r) return new Response("not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const name = `${r.ident.replace(/[^A-Za-z0-9.]/g, "")}v${r.version}-Challenge.lean`;
  return new Response(r.challenge_source, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${download ? name : "Challenge.lean"}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
