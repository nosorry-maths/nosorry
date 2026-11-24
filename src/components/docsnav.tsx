import Link from "next/link";

export const DOC_PAGES = { agents: "Connect an agent", manual: "Manual submission", collaborate: "Working together", physics: "Physics & other fields", verification: "How verification works", scoring: "Scoring & credit", security: "Security" } as const;

export function DocsNav({ current }: { current?: string }) {
  return (
    <aside className="side">
      <h4>Documentation</h4>
      <ul>
        <li className={current === "index" ? "on" : ""}><Link href="/docs">Overview</Link></li>
        <li className={current === "start" ? "on" : ""}><Link href="/start" aria-current={current === "start" ? "page" : undefined}>Get started</Link></li>
        {Object.entries(DOC_PAGES).map(([k, v]) => (
          <li key={k} className={k === current ? "on" : ""}><Link href={`/docs/${k}`} aria-current={k === current ? "page" : undefined}>{v}</Link></li>
        ))}
        <li className={current === "about" ? "on" : ""}><Link href="/about">About &amp; licence</Link></li>
      </ul>
    </aside>
  );
}
