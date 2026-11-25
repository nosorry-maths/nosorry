"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { login, signup, submitWeb, createApiKey } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  const challenge = state && "challenge" in state ? state.challenge : undefined;
  if (challenge) {
    // Step 2: the password was right; the account also needs a code from its authenticator app.
    return (
      <form action={action}>
        {state?.error && <div className="alert" role="alert">{state.error}</div>}
        <input type="hidden" name="challenge" value={challenge} />
        <div className="field-row"><label htmlFor="code">Code from your authenticator app</label>
          <input id="code" name="code" required autoFocus inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" className="mono" />
          <div className="hint">Two-step verification is on for this account. The code changes every 30 seconds.</div></div>
        <button className="btn primary" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
      </form>
    );
  }
  return (
    <form action={action}>
      {state?.error && <div className="alert" role="alert">{state.error}</div>}
      <input type="hidden" name="next" value={next} />
      <div className="field-row"><label htmlFor="h">Handle or email</label><input id="h" type="text" name="handle" required autoComplete="username" /></div>
      <div className="field-row"><label htmlFor="pw">Password</label><input id="pw" type="password" name="password" required autoComplete="current-password" /></div>
      <button className="btn primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signup, null);
  return (
    <form action={action} noValidate>
      {state?.error && <div className="alert" role="alert">{state.error}</div>}
      <input type="hidden" name="next" value={next} />
      <div style={{ position: "absolute", left: "-10000px" }} aria-hidden="true"><input type="text" name="website" tabIndex={-1} autoComplete="off" /></div>
      <div className="field-row"><label htmlFor="h">Handle</label><input id="h" type="text" name="handle" required autoComplete="username" aria-describedby="h-hint" />
        <div className="hint" id="h-hint">Public. 3 to 32 characters: letters, digits, _ or -. No spaces.</div></div>
      <div className="field-row"><label htmlFor="e">Email <span className="muted">(optional for now)</span></label><input id="e" type="email" name="email" autoComplete="email" aria-describedby="e-hint" />
        <div className="hint" id="e-hint">Not verified yet. It will be needed to keep submitting once email verification is switched on.</div></div>
      <div className="field-row"><label htmlFor="pw">Password</label><input id="pw" type="password" name="password" required autoComplete="new-password" aria-describedby="pw-hint" />
        <div className="hint" id="pw-hint">At least 10 characters.</div></div>
      <div className="field-row"><label style={{ fontWeight: "normal" }}><input type="checkbox" name="terms" required /> I accept the <Link href="/terms" target="_blank">Terms of use</Link> and
        the <Link href="/privacy" target="_blank">Privacy policy</Link>. What I publish (proofs, findings, critiques, comments) is released under the Apache-2.0 licence, like the statements it builds on.</label></div>
      <button className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
    </form>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="codeblock">
      <pre>{code}</pre>
      <CopyButton text={code} />
    </div>
  );
}

export function ApiKeyForm({ origin }: { origin: string }) {
  const [state, action, pending] = useActionState(createApiKey, {});
  return (
    <>
      {state?.error && <div className="alert" role="alert">{state.error}</div>}
      {state?.key && (
        <div className="note" role="status">
          <p><b>Your new key “{state.name}”. Copy it now: it will not be shown again</b> (only a hash is stored).</p>
          <CodeBlock code={state.key} />
          <p className="small" style={{ marginTop: 8 }}>Ready to paste — bash / zsh:</p>
          <CodeBlock code={`export NOSORRY_API_KEY=${state.key}\nexport NOSORRY_URL=${origin}`} />
          <p className="small">PowerShell:</p>
          <CodeBlock code={`$env:NOSORRY_API_KEY="${state.key}"\n$env:NOSORRY_URL="${origin}"`} />
          <p className="small">Next: <Link href="/start#setup">install the agent skill</Link> (one command).</p>
        </div>
      )}
      <form action={action} style={{ display: "flex", gap: 6, marginTop: 8, maxWidth: 480 }}>
        <input type="text" name="name" placeholder="Key name, e.g. claude-code laptop" aria-label="Key name" />
        <button className="btn primary" style={{ whiteSpace: "nowrap" }} disabled={pending}>{pending ? "Creating…" : "New key"}</button>
      </form>
    </>
  );
}

/** Submit button that asks for confirmation first. */
export function ConfirmSubmit({ label, message, className = "btn small" }: { label: string; message: string; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{label}</button>
  );
}

type ProblemInfo = { slug: string; title: string; decl_name: string | null; statement_lean: string | null; challenge_source: string | null; status: string; statement_status: string; formalization?: string; metric_name?: string | null; metric_direction?: string | null } | null;

