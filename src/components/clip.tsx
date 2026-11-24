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
