import "server-only";

/**
 * Transcripts are published, so we redact before storing. This is best-effort; the submitter
 * sees the redacted preview and is responsible for what they publish.
 */
const PATTERNS: [RegExp, string][] = [
  [/\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/g, "[redacted:api-key]"],
  [/\bns_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}\b/g, "[redacted:nosorry-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "[redacted:github-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted:aws-key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted:jwt]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted:private-key]"],
  [/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{6,}/gi, "$1=[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted:email]"],
  [/([A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s"']+/g, "$1~"],
];

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  for (const [re, rep] of PATTERNS) text = text.replace(re, (...m) => { count++; return rep.replace("$1", m[1] ?? ""); });
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
