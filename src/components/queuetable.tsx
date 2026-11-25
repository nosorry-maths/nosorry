"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Job = {
  id: number; job_kind: string; state: string; priority: number; created_at: string; started_at: string | null; finished_at: string | null;
  public_id: string; sub_status: string; sub_kind: string; slug: string | null; title: string | null; is_lemma: boolean; model: string | null;
};
type Stats = { queued: number; running: number; done_1h: number; avg_wait_s: number | null; dead: number; workers: number } | null;
type Data = { stats: Stats; workers: number; jobs: Job[] };

/** What the job is about, in one word, then the problem. */
function typeOf(j: Job): { key: string; label: string } {
  if (j.job_kind === "reverify") return { key: "recheck", label: "Re-check" };
  if (j.sub_kind === "formalization") return j.is_lemma ? { key: "lemma", label: "Lemma statement" } : { key: "formalization", label: "Formalization" };
  if (j.is_lemma) return { key: "lemma", label: "Lemma proof" };
  if (j.sub_kind === "disproof") return { key: "disproof", label: "Disproof" };
  if (j.sub_kind === "partial") return { key: "partial", label: "Partial proof" };
  if (j.sub_kind === "finding") return { key: "finding", label: "Finding" };
  return { key: "proof", label: "Proof" };
}
const TYPES: [string, string][] = [["all", "All types"], ["proof", "Proofs"], ["disproof", "Disproofs"], ["partial", "Partial"], ["lemma", "Lemmas"], ["formalization", "Formalizations"], ["recheck", "Re-checks"]];
const STATES: [string, string][] = [["all", "All"], ["active", "Waiting or running"], ["done", "Finished"]];

function ago(iso: string, now: number) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) { const h = Math.floor(s / 3600); return `${h} hour${h > 1 ? "s" : ""} ago`; }
  const d = Math.floor(s / 86400); return `${d} day${d > 1 ? "s" : ""} ago`;
}
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** A duration in words: 42 s, 3 min 05 s, 1 h 12 min. */
function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}
const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
const lane = (j: Job) => (j.job_kind === "reverify" ? "re-check" : j.priority <= 100 ? "interactive" : j.priority < 150 ? "new account" : "formalization");
const STATE_LABEL: Record<string, string> = { queued: "waiting", running: "checking", done: "done", dead: "failed" };
// Same labels and colour classes as the site's <Status> (components/ui.tsx, server-only).
const SUB_LABEL: Record<string, string> = { verified: "verified", human_verified: "human-verified", partial: "partial", rejected: "rejected", error: "server error", needs_review: "in review",
  queued: "queued", running: "checking", accepted: "accepted", revoked: "revoked", superseded: "superseded", duplicate: "duplicate" };
const SubStatus = ({ s }: { s: string }) => <span className={`st st-${s}`}>{SUB_LABEL[s] ?? s}</span>;

/** The jobs table of /queue: refreshed every 5 s while the page is visible, newest first, with two filters. */
export function QueueTable({ initial }: { initial: Data }) {
  const [data, setData] = useState<Data>(initial);
  const [type, setType] = useState("all");
  const [state, setState] = useState("all");
  // Times are computed in the browser only (its clock and time zone): the server render leaves them empty, so they never
  // show the server's UTC time or a stale "x min ago".
  const [now, setNow] = useState<number | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch("/api/v1/queue", { cache: "no-store" }); if (r.ok) setData(await r.json()); } catch { /* keep the last data */ }
    setNow(Date.now());
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000); // running durations move every second
    const back = () => { if (document.visibilityState === "visible") load(); }; // fresh data as soon as the tab is shown again
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(poll); clearInterval(tick); document.removeEventListener("visibilitychange", back); };
  }, [load]);
  const rows = useMemo(() => data.jobs.filter((j) => {
    if (type !== "all" && typeOf(j).key !== type) return false;
    if (state === "active" && !["queued", "running"].includes(j.state)) return false;
    if (state === "done" && ["queued", "running"].includes(j.state)) return false;
    return true;
  }), [data, type, state]);
  const st = data.stats;
  return (
    <>
      <p className="stats-line">
        <b>{st?.queued ?? 0}</b> waiting · <b>{st?.running ?? 0}</b> checking · <b>{st?.done_1h ?? 0}</b> checked in the last hour ·
        median time to verdict (24 h): <b>{st?.avg_wait_s != null ? (st.avg_wait_s < 90 ? `${st.avg_wait_s} s` : `${Math.round(st.avg_wait_s / 60)} min`) : "—"}</b> ·{" "}
        <b>{data.workers}</b> worker{data.workers === 1 ? "" : "s"} online <span className="muted small">· live</span>
      </p>
      <div className="q-filters" role="group" aria-label="Filters">
        <label>Type <select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>State <select value={state} onChange={(e) => setState(e.target.value)}>{STATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <span className="muted small">{rows.length} of {data.jobs.length} recent jobs</span>
      </div>
      <div className="scroll-x">
        <table className="t q-table">
          <thead><tr><th>Job</th><th>Type</th><th>State</th><th>Submission</th><th title="interactive submissions first, then new accounts and formalizations; re-checks after a statement correction jump ahead">Lane</th><th>Submitted</th>
            <th title="from submission until a worker started it">Waited</th><th title="from start to verdict (live while it runs)">Took</th></tr></thead>
          <tbody>
            {rows.map((j) => {
              const t = typeOf(j);
              return (
                <tr key={j.id} className={`q-${j.state}`}>
                  <td className="mono">#{j.id}</td>
                  <td className="q-type" title={`${t.label}${j.title ? ` of ${j.title}` : ""}${j.model ? ` · ${j.model}` : ""}`}>
                    <b>{t.label}</b>{j.slug && <> · <Link href={`/p/${j.slug}`}>{(j.title ?? j.slug).replace(/^Lemma[:\s]*/i, "")}</Link></>}
                  </td>
                  <td><span className={`q-state q-state-${j.state}${j.state === "queued" || j.state === "running" ? ` st st-${j.state}` : ""}`}>{STATE_LABEL[j.state] ?? j.state}</span></td>
                  <td><Link href={`/s/${j.public_id}`} className="mono">{j.public_id}</Link> <SubStatus s={j.sub_status} /></td>
                  <td>{lane(j)}</td>
                  <td className="muted q-created">{now == null ? "…" : <>{fmt(j.created_at)} <span className="small">({ago(j.created_at, now)})</span></>}</td>
                  <td className="muted num">{now == null ? "…" : j.state === "queued" ? <i title="still waiting">{dur(now - ms(j.created_at)!)}</i> : j.started_at ? dur(ms(j.started_at)! - ms(j.created_at)!) : "—"}</td>
                  <td className="num">{now == null ? "…" : !j.started_at || j.state === "queued" ? "—" : j.finished_at ? dur(ms(j.finished_at)! - ms(j.started_at)!)
                    : j.state === "running" ? <b className="elapsed">{dur(now - ms(j.started_at)!)}</b> : "—"}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="muted">{data.jobs.length ? "No job matches these filters." : "The queue is empty."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
