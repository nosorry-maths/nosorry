"use client";
import { useEffect, useRef, useState } from "react";

type Ev = { id: number; type: string; handle: string | null; summary: string; unverified: boolean; created_at: string };

const TYPE_LABEL: Record<string, string> = {
  "lead.start": "lead", "lead.update": "lead", "lead.close": "closed", "lead.stale": "stale", "lead.join": "joined",
  idea: "idea", promising: "promising", "dead-end": "dead end", question: "question", reply: "reply",
  record: "RECORD", verified: "verified", brick: "brick", "round.open": "round", "round.summary": "round", "statement.version": "statement", critique: "critique", "critique.resolve": "decision", lemma: "lemma", "lemma.proved": "lemma proved", "lemma.used": "lemma used", upstream: "upstream",
};
const ago = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
};

/** The problem's event stream, live (server-sent events with a cursor), filterable. */
export function LiveStream({ slug, initial }: { slug: string; initial: Ev[] }) {
  const [events, setEvents] = useState<Ev[]>(initial);
  const [filter, setFilter] = useState<string>("all");
  // "live": server-sent events; "polling": the live connection could not open (browser connection limit, proxy
  // buffering…), so we refresh every 15 s; "offline": even that fails. Never stuck on "connecting…".
  const [mode, setMode] = useState<"connecting" | "live" | "polling" | "offline">("connecting");
  const cursor = useRef(initial.length ? initial[initial.length - 1].id : 0);
  useEffect(() => {
    const add = (evs: Ev[]) => {
      if (!evs.length) return;
      cursor.current = Math.max(cursor.current, ...evs.map((e) => Number(e.id)));
      setEvents((xs) => [...xs, ...evs.filter((e) => !xs.some((x) => x.id === e.id))]);
    };
    const url = (since: number) => `/api/v1/problems/${encodeURIComponent(slug)}/stream?since=${since}`;
    let poll: ReturnType<typeof setInterval> | undefined;
    const startPolling = () => {
      if (poll) return;
      es.close();
      const tick = () => fetch(url(cursor.current), { headers: { accept: "application/json" }, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j: { events: Ev[] }) => { add(j.events ?? []); setMode("polling"); })
        .catch(() => setMode("offline"));
      tick(); poll = setInterval(tick, 15_000);
    };
    const es = new EventSource(url(cursor.current));
    const fallback = setTimeout(startPolling, 6000);
    es.onopen = () => { clearTimeout(fallback); setMode("live"); };
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) startPolling(); else setMode((m) => (m === "live" ? "connecting" : m)); };
    es.addEventListener("problem", (m) => add([JSON.parse((m as MessageEvent).data) as Ev]));
    return () => { clearTimeout(fallback); if (poll) clearInterval(poll); es.close(); };
  }, [slug]);
  const groups: Record<string, (t: string) => boolean> = {
    all: () => true,
    results: (t) => t === "record" || t === "verified" || t === "brick",
    leads: (t) => t.startsWith("lead."),
    notes: (t) => ["idea", "promising", "dead-end", "question", "reply"].includes(t),
    statement: (t) => t.startsWith("critique") || t === "statement.version",
  };
  const shown = events.filter((e) => groups[filter](e.type)).slice().reverse();
  return (
    <div>
      <div className="optbar">
        <span className="grp">Show:{" "}
          {Object.keys(groups).map((g) => (filter === g ? <b key={g}>{g} </b> : <button key={g} className="linklike" onClick={() => setFilter(g)}>{g} </button>))}
        </span>
        <span className={`live ${mode === "live" ? "on" : ""}`} title={mode === "polling" ? "The live connection could not open; the list refreshes every 15 seconds." : undefined}>
          {mode === "live" ? "● live" : mode === "polling" ? "◐ refreshing every 15 s" : mode === "offline" ? "○ offline — reload the page" : "○ connecting…"}</span>
      </div>
      <ol className="stream">
        {shown.map((e) => (
          <li key={e.id} className={`ev ev-${e.type.replace(".", "-")}`}>
            <span className="ev-type">{TYPE_LABEL[e.type] ?? e.type}</span>
            <span className="ev-text">{e.summary}{e.unverified && <span className="unv"> UNVERIFIED</span>}</span>
            <span className="ev-time">{ago(e.created_at)}</span>
          </li>
        ))}
        {!shown.length && <li className="muted small">Nothing yet. Start a lead or post an idea — it will appear here for everyone, live.</li>}
      </ol>
    </div>
  );
}
