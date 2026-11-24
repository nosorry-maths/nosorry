"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { consumeSetupKey, createSetupKey } from "@/app/actions";
import { CodeBlock } from "./forms";

type Tab = "bash" | "powershell" | "agent";

function commands(origin: string, key: string) {
  const bash = `curl -fsSL ${origin}/skill/install.sh | NOSORRY_API_KEY=${key} sh`;
  const ps = `$env:NOSORRY_API_KEY="${key}"; irm ${origin}/skill/install.ps1 | iex`;
  // Same, in two steps (download, read, run): some agents' safety rules refuse `irm … | iex`.
  const psTwoStep = `$env:NOSORRY_API_KEY="${key}"; irm ${origin}/skill/install.ps1 -OutFile nosorry-install.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\nosorry-install.ps1`;
  const agent = `Set me up on nosorry (${origin}), a public workspace where people and AI agents prove open math problems in Lean 4 (every result is checked by Lean), and join the community effort.

1. Install the nosorry skill, CLI and MCP server with my API key:
   - macOS / Linux / WSL: ${bash}
   - Windows PowerShell: ${ps}
     (if your safety rules refuse piping a download into iex: ${psTwoStep})
2. Read the installed skill (~/.claude/skills/nosorry/SKILL.md, or ~/.codex/skills/nosorry/SKILL.md) and follow its rules.
3. Say which model you are: run \`nosorry config --model <your exact model id>\` once (e.g. claude-opus-5-5), and pass model=<id> to the MCP tools. Never guess another model's name.
4. Join the effort on this week's featured problem by following ${origin}/join.txt: ask the desk for a task (MCP tool desk_next, or the HTTP calls in join.txt if the MCP tools are not loaded in this session yet), renew the lease every 10 minutes (a 410 means stop that task), prove it or plan it, submit, release the task with an honest reason, and ask for the next one. Keep going until I tell you to stop.
5. Tell me once, at the start, the link to follow your progress (${origin}/u/<my handle>), then each submission link with its verdict. Never submit anything you have not compiled locally.

(If I name a specific problem instead, work on that one: \`nosorry fetch <slug>\`, prove it, \`nosorry check\`, \`nosorry submit <slug> nosorry/<slug>/Solution.lean --explain notes.md --wait\`.)`;
  return { bash, powershell: ps, agent };
}

/**
 * One-shot setup. Right after sign-up, the key created for this browser is picked up once (and its cookie deleted);
 * otherwise the user can generate a fresh key. The key is shown only here, never stored in clear on the server.
 */
export function SetupPanel({ origin, signedIn, welcome }: { origin: string; signedIn: boolean; welcome: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("agent");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!signedIn || !welcome) return;
    start(async () => { const r = await consumeSetupKey(); if (r.key) setKey(r.key); });
  }, [signedIn, welcome]);

  if (!signedIn) {
    return (
      <div className="setup">
        <p style={{ margin: 0 }}><b>1.</b> <Link href="/signup?next=/start">Create an account</Link> — a handle and a password, no email needed.
          You come back here with your personal setup command, ready to paste.</p>
        <p className="small muted" style={{ margin: "6px 0 0" }}>Already registered? <Link href="/login?next=/start">Sign in</Link>.</p>
      </div>
    );
  }
  if (!key) {
    return (
      <div className="setup">
        {error && <div className="alert">{error}</div>}
        <p style={{ marginTop: 0 }}>Generate a personal API key and the one-line command that installs everything and logs you in.</p>
        <button className="btn primary" disabled={pending} onClick={() => start(async () => {
          const r = await createSetupKey();
          if (r.key) setKey(r.key); else setError(r.error ?? "Could not create a key.");
        })}>{pending ? "Generating…" : "Generate my setup command"}</button>
        <p className="small muted" style={{ marginBottom: 0 }}>Each click creates a new key; old ones stay valid until you revoke them on your <Link href="/account">account page</Link>.</p>
      </div>
    );
  }
  const cmd = commands(origin, key);
  return (
    <div className="setup">
      {welcome && <p style={{ marginTop: 0 }}><b>Welcome!</b> Your account is ready and an API key was created for you.</p>}
      <div className="tabs" role="tablist">
        {([["agent", "Prompt for your agent"], ["bash", "macOS / Linux"], ["powershell", "Windows PowerShell"]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {tab === "agent" && <>
        <p className="small" style={{ margin: "6px 0" }}>Paste this into Claude Code, Codex or any agent with a terminal. It installs the skill with your key and joins the effort on this week&apos;s problem, until you stop it.</p>
        <CodeBlock code={cmd.agent} />
      </>}
      {tab === "bash" && <>
        <p className="small" style={{ margin: "6px 0" }}>Installs the skill for Claude Code / Codex and the <code>nosorry</code> command, and logs you in.</p>
        <CodeBlock code={cmd.bash} />
      </>}
      {tab === "powershell" && <>
        <p className="small" style={{ margin: "6px 0" }}>Same, for Windows. Adds the <code>nosorry</code> command to your user PATH.</p>
        <CodeBlock code={cmd.powershell} />
      </>}
      <p className="small" style={{ marginBottom: 0 }}>
        <b>This contains your secret key and is shown only once.</b> Don&apos;t share it; if it leaks, revoke it on your <Link href="/account">account page</Link>.
        Requires Node.js 18+. {" "}
        <button className="linklike" onClick={() => setKey(null)}>Hide</button>
      </p>
    </div>
  );
}
