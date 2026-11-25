// Find the current agent session log (the "transcript") on this machine, for the harnesses that keep it as plain
// files, and turn it into something the server can read. Shared by the CLI and the MCP server; no dependencies.
// Supported automatically: Claude Code, Codex CLI, Gemini CLI, Antigravity CLI, GitHub Copilot CLI, Cursor (agent
// transcripts), Cline, Roo Code, Kiro, Amp, Continue, Aider. Anything else: pass the path of an exported file.
// The server cleans every transcript (paths, user names, e-mails, IPs, secrets, harness setup) and keeps it private
// until its author publishes it. Here we only pick the file, read it, and never touch sibling files (configs, keys).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const RECENT_MS = 6 * 3600_000;        // a log not written to in 6 hours is not this session
const MAX_BYTES = 7_500_000;           // the server accepts 8 MB

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
/** Files under dir (depth-limited) whose name matches re. */
function walk(dir, re, depth = 4, out = []) {
  if (depth < 0 || !exists(dir)) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, depth - 1, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}
const newest = (files) => files.map((p) => ({ p, t: mtime(p) })).sort((a, b) => b.t - a.t)[0]?.p ?? null;
/** VS Code-style user data directories (VS Code, Insiders, Cursor, Windsurf, VSCodium, Kiro). */
function vscodeUserDirs() {
  const apps = ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium", "Kiro"];
  const base = process.platform === "win32" ? process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming")
    : process.platform === "darwin" ? path.join(HOME, "Library", "Application Support") : process.env.XDG_CONFIG_HOME ?? path.join(HOME, ".config");
  return apps.map((a) => path.join(base, a, "User"));
}

// Each source: how to find candidate files, and the format tag sent to the server.
// "native" formats are JSON-lines logs the server reads as they are (it strips the harness setup itself);
// the others are normalised here into generic JSON lines {role, content}.
const SOURCES = [
  { harness: "Claude Code", format: "claude-code-jsonl", env: ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE"], find: () => {
      const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, ".claude"), "projects");
      const id = process.env.CLAUDE_CODE_SESSION_ID;
      if (id) { const exact = walk(root, new RegExp(`^${id.replace(/[^\w-]/g, "")}\\.jsonl$`), 1); if (exact.length) return exact; }
      return walk(path.join(root, process.cwd().replace(/[^A-Za-z0-9]/g, "-")), /\.jsonl$/, 0);
    } },
  { harness: "Codex CLI", format: "codex-jsonl", env: ["CODEX_THREAD_ID", "CODEX_SESSION_ID"], find: () => {
      const files = walk(path.join(process.env.CODEX_HOME ?? path.join(HOME, ".codex"), "sessions"), /\.jsonl$/, 4);
      const id = process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID;
      return id ? (files.filter((f) => f.includes(id)).length ? files.filter((f) => f.includes(id)) : files) : files;
    } },
  { harness: "Gemini CLI", format: "generic", env: ["GEMINI_SESSION_ID", "GEMINI_CLI"], find: () => {
      const files = walk(path.join(HOME, ".gemini", "tmp"), /^session-.*\.jsonl?$/, 3);
      const id = (process.env.GEMINI_SESSION_ID ?? "").slice(0, 8);
      return id && files.some((f) => f.includes(id)) ? files.filter((f) => f.includes(id)) : files;
    } },
  { harness: "Antigravity CLI", format: "generic", env: [], find: () =>
      walk(path.join(HOME, ".gemini", "antigravity-cli", "brain"), /^transcript(_full)?\.jsonl$/, 4) },
  { harness: "GitHub Copilot CLI", format: "generic", env: ["COPILOT_HOME"], find: () =>
      walk(path.join(process.env.COPILOT_HOME ?? path.join(HOME, ".copilot"), "session-state"), /^events\.jsonl$/, 1) },
  { harness: "Cursor", format: "generic", env: ["CURSOR_TRANSCRIPT_PATH", "CURSOR_AGENT"], find: () => {
      const p = process.env.CURSOR_TRANSCRIPT_PATH;
      if (p && exists(p)) return [p];
      return walk(path.join(HOME, ".cursor", "projects"), /\.jsonl$/, 3).filter((f) => f.includes("agent-transcripts"));
    } },
  { harness: "Cline / Roo Code", format: "generic", env: [], find: () => vscodeUserDirs().flatMap((u) =>
      ["saoudrizwan.claude-dev", "rooveterinaryinc.roo-cline"].flatMap((ext) => walk(path.join(u, "globalStorage", ext, "tasks"), /^api_conversation_history\.json$/, 1))) },
  { harness: "Kiro", format: "generic", env: ["KIRO_HOME"], find: () =>
      walk(path.join(process.env.KIRO_HOME ?? path.join(HOME, ".kiro"), "sessions"), /\.jsonl$/, 3) },
  { harness: "Amp", format: "generic", env: [], find: () => walk(path.join(HOME, ".local", "share", "amp", "threads"), /^T-.*\.json$/, 0) },
  { harness: "Continue", format: "generic", env: [], find: () => walk(path.join(HOME, ".continue", "sessions"), /^(?!sessions\.json$).*\.json$/, 0) },
  { harness: "Aider", format: "markdown", env: ["AIDER_CHAT_HISTORY_FILE"], find: () => {
      const p = process.env.AIDER_CHAT_HISTORY_FILE ?? path.join(process.cwd(), ".aider.chat.history.md");
      return exists(p) ? [p] : [];
    } },
];

