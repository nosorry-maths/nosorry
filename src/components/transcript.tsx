import type { ReactNode } from "react";

// What the transcript cleaner (src/lib/transcript.ts) leaves in place of what it removed, and how it is shown: a
// visible badge, so a reader sees at a glance that something was there and has been hidden on purpose.
const MARK = /\[redacted(?::([a-z-]+))?\]|\[(path|user|ip)\]|…\/(?=[^\s"'<>]+)/g;

const LABEL: Record<string, string> = {
  path: "path", user: "user name", ip: "IP address", email: "e-mail", phone: "phone number", host: "host name",
  "api-key": "API key", "nosorry-key": "nosorry key", "github-token": "GitHub token", "slack-token": "Slack token",
  "aws-key": "AWS key", "google-key": "Google key", jwt: "token", "private-key": "private key", "ssh-key": "SSH key",
  secret: "secret", folder: "folder", setup: "agent setup",
};

/** Kind of each mark, for the legend and the badge. */
function kindOf(m: RegExpExecArray): string {
  if (m[0].startsWith("…/")) return "folder";
  return m[2] ?? m[1] ?? "secret";
}

/** Text with every removed item shown as a lock badge (the file name after a hidden folder stays readable). */
export function Redacted({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(MARK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const kind = kindOf(m as RegExpExecArray);
    out.push(
      <span key={i++} className={`redact${kind === "folder" ? " folder" : ""}`} title={`Removed automatically before publication: ${LABEL[kind] ?? kind}`}>
        {kind === "folder" ? "…" : LABEL[kind] ?? kind}
      </span>,
    );
    if (kind === "folder") out.push("/");
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** How many items of each kind were hidden, for the legend above the transcript. */
export function redactionCounts(text: string): [string, number][] {
  const n = new Map<string, number>();
  for (const m of text.matchAll(MARK)) { const k = kindOf(m as RegExpExecArray); n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k === "folder" ? "folder path" : LABEL[k] ?? k, v]);
}
