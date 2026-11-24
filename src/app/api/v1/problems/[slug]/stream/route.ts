import { anonLimit, err, json } from "@/lib/api";
import { streamSince } from "@/lib/feed";

export const dynamic = "force-dynamic";

/**
 * Events after a cursor. JSON by default: GET …/stream?since=123
 * Server-sent events with `Accept: text/event-stream`: the connection stays open and pushes new events (polled every 3 s,
 * closed after 10 min — reconnect with Last-Event-ID or ?since=).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const slug = (await params).slug;
  const url = new URL(req.url);
  let since = Number(req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0) || 0;
  const first = await streamSince(slug, since);
  if (!first) return err(404, "unknown problem");
  if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) return json(first);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (evs: { id: number }[]) => { for (const e of evs) ctrl.enqueue(enc.encode(`id: ${e.id}\nevent: problem\ndata: ${JSON.stringify(e)}\n\n`)); };
      send(first.events); since = first.cursor;
      const t0 = Date.now();
      while (!req.signal.aborted && Date.now() - t0 < 10 * 60_000) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await streamSince(slug, since).catch(() => null);
        if (r?.events.length) { send(r.events); since = r.cursor; } else ctrl.enqueue(enc.encode(`: keep-alive\n\n`));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