/** Text of a message-like value: a string, or the text parts of an array / object. */
function textOf(v, depth = 0) {
  if (v == null || depth > 4) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).filter(Boolean).join("\n");
  if (typeof v === "object") {
    if (v.type === "thinking" || v.type === "redacted_thinking" || v.type === "reasoning") return "";
    for (const k of ["text", "content", "parts", "message", "value", "say", "ask"]) if (k in v) { const t = textOf(v[k], depth + 1); if (t) return t; }
  }
  return "";
}
const ROLE_KEYS = ["role", "speaker", "author", "type", "kind"];
/** Message-like objects of any JSON log: something with a role and some text. Setup roles are dropped. */
function messagesOf(value, out = [], depth = 0) {
  if (!value || depth > 6 || out.length > 20000) return out;
  if (Array.isArray(value)) { for (const v of value) messagesOf(v, out, depth + 1); return out; }
  if (typeof value !== "object") return out;
  const roleKey = ROLE_KEYS.find((k) => typeof value[k] === "string");
  const text = roleKey ? textOf(value.content ?? value.text ?? value.parts ?? value.message ?? value.say ?? value.ask) : "";
  if (roleKey && text) {
    const role = String(value[roleKey]).toLowerCase();
    if (!/^(system|developer|setup|config|metadata|session_meta)$/.test(role)) out.push({ role: /assist|model|agent|ai|bot|say/.test(role) ? "assistant" : /tool|function/.test(role) ? "tool" : "user", content: text });
    return out;
  }
  for (const k of ["messages", "history", "turns", "events", "items", "conversation", "data"]) if (k in value) messagesOf(value[k], out, depth + 1);
  return out;
}

/** Normalise a non-native log into JSON lines {role, content}. */
function normalise(raw) {
  const t = raw.trim();
  const items = [];
  if (t.startsWith("[") || (t.startsWith("{") && !t.includes("\n{"))) { try { messagesOf(JSON.parse(t), items); } catch { /* not one JSON value */ } }
  if (!items.length) for (const line of raw.split("\n")) { if (!line.trim()) continue; try { messagesOf(JSON.parse(line), items); } catch { /* skip */ } }
  return items.map((m) => JSON.stringify(m)).join("\n");
}

/** Which harness runs us, from its environment variables (null if none says so). */
export function detectHarness() {
  return SOURCES.find((s) => s.env.some((e) => process.env[e]))?.harness ?? null;
}

/**
 * The transcript to attach: opt "auto" (default), "none", or a file path. Returns {format, content, harness, path}
 * or undefined. "auto" prefers the harness our environment points to, else the most recently written log of any
 * supported harness, if written in the last 6 hours.
 */
export function transcriptFor(opt = "auto") {
  if (opt === "none") return undefined;
  if (opt && opt !== "auto") {
    if (!exists(opt)) return undefined;
    const raw = fs.readFileSync(opt, "utf8");
    if (/\.md$|\.txt$/i.test(opt)) return { format: "markdown", content: raw.slice(-MAX_BYTES), harness: "file", path: opt };
    const native = /"sessionId"|"parentUuid"/.test(raw.slice(0, 5000)) ? "claude-code-jsonl" : /"session_meta"|"response_item"/.test(raw.slice(0, 5000)) ? "codex-jsonl" : null;
    return { format: native ?? "generic-jsonl", content: (native ? raw : normalise(raw)).slice(-MAX_BYTES), harness: "file", path: opt };
  }
  const env = detectHarness();
  const ordered = env ? [...SOURCES.filter((s) => s.harness === env), ...SOURCES.filter((s) => s.harness !== env)] : SOURCES;
  const found = [];
  for (const s of ordered) {
    let p = null;
    try { p = newest(s.find()); } catch { p = null; }
    if (p && Date.now() - mtime(p) < RECENT_MS) { found.push({ s, p }); if (s.harness === env) break; }
  }
  const pick = found.find((f) => f.s.harness === env) ?? found.sort((a, b) => mtime(b.p) - mtime(a.p))[0];
  if (!pick) return undefined;
  let raw = fs.readFileSync(pick.p, "utf8");
  if (pick.s.harness === "Aider") { const i = raw.lastIndexOf("# aider chat started at"); if (i > 0) raw = raw.slice(i); }
  let content = pick.s.format === "generic" ? normalise(raw) : raw;
  if (content.length > MAX_BYTES) content = content.slice(-MAX_BYTES).replace(/^[^\n]*\n/, "");
  if (!content.trim()) return undefined;
  return { format: pick.s.format === "generic" ? "generic-jsonl" : pick.s.format, content, harness: pick.s.harness, path: pick.p };
}

export const SUPPORTED_HARNESSES = SOURCES.map((s) => s.harness);
