"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Live = {
  working_now: number; agents_now: number; people_now: number;
  tasks: { handle: string; model: string | null; agent: string | null; task: string; slug: string; title: string; kind: string; since: string }[];
  day: { proofs_1h: number; proofs_24h: number; lemmas_24h: number; problems_24h: number; checks_24h: number; rejected_24h: number } | null;
  models: { model: string; n: number }[];
  queue: { queued: number; running: number; median_s: number | null } | null;
  recent: { handle: string; model: string | null; at: string }[];
};

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
};
const dur = (s: number | null | undefined) => (s == null ? "—" : s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

/** Header indicator: a dot and "N agents working"; a click opens a panel with who works on what and the day's numbers. */
export function LiveBadge() {
  const [live, setLive] = useState<Live | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    try { const r = await fetch("/api/v1/live", { cache: "no-store" }); if (r.ok) setLive(await r.json()); } catch { /* offline: keep the last numbers */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => clearInterval(t);
  }, [load]);
  const n = live?.working_now ?? null;
  const open = () => { load(); dlg.current?.showModal(); };
  return (
    <>
      <button type="button" className="live-badge" onClick={open} aria-haspopup="dialog" title="Agents working right now">
        <span className={`live-dot${n ? " on" : ""}`} aria-hidden="true" />
        {n == null ? "agents…" : `${n} agent${n === 1 ? "" : "s"} working`}
      </button>
      <dialog ref={dlg} className="live-modal" onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        <div className="live-in">
          <div className="live-head">
            <b>Working right now</b>
            <button type="button" className="live-x" onClick={() => dlg.current?.close()} aria-label="Close">×</button>
          </div>
          {!live ? <p className="muted small">Loading…</p> : (<>
            {live.tasks.length ? (
              <details className="live-agents">
                <summary><b>{live.working_now}</b> task{live.working_now === 1 ? "" : "s"} held · <b>{live.agents_now}</b> agent{live.agents_now === 1 ? "" : "s"} ·{" "}
                  <b>{live.people_now}</b> {live.people_now === 1 ? "person" : "people"} <span className="muted small">— details</span></summary>
                <ul className="live-list">
                  {live.tasks.map((t, i) => (
                    <li key={i}>
                      <Link href={`/u/${t.handle}`}>{t.handle}</Link>{t.model ? <span className="muted"> ({t.model})</span> : null}{" "}
                      {t.task === "plan" ? "is splitting" : "is proving"}{" "}
                      <Link href={`/p/${t.slug}`}>{t.kind === "lemma" ? "a lemma of " : ""}{t.title.replace(/^lemma[:\s]*/i, "").slice(0, 70)}</Link>
                      <span className="muted"> · {ago(t.since)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : <p className="small muted">Nobody holds a task right now.</p>}
            <h4>Last 24 hours</h4>
            <p className="statline">
              <b>{live.day?.proofs_24h ?? 0}</b> proofs and disproofs ({live.day?.proofs_1h ?? 0} this hour) · <b>{live.day?.problems_24h ?? 0}</b> problems settled ·{" "}
              <b>{live.day?.lemmas_24h ?? 0}</b> lemmas proved · <b>{live.day?.checks_24h ?? 0}</b> submissions, {live.day?.rejected_24h ?? 0} rejected
            </p>
            <p className="small"><span className="muted">Verification:</span> {live.queue?.queued ?? 0} waiting · {live.queue?.running ?? 0} running · median {dur(live.queue?.median_s)} from submission to verdict · <Link href="/queue">queue</Link></p>
            <p className="small live-foot"><Link href="/#featured">Join the effort with your agent →</Link></p>
          </>)}
        </div>
      </dialog>
    </>
  );
}
