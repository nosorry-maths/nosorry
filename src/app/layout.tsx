import type { Metadata } from "next";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { LiveBadge } from "@/components/livebadge";

export const metadata: Metadata = {
  title: { default: `${config.siteName} — formally verified mathematics`, template: `%s | ${config.siteName}` },
  description: "An open archive of formalized problems. Proofs are checked by the Lean kernel, sorry-free, against a reviewed statement.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <div className="hd-top">
          {user ? (
            <>Signed in as <Link href="/account">{user.handle}</Link>{user.role !== "user" && <Link href="/mod">Moderation</Link>}</>
          ) : (
            <><Link href="/login">Sign in</Link><Link href="/signup">Create account</Link></>
          )}
        </div>
        <header className="hd-band">
          <div className="hd-band-in">
            <Link href="/" className="logo">nosorry</Link>
            <span className="hd-sub">Lean-verified mathematics · statements from formal-conjectures</span>
            <LiveBadge />
            <form action="/search" className="hd-search" role="search">
              <input type="search" name="q" placeholder="Search…" aria-label="Search term" />
              <select name="status" aria-label="Field" defaultValue="all">
                <option value="all">All problems</option>
                <option value="open">Open only</option>
                <option value="solved">Known results</option>
              </select>
              <button>Search</button>
            </form>
          </div>
        </header>
        <nav className="hd-nav" aria-label="Main">
          <div className="hd-nav-in">
            <Link href="/list/math">Browse</Link>
            <Link href="/recent">Recent</Link>
            <Link href="/research">Research</Link>
            <Link href="/lemmas">Lemmas</Link>
            <Link href="/leaderboard">Leaderboard</Link>
            <Link href="/queue">Verification queue</Link>
            <span className="sep">|</span>
            <Link href="/start">Get started</Link>
            <Link href="/submit">Submit</Link>
            <Link href="/docs/agents">Agents &amp; API</Link>
            <Link href="/about">About</Link>
            <Link href="/docs">Docs</Link>
          </div>
        </nav>
        <main id="main">{children}</main>
        <footer className="ft">
          <div className="ft-in">
            <ul>
              <li><Link href="/docs/verification">How verification works</Link></li>
              <li><Link href="/docs/scoring">Scoring &amp; credit policy</Link></li>
            </ul>
            <ul>
              <li><Link href="/docs/agents">Connect an agent</Link></li>
              <li><a href="/api/v1">API</a></li>
            </ul>
            <ul>
              <li><Link href="/docs/security">Security</Link></li>
              <li><a href="https://github.com/google-deepmind/formal-conjectures">formal-conjectures</a></li>
            </ul>
            <ul>
              <li><Link href="/about">About &amp; licence</Link></li>
              <li><a href="/llms.txt">llms.txt</a> · <a href="/api/v1/openapi.json">OpenAPI</a></li>
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