const KIND_HELP: Record<string, string> = {
  proof: "A complete Lean proof of the target theorem. No sorry in anything the target depends on, no new axioms.",
  disproof: "A proof that the statement is false: declare `theorem <Namespace>.not_<name> : ¬ (statement)` next to the unchanged definitions.",
  partial: "The target proved from lemmas you leave as sorry. Each remaining lemma is listed publicly as an open sub-problem.",
  finding: "Prose: a reference, an observation, a counterexample idea, a connection. Reviewed by people, not by Lean.",
  formalization: "Propose a new problem: a Lean file whose target theorem is stated with `sorry` as its proof. Reviewed before it is listed.",
};

/** Challenge.lean plus a `not_<name>` theorem stating the negation, inserted before the closing `end <Namespace>`. */
function disproofStarter(info: NonNullable<ProblemInfo>, notName: string) {
  const short = notName.split(".").pop()!;
  const m = (info.statement_lean ?? "").match(/^(?:theorem|lemma)\s+\S+\s*:\s*([\s\S]*)$/);
  const neg = m
    ? `theorem ${short} : ¬ (${m[1].trim()}) := by\n  sorry`
    : `-- The statement has binders before the colon: state ¬ (∀ binders, statement) exactly.\ntheorem ${short} : ¬ (sorry) := by\n  sorry`;
  const src = info.challenge_source ?? "";
  const idx = src.search(/\nend\s+[^\n]*\s*$/);
  return idx >= 0 ? `${src.slice(0, idx)}\n\n${neg}\n${src.slice(idx)}` : `${src}\n\n${neg}\n`;
}

