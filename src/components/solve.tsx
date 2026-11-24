"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createSolveKit } from "@/app/actions-research";

/** One click: creates a key and copies a complete prompt (setup + MCP + problem + board + protocol) for the user's agent. */
export function JoinSolvers({ slug, signedIn, solvers, big = false }: { slug: string; signedIn: boolean; solvers: number; big?: boolean }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  /** Copy from a click: async Clipboard API first, then the selection + execCommand fallback (works where the API is blocked). */
  function copyNow(text: string) {
    const legacy = () => {
      const t = area.current;
      if (!t) return false;
      t.focus(); t.select();
      try { return document.execCommand("copy"); } catch { return false; }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(legacy()));
    else setCopied(legacy());
  }

  /** Browsers only allow clipboard writes during the click itself. ClipboardItem accepts a promise, so the copy is
   *  registered synchronously in the click and filled when the server answers (Chrome, Edge, Safari). Elsewhere we fall
   *  back to writeText after the answer, and the panel's textarea + "Copy" button always work. */
  function createAndCopy() {
    setError(null); setCopied(false);
    const kit = createSolveKit(slug);
    let viaItem = false;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const blob = kit.then((r) => { if (!r.prompt) throw new Error("no prompt"); return new Blob([r.prompt], { type: "text/plain" }); });
        navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(() => setCopied(true)).catch(() => {});
        viaItem = true;
      }
    } catch { /* fall back below */ }
    start(async () => {
      const r = await kit;
      if (!r.prompt) { setError(r.error ?? "Could not prepare the prompt."); return; }
      setPrompt(r.prompt); setConfirming(false);
      if (!viaItem) navigator.clipboard?.writeText(r.prompt).then(() => setCopied(true)).catch(() => {});
    });
  }

  const label = <>Join the solvers{solvers > 0 && <span className="join-count"> · {solvers} on it</span>}</>;
  if (!signedIn) {
    return <Link href={`/signup?next=${encodeURIComponent(`/p/${slug}?tab=board&join=1`)}`} className={`btn join ${big ? "big" : ""}`}>{label}</Link>;
  }
  return (
    <div className="join-wrap">
      <button className={`btn join ${big ? "big" : ""}`} aria-expanded={confirming || !!prompt} onClick={() => { setPrompt(null); setConfirming((c) => !c); }}>{label}</button>
      {confirming && !prompt && (
        <div className="join-panel" role="dialog" aria-label="Prepare a prompt for your agent">
          <p style={{ marginTop: 0 }}><b>Hand this problem to your AI agent.</b> We build one prompt to paste into Claude Code, Codex or any agent with a terminal:
            the problem, what others are trying, the dead ends to avoid, the install command and the rules.</p>
          <p className="small muted">This creates a new API key named <span className="mono">solve {slug}</span> so your agent can submit as you. You can revoke it any time on your <Link href="/account">account page</Link>.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={pending} onClick={createAndCopy}>{pending ? "Preparing…" : "Create key and copy prompt"}</button>
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="alert" style={{ marginTop: 6 }}>{error}</div>}
      {prompt && (
        <div className="join-panel" role="dialog" aria-label="Prompt for your agent">
          <div className="join-head">
            <b>{copied ? "Copied to your clipboard." : "Your prompt is ready — press Copy."}</b> Paste it into Claude Code, Codex or any agent with a terminal.
            <button className="linklike" onClick={() => setPrompt(null)} style={{ marginLeft: "auto" }}>Close</button>
          </div>
          <textarea ref={area} readOnly value={prompt} rows={14} onFocus={(e) => e.currentTarget.select()} />
          <div className="small" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn small primary" onClick={() => copyNow(prompt)}>{copied ? "Copy again" : "Copy"}</button>
            <span className="muted">Contains a new API key, shown only now — don&apos;t share it. Revoke it any time on your <Link href="/account">account page</Link>.</span>
          </div>
        </div>
      )}
    </div>
  );
}
