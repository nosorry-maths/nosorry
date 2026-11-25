"use client";
import { useEffect, useState } from "react";

/** Copy a text to the clipboard. Works inside a <summary> (does not toggle it) and where the async API is blocked. */
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const legacy = () => {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    return ok;
  };
  const show = (ok: boolean) => { setState(ok ? "done" : "fail"); setTimeout(() => setState("idle"), 1800); };
  return (
    <button type="button" className="btn small" onClick={(e) => {
      e.preventDefault(); e.stopPropagation();
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => show(true), () => show(legacy()));
      else show(legacy());
    }}>
      {state === "done" ? "Copied" : state === "fail" ? "Copy failed" : label}
    </button>
  );
}

/** Live elapsed time since `since` (ISO), as "123.4 s" — for the pipeline stage that is running now. */
export function Elapsed({ since }: { since: string }) {
  const t0 = new Date(since).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const s = now == null ? null : Math.max(0, (now - t0) / 1000);
  return <span className="ms elapsed" title="running for">{s == null ? "…" : `${s.toFixed(1)} s`}</span>;
}

/** Copy a server text (fetched on click, e.g. a cleaned transcript) and offer it as a download in several formats. */
export function TranscriptTools({ base }: { base: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const [format, setFormat] = useState("txt");
  const show = (ok: boolean) => { setState(ok ? "done" : "fail"); setTimeout(() => setState("idle"), 1800); };
  const copy = () => {
    const url = `${base}?format=txt&inline=1`;
    // ClipboardItem with a promise keeps the click's permission while the text is fetched (Chrome, Edge, Safari).
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      navigator.clipboard.write([new ClipboardItem({ "text/plain": fetch(url).then((r) => r.blob()) })]).then(() => show(true), () =>
        fetch(url).then((r) => r.text()).then((t) => navigator.clipboard.writeText(t)).then(() => show(true), () => show(false)));
    } else fetch(url).then((r) => r.text()).then((t) => navigator.clipboard.writeText(t)).then(() => show(true), () => show(false));
  };
  return (
    <div className="tr-tools">
      <button type="button" className="btn small" onClick={copy}>{state === "done" ? "Copied" : state === "fail" ? "Copy failed" : "Copy the transcript"}</button>
      <span className="small muted">Export as</span>
      <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Export format">
        <option value="txt">Plain text (.txt)</option>
        <option value="md">Markdown (.md)</option>
        <option value="json">JSON, one object per turn (.json)</option>
        <option value="jsonl">Original log, cleaned (.jsonl)</option>
      </select>
      <a className="btn small" href={`${base}?format=${format}`} download>Download</a>
      <a className="small" href={`${base}?format=${format === "json" || format === "jsonl" ? "txt" : format}&inline=1`} target="_blank" rel="noopener">open in a new tab</a>
    </div>
  );
}