export function SubmitForm({ problem, initialKind = "proof" }: { problem: string; initialKind?: string }) {
  const [state, action, pending] = useActionState(submitWeb, null);
  const [kind, setKind] = useState(["proof", "disproof", "partial", "finding", "formalization"].includes(initialKind) ? initialKind : "proof");
  const [slug, setSlug] = useState(problem);
  const [info, setInfo] = useState<ProblemInfo>(null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "missing">("idle");
  const [lean, setLean] = useState("");
  const needsProblem = true;
  const problemOptional = kind === "formalization";
  const needsLean = kind !== "finding";

  useEffect(() => {
    if (!slug.trim() || !needsProblem) { setInfo(null); setLookup("idle"); return; }
    setLookup("loading");
    const t = setTimeout(() => {
      fetch(`/api/v1/problems/${encodeURIComponent(slug.trim())}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
        setInfo(j); setLookup(j ? "idle" : "missing");
      }).catch(() => setLookup("missing"));
    }, 350);
    return () => clearTimeout(t);
  }, [slug, needsProblem]);

  const notName = info?.decl_name ? info.decl_name.replace(/\.([^.]+)$/, ".not_$1") : "";
  return (
    <form action={action}>
      {state?.error && <div className="alert" role="alert">{state.error}</div>}
      <div className="field-row"><label htmlFor="kind">What are you submitting?</label>
        <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="proof">Proof — the statement is true</option>
          <option value="disproof">Disproof — the statement is false</option>
          <option value="partial">Partial proof — reduced to open lemmas</option>
          <option value="finding">Finding — remark, reference, idea (prose)</option>
          <option value="formalization">Formalization — propose a new problem</option>
        </select>
        <div className="hint">{KIND_HELP[kind]}</div></div>

      {needsProblem && (
        <div className="field-row"><label htmlFor="problem">Problem</label>
          <input id="problem" type="text" name="problem" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="erdos-488 or NS.02256" required={!problemOptional} />
          {problemOptional && <div className="hint">To formalize a problem awaiting formalization (e.g. a Physlib statement), give its identifier; leave empty to propose a brand-new problem.</div>}
          {lookup === "loading" && <div className="hint">Looking up…</div>}
          {lookup === "missing" && <div className="hint" style={{ color: "var(--bad)" }}>No problem with this identifier.</div>}
          {info && (
            <div className="box" style={{ marginTop: 6 }}>
              <h4>{info.title} {info.decl_name && <span className="muted" style={{ fontWeight: "normal" }}>— target <code>{kind === "disproof" ? notName : info.decl_name}</code></span>}</h4>
              <div className="in">
                {info.statement_lean ? <pre style={{ margin: 0, maxHeight: 140 }}>{info.statement_lean}</pre>
                  : <p className="small" style={{ margin: 0 }}>No formal statement yet — this submission would provide it.</p>}
                {needsLean && info.challenge_source && kind !== "formalization" && (
                  <button type="button" className="btn small" style={{ marginTop: 6 }}
                    onClick={() => setLean(kind === "disproof" ? disproofStarter(info, notName) : info.challenge_source ?? "")}>
                    Start from Challenge.lean
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {kind === "formalization" && (<>
        <div className="field-row"><label htmlFor="target">Target theorem (fully qualified name)</label>
          <input id="target" type="text" name="target_decl" placeholder="MyProblem.main_conjecture" required /></div>
        <div className="field-row"><label htmlFor="title">Title</label><input id="title" type="text" name="title" required /></div>
      </>)}

      {needsLean && (
        <div className="field-row"><label htmlFor="lean">{kind === "formalization" ? "Statement file (.lean)" : "Solution.lean"}</label>
          <textarea id="lean" name="lean_source" rows={16} value={lean} onChange={(e) => setLean(e.target.value)}
            placeholder={kind === "formalization" ? "import Mathlib\n\nnamespace MyProblem\n\ntheorem main_conjecture : … := by\n  sorry\n\nend MyProblem" : "The whole file: the reference Challenge.lean with the sorry replaced by your proof."} />
          <div className="hint">…or upload a file: <input type="file" name="file" accept=".lean,text/plain" aria-label="Upload a .lean file" /></div></div>
      )}

      <div className="field-row"><label htmlFor="body">{kind === "finding" ? "Your finding (Markdown, TeX between $…$)" : kind === "formalization" ? "Informal statement and source (Markdown)" : "Notes (optional)"}</label>
        <textarea id="body" name="body_md" rows={kind === "finding" ? 8 : 3} style={{ fontFamily: "var(--font)" }} required={kind === "finding"} /></div>

      {(kind === "proof" || kind === "disproof" || kind === "partial") && (
        <div className="field-row"><label htmlFor="expl">Explanation of the idea</label>
          <textarea id="expl" name="explanation_md" rows={3} style={{ fontFamily: "var(--font)" }} />
          <div className="hint">A few sentences a mathematician can follow. Needed before the source can be published; optional to start the check.</div></div>
      )}

      {info?.metric_name && (kind === "proof") && (
        <fieldset className="field-row lineage">
          <legend>This is a challenge: your file must prove that a construction reaches a value of <b>{info.metric_name}</b> ({info.metric_direction === "min" ? "lower" : "higher"} is better). The verifier extracts the value itself.</legend>
          <label htmlFor="based_on">Builds on the record <span className="muted">(submission id, optional)</span></label>
          <input id="based_on" type="text" name="based_on" placeholder="e.g. 7KQ2M9 — the record you improved" />
          <label htmlFor="cites">Ideas you used <span className="muted">(note numbers from the board, comma-separated, optional)</span></label>
          <input id="cites" type="text" name="cites" placeholder="e.g. 12, 15" />
          <div className="hint">If your solution sets a record, points also go to the records and ideas you declare here. <Link href="/docs/scoring#records">How records are scored</Link></div>
        </fieldset>
      )}
      <div className="field-row"><label htmlFor="repo">Repository with your notes and attempts {kind === "finding" ? "(recommended)" : "(optional)"}</label>
        <input id="repo" type="text" name="repo_url" placeholder="https://github.com/you/your-research" />
        <div className="hint">Public GitHub, GitLab or Codeberg link. To keep a running log on this problem, also add it under <i>Research in progress</i> on the problem page.</div></div>
      <div className="field-row"><label htmlFor="derived">Prior work this builds on (links, submission ids, other people&apos;s research threads)</label>
        <input id="derived" type="text" name="derived_from" /></div>

      <details style={{ margin: "4px 0 12px" }}>
        <summary>Agent and transcript (optional)</summary>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
          <div className="field-row"><label htmlFor="an">Agent</label>
            <select id="an" name="agent_name" defaultValue="human">
              <option value="human">None (by hand)</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option>
              <option value="aristotle">Aristotle</option><option value="other">Other</option>
            </select></div>
          <div className="field-row"><label htmlFor="am">Model</label><input id="am" type="text" name="agent_model" placeholder="e.g. claude-opus-5-5" /></div>
        </div>
        <div className="field-row"><label htmlFor="tr">Session transcript</label>
          <select name="transcript_format" defaultValue="claude-code-jsonl" style={{ marginBottom: 4, width: "auto" }} aria-label="Transcript format">
            <option value="claude-code-jsonl">Claude Code (.jsonl)</option><option value="codex-jsonl">Codex (.jsonl)</option><option value="markdown">Markdown</option>
          </select>
          <input id="tr" type="file" name="transcript_file" accept=".jsonl,.json,.md,.txt" />
          <div className="hint">Keys, tokens, emails and home paths are removed automatically. It stays private until you publish the submission.</div></div>
      </details>

      <p className="hint">Your submission time is recorded the moment you press the button; it decides priority if two people prove the same thing.</p>
      <button className="btn primary" disabled={pending}>{pending ? "Submitting…" : kind === "finding" ? "Submit finding" : "Submit for verification"}</button>
    </form>
  );
}
