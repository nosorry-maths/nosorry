import "server-only";

/**
 * Transcripts can be published, so they are cleaned before they are stored AND again when they are shown (older
 * transcripts benefit from new rules). Best-effort: secrets, e-mail addresses, phone numbers, IP addresses, private host
 * names, and file paths (which give away user names and folder layouts) are removed; user names seen in paths are
 * removed everywhere else too. The submitter is still responsible for what they publish.
 */
const SECRETS: [RegExp, string][] = [
  [/\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/g, "[redacted:api-key]"],
  [/\bns_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}\b/g, "[redacted:nosorry-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "[redacted:github-token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, "[redacted:github-token]"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, "[redacted:slack-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted:aws-key]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted:google-key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted:jwt]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted:private-key]"],
  [/\bssh-(?:rsa|ed25519|dss|ecdsa-[a-z0-9-]+) AAAA[0-9A-Za-z+/=]{20,}(?: [^\s"']+)?/g, "[redacted:ssh-key]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, "$1 [redacted]"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?key|access[_-]?key|client[_-]?secret)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, "$1$2[redacted]"],
  [/\b(https?:\/\/)[^\s/:@"']+:[^\s/@"']+@/g, "$1[redacted]@"],                       // credentials in URLs
];
const PERSONAL: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted:email]"],
  [/(?<![\w.])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?![\w.])/g, "[redacted:phone]"],
  [/(?<![\w.])0[1-9](?:[\s.-]?\d{2}){4}(?![\w.])/g, "[redacted:phone]"],             // French-style national numbers
  [/\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:ts\.net|local|lan|internal|home\.arpa|localdomain)\b/gi, "[redacted:host]"],
  [/(?<![\w.:])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g, "[ip]"],
  [/\b[A-Za-z]--(?:Users|home)-[A-Za-z0-9._-]+/g, "[redacted:path]"],                // tool folders named after a path
];
// Absolute paths: keep only the last component (the file name says what was used; the rest says who and where).
const WIN_PATH = /\b[A-Za-z]:(?:\\\\|\\|\/)(?:[^\s"'<>|*?:\\/\]\[(){}]+(?:\\\\|\\|\/))*([^\s"'<>|*?:\\/\]\[(){}]*)/g;
const UNIX_PATH = /(?<![\w.~:/-])\/(?:home|Users|root|mnt|tmp|var|opt|private|Volumes|srv|workspaces?|data|media|run|etc|usr|nix|scratch|projects?)\b(?:\/[^\s"'<>|*?:\]\[(){}]*)?/g;
const COMMON_NAMES = new Set(["public", "shared", "default", "user", "users", "runner", "root", "ubuntu", "admin", "home", "all users", "guest", "lean", "node", "app"]);

/** User names that appear in paths (C:\Users\<name>, /home/<name>, /Users/<name>). */
function namesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)|\/(?:home|Users)\/)([A-Za-z0-9._-]{3,40})/g)) {
    const n = m[1];
    if (!COMMON_NAMES.has(n.toLowerCase())) out.add(n);
  }
  for (const m of text.matchAll(/\b[A-Za-z]--(?:Users|home)-([A-Za-z0-9_]{3,40})-/g)) if (!COMMON_NAMES.has(m[1].toLowerCase())) out.add(m[1]);
  return [...out];
}

// `ls -l` output names the file owner and group (often the person's account name): "-rw-r--r-- 1 owner group 977 …".
// Also inside JSON strings, where the line breaks are written \n.
const LS_LINE = /((?:^|\n|\\n)[-dlcbps][-rwxsStT]{9}[.+@]?\s+\d+\s+)([^\s\\"]+)(\s+)([^\s\\"]+)(?=\s+\d)/g;

/**
 * Agent harnesses write their own setup into the session log, not only the conversation: system prompts, the list of
 * the user's tools, skills and MCP servers with their instructions, the working directory, the git state, the user's
 * e-mail. None of it is the agent's work, and much of it identifies the person. For JSON-lines logs (Claude Code,
 * Codex), those lines are dropped (each run replaced by one marker line) and <system-reminder> blocks inside messages
 * are cut; metadata fields such as cwd and gitBranch are removed.
 */
const DROP_TYPES = new Set(["attachment", "system", "summary", "file-history-snapshot", "api-request-blob", "session_meta", "turn_context", "queue-operation"]);
const DROP_ROLES = new Set(["system", "developer"]);
const DROP_KEYS = ["cwd", "gitBranch", "userType", "entrypoint", "git", "git_state", "env", "instructions", "user_instructions", "base_instructions"];
const SETUP_BLOCK = /<(system-reminder|environment_context|user_instructions|permissions instructions|app-context|skills_instructions|apps_instructions|collaboration_mode)>[\s\S]*?<\/\1>/g;

