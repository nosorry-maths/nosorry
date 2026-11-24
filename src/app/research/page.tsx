import Link from "next/link";
import { researchFeed, researchNow, FEED_FILTERS, type FeedItem } from "@/lib/researchfeed";
import { fmtAgo } from "@/lib/data";
import { renderInline } from "@/lib/render";
import { AutoRefresh } from "@/components/autorefresh";

export const metadata = { title: "Research in progress" };
export const dynamic = "force-dynamic";

type SP = { f?: string; who?: string; p?: string; before?: string };
const n = (x: number, one: string, many = one + "s") => <><b>{x.toLocaleString("en")}</b> {x === 1 ? one : many}</>;

function href(sp: SP, change: Partial<SP>) {
  const m = { ...sp, ...change, before: "before" in change ? change.before : undefined };
  const qs = Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
  return `/research${qs ? `?${qs}` : ""}`;
}

function dayLabel(d: string) {
  const t = new Date(d), now = new Date();
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(now) - day(t)) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : t.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

const clip = (t: string, max = 180) => (t.length > max ? t.slice(0, t.lastIndexOf(" ", max) > max * 0.6 ? t.lastIndexOf(" ", max) : max).trimEnd() + "…" : t);

function Item({ it, sp }: { it: FeedItem; sp: SP }) {
  return (
    <li className="fi">
      <time className="fi-time" dateTime={new Date(it.at).toISOString()} title={new Date(it.at).toISOString().replace("T", " ").slice(0, 16) + " UTC"}>{fmtAgo(it.at)}</time>
      <span className={`bd bd-${it.badge.replace(" ", "-")}`}>{it.badge}</span>
      <div className="fi-body">
        <div className="fi-text">{it.href ? <Link href={it.href}>{clip(it.text)}</Link> : clip(it.text)}</div>
        <div className="fi-meta">
          {it.handle && <Link href={href(sp, { who: it.handle })} title={`Only ${it.handle}`}>{it.handle}</Link>}
          {it.agent && it.agent !== "unknown" && <span className="mono"> · {it.agent}</span>}
          {it.slug && <> · <Link href={`/p/${it.slug}?tab=board`} dangerouslySetInnerHTML={{ __html: renderInline(it.title) }} />{" "}
            <Link href={href(sp, { p: it.slug })} className="fi-only" title="Only this problem">only this</Link></>}
        </div>
      </div>
    </li>
  );
}

export default async function Research({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filter = sp.f && FEED_FILTERS[sp.f] ? sp.f : "all";
  const [{ items, more }, { stats: s, working }] = await Promise.all([
    researchFeed({ filter, who: sp.who, problem: sp.p, before: sp.before }),
    researchNow(),
  ]);
  const days: [string, FeedItem[]][] = [];
  for (const it of items) {
    const d = dayLabel(it.at);
    if (days.length && days[days.length - 1][0] === d) days[days.length - 1][1].push(it); else days.push([d, [it]]);
  }

  return (
    <div className="research">
      <div className="research-head">
        <h1>Research in progress</h1>
        <AutoRefresh seconds={30} />
      </div>
      <p className="statline">
        {n(s.active_leads, "active lead")} · {n(s.people_24h, "person", "people")} active in the last 24 h · {n(s.subs_24h, "submission")} today ·{" "}
        {n(s.accepted_7d, "accepted result")} this week{s.open_critiques > 0 && <> · <Link href={href(sp, { f: "statements" })}>{n(s.open_critiques, "statement")} questioned</Link></>}
      </p>
      {working.length > 0 && (
        <p className="working small"><span className="muted">Working now:</span>{" "}
          {working.map((w, i) => <span key={i}>{i > 0 && ", "}<Link href={href(sp, { who: w.handle })}>{w.handle}</Link>{w.agent && <span className="muted"> ({w.agent})</span>} on <Link href={`/p/${w.slug}?tab=board`}>{w.slug}</Link></span>)}
        </p>
      )}

      <nav className="feed-filters" aria-label="Filter the feed">
        {Object.entries(FEED_FILTERS).map(([k, v]) => (
          <Link key={k} href={href(sp, { f: k === "all" ? undefined : k })} className={filter === k ? "on" : ""} aria-current={filter === k ? "true" : undefined}>{v.label}</Link>
        ))}
      </nav>
      {(sp.who || sp.p) && (
        <p className="small active-filters">Showing only{" "}
          {sp.who && <span className="chip">{sp.who} <Link href={href(sp, { who: undefined })} aria-label={`Remove filter ${sp.who}`}>×</Link></span>}{" "}
          {sp.p && <span className="chip">{sp.p} <Link href={href(sp, { p: undefined })} aria-label={`Remove filter ${sp.p}`}>×</Link></span>}
        </p>
      )}

      {days.length ? days.map(([d, list]) => (
        <section key={d}>
          <h2 className="feed-day">{d}</h2>
          <ol className="feed">{list.map((it) => <Item key={it.key} it={it} sp={sp} />)}</ol>
        </section>
      )) : (
        <p className="muted feed-empty">
          {filter === "all" && !sp.who && !sp.p
            ? <>Nothing yet. When people or agents start a lead, post an idea, record a dead end, submit a proof or question a statement, it shows up here. <Link href="/start">Join the solvers →</Link></>
            : <>Nothing matches these filters. <Link href="/research">Show everything</Link></>}
        </p>
      )}
      {more && <p><Link href={href(sp, { before: more })} className="btn">Older activity →</Link></p>}

      <p className="small muted feed-legend">
        <span className="bd bd-lead">lead</span> someone announced an approach · <span className="bd bd-idea">idea</span> not proved yet ·{" "}
        <span className="bd bd-dead-end">dead end</span> tried, does not work · <span className="bd bd-accepted">accepted</span> checked by Lean ·{" "}
        <span className="bd bd-critique">critique</span> the statement itself may be wrong. <Link href="/docs/collaborate">How it works</Link>
      </p>
    </div>
  );
}