function stripHarness(text: string): { text: string; count: number } {
  const lines = text.split("\n");
  const jsonish = lines.filter((l) => l.trim().startsWith("{")).length;
  if (jsonish < Math.max(3, lines.filter((l) => l.trim()).length * 0.6)) return { text, count: 0 };
  let count = 0, dropped = 0;
  const out: string[] = [];
  const flush = () => { if (dropped) { out.push(JSON.stringify({ type: "redacted", removed: dropped, note: "[redacted:setup]" })); dropped = 0; } };
  const cutBlocks = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(SETUP_BLOCK, () => { count++; return "[redacted:setup]"; });
    if (Array.isArray(v)) return v.map(cutBlocks);
    if (v && typeof v === "object") { const o = v as Record<string, unknown>; for (const k of Object.keys(o)) o[k] = cutBlocks(o[k]); return o; }
    return v;
  };
  for (const line of lines) {
    if (!line.trim().startsWith("{")) { flush(); out.push(line); continue; }
    let o: Record<string, unknown>;
    try { o = JSON.parse(line); } catch { flush(); out.push(line); continue; }
    const p = (o.payload ?? o.message ?? {}) as Record<string, unknown>;
    if (DROP_TYPES.has(String(o.type)) || DROP_TYPES.has(String(p.type)) || DROP_ROLES.has(String(p.role ?? ""))) { dropped++; count++; continue; }
    flush();
    for (const k of DROP_KEYS) { if (k in o) { delete o[k]; count++; } if (p && typeof p === "object" && k in p) { delete p[k]; count++; } }
    out.push(JSON.stringify(cutBlocks(o)));
  }
  flush();
  return { text: out.join("\n"), count };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A file name with an extension is kept (it says which file was used); a folder name is not (it may name a person or a project).
const base = (last: string | undefined) => (last && /^[^.]+(?:\.[A-Za-z0-9_-]{1,12})+$/.test(last) ? `…/${last}` : "[path]");

export function redact(text: string): { text: string; count: number } {
  const h = stripHarness(text);
  text = h.text;
  let count = h.count;
  const names = namesIn(text);
  for (const m of text.matchAll(LS_LINE)) for (const n of [m[2], m[4]]) if (n.length >= 3 && !COMMON_NAMES.has(n.toLowerCase()) && !/^\d+$/.test(n)) names.push(n);
  const sub = (re: RegExp, rep: string | ((...m: string[]) => string)) => {
    text = text.replace(re, (...m: string[]) => { count++; return typeof rep === "function" ? rep(...m) : rep.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? ""); });
  };
  for (const [re, rep] of SECRETS) sub(re, rep);
  sub(LS_LINE, (_a, pre, _o, sp) => `${pre}[user]${sp}[user]`);
  sub(WIN_PATH, (_all, last) => base(last));
  sub(UNIX_PATH, (all) => base(all.split("/").filter(Boolean).pop()));
  for (const [re, rep] of PERSONAL) sub(re, rep);
  for (const n of names) sub(new RegExp(`(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`, "gi"), "[user]");
  return { text, count };
}

export type Turn = { role: "user" | "assistant" | "tool" | "system"; text: string };

/** Normalise Claude Code / Codex JSONL or plain markdown into a list of turns for display. */
export function parseTranscript(format: string, content: string): Turn[] {
  if (format === "markdown" || format === "text") return [{ role: "system", text: content }];
  const turns: Turn[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try { o = JSON.parse(line); } catch { continue; }
    const msg = (o.message ?? o.payload ?? o) as Record<string, unknown>;
    const role = String(msg.role ?? o.type ?? "system");
    const c = msg.content;
    let text = "";
    if (typeof c === "string") text = c;
    else if (Array.isArray(c))
      text = c.map((b: Record<string, unknown>) =>
        b.type === "text" || b.type === "output_text" || b.type === "input_text" ? String(b.text ?? "")
        : b.type === "tool_use" ? `⟶ ${b.name}(${JSON.stringify(b.input).slice(0, 600)})`
        : b.type === "tool_result" ? `⟵ ${typeof b.content === "string" ? b.content.slice(0, 1500) : JSON.stringify(b.content).slice(0, 1500)}`
        : "").filter(Boolean).join("\n");
    if (!text.trim()) continue;
    const r = role === "user" || role === "assistant" ? role : role.includes("tool") ? "tool" : "system";
    turns.push({ role: r as Turn["role"], text });
  }
  return turns;
}
