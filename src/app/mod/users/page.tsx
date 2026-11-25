import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser, isModerator } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { fmtDate } from "@/lib/data";
import { renameUser, suspendUser } from "@/app/actions";

export const metadata = { title: "Moderation — people & stats" };
export const dynamic = "force-dynamic";

type U = { id: number; handle: string; role: string; created_at: string; banned_at: string | null; suspended_reason: string | null;
  deleted_at: string | null; totp: boolean; subs: number; rejected: number; points: number; votes: number; critiques: number; same_ip: number; last_seen: string | null };

/**
 * Moderators: numbers that show how the site is doing, and the accounts to look at. Low-risk powers only: rename a
 * handle, suspend or lift a suspension, always with a reason (audit log). IP addresses are never shown: only whether
 * accounts share one (sign-ups and sessions of the last 90 days).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string; filter?: string }> }) {
  const me = await currentUser();
  if (!isModerator(me)) notFound();
  const sp = await searchParams;
  const term = (sp.q ?? "").trim().slice(0, 40);
  const filter = sp.filter ?? (term ? "all" : "watch");
  const [stats, daily, users, actions, totpOn] = await Promise.all([
    one<{ users: number; users_7d: number; active_24h: number; suspended: number; subs_24h: number; subs_7d: number; verified_7d: number;
      rejected_7d: number; queued: number; reviews: number; critiques: number; leases: number; keys: number }>(`
      SELECT (SELECT count(*) FROM users WHERE deleted_at IS NULL)::int AS users,
             (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::int AS users_7d,
             (SELECT count(DISTINCT user_id) FROM sessions WHERE last_seen_at > now() - interval '1 day')::int
               + (SELECT count(DISTINCT k.user_id) FROM api_keys k WHERE k.last_used_at > now() - interval '1 day'
                  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id=k.user_id AND s.last_seen_at > now() - interval '1 day'))::int AS active_24h,
             (SELECT count(*) FROM users WHERE banned_at IS NOT NULL AND deleted_at IS NULL)::int AS suspended,
             (SELECT count(*) FROM submissions WHERE created_at > now() - interval '1 day')::int AS subs_24h,
             (SELECT count(*) FROM submissions WHERE created_at > now() - interval '7 days')::int AS subs_7d,
             (SELECT count(*) FROM submissions WHERE status='verified' AND verified_at > now() - interval '7 days')::int AS verified_7d,
             (SELECT count(*) FROM submissions WHERE status='rejected' AND created_at > now() - interval '7 days')::int AS rejected_7d,
             (SELECT count(*) FROM jobs WHERE state IN ('queued','running'))::int AS queued,
             (SELECT count(*) FROM submissions WHERE status='needs_review')::int AS reviews,
             (SELECT count(*) FROM critiques WHERE status='open')::int AS critiques,
             (SELECT count(*) FROM desk_leases WHERE state='active')::int AS leases,
             (SELECT count(*) FROM api_keys WHERE revoked_at IS NULL)::int AS keys`),
    q<{ day: string; signups: number; subs: number; verified: number }>(`
      SELECT d::date AS day,
        (SELECT count(*) FROM users WHERE created_at::date = d::date)::int AS signups,
        (SELECT count(*) FROM submissions WHERE created_at::date = d::date)::int AS subs,
        (SELECT count(*) FROM submissions WHERE status='verified' AND verified_at::date = d::date)::int AS verified
      FROM generate_series(now() - interval '13 days', now(), interval '1 day') d ORDER BY d DESC`),
    q<U>(`
      WITH ips AS (
        SELECT user_id, ip FROM sessions WHERE ip IS NOT NULL AND created_at > now() - interval '90 days'
        UNION SELECT actor_id, ip FROM audit_log WHERE action='signup' AND ip IS NOT NULL AND created_at > now() - interval '90 days'),
      shared AS (SELECT a.user_id, count(DISTINCT b.user_id)::int AS n FROM ips a JOIN ips b ON a.ip = b.ip AND a.user_id <> b.user_id GROUP BY a.user_id)
      SELECT u.id, u.handle, u.role, u.created_at, u.banned_at, u.suspended_reason, u.deleted_at, (u.totp_enabled_at IS NOT NULL) AS totp,
        (SELECT count(*) FROM submissions s WHERE s.user_id=u.id)::int AS subs,
        (SELECT count(*) FROM submissions s WHERE s.user_id=u.id AND s.status='rejected')::int AS rejected,
        COALESCE((SELECT sum(delta) FROM point_events e WHERE e.user_id=u.id), 0)::int AS points,
        (SELECT count(*) FROM submission_votes v WHERE v.user_id=u.id)::int AS votes,
        (SELECT count(*) FROM critiques c WHERE c.user_id=u.id)::int AS critiques,
        COALESCE((SELECT n FROM shared WHERE shared.user_id=u.id), 0) AS same_ip,
        (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id=u.id) AS last_seen
      FROM users u
      WHERE ($1 = '' OR u.handle ILIKE '%' || $1 || '%')
        AND ($2 = 'all' OR ($2 = 'suspended' AND u.banned_at IS NOT NULL AND u.deleted_at IS NULL)
             OR ($2 = 'watch' AND u.deleted_at IS NULL AND (u.created_at > now() - interval '7 days'
                  OR EXISTS (SELECT 1 FROM shared WHERE shared.user_id=u.id))))
      ORDER BY u.created_at DESC LIMIT 100`, [term, filter]),
    q<{ action: string; target: string; handle: string | null; data: { reason?: string; from?: string; to?: string; handle?: string } | null; created_at: string }>(
      "SELECT a.action, a.target, u.handle, a.data, a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.action LIKE 'user.%' ORDER BY a.id DESC LIMIT 30"),
    one<{ on: boolean }>("SELECT totp_enabled_at IS NOT NULL AS on FROM users WHERE id=$1", [me!.id]),
  ]);
  const s = stats!;
  const filt = (k: string, label: string) => filter === k ? <b>{label}</b> : <Link href={`/mod/users?filter=${k}${term ? `&q=${encodeURIComponent(term)}` : ""}`}>{label}</Link>;
  return (
    <>
      <h1>Moderation — people &amp; stats</h1>
      <p className="small"><Link href="/mod">← Reviews, critiques, upstream, audit log</Link></p>
      {sp.msg && <div className="note small" role="status">{sp.msg}</div>}
      {!totpOn?.on && <div className="alert">Please turn on two-step verification on your <Link href="/account#security">account page</Link>: moderator accounts are the first target of attackers.</div>}

      <h2>Now</h2>
      <table className="meta small"><tbody>
        <tr><td className="k">People:</td><td><b>{s.users}</b> accounts · {s.users_7d} new this week · {s.active_24h} active in 24 h · {s.suspended} suspended · {s.keys} API keys</td></tr>
        <tr><td className="k">Work:</td><td>{s.subs_24h} submissions in 24 h, {s.subs_7d} this week ({s.verified_7d} verified, {s.rejected_7d} rejected) · {s.leases} desk leases held</td></tr>
        <tr><td className="k">Waiting:</td><td>{s.queued} in the verification queue · <Link href="/mod">{s.reviews} results in review · {s.critiques} open critiques</Link></td></tr>
      </tbody></table>
      <details className="small"><summary>Last 14 days</summary>
        <table className="t" style={{ maxWidth: 420 }}><thead><tr><th>Day</th><th className="num">Sign-ups</th><th className="num">Submissions</th><th className="num">Verified</th></tr></thead>
          <tbody>{daily.map((d) => <tr key={String(d.day)}><td>{fmtDate(d.day)}</td><td className="num">{d.signups}</td><td className="num">{d.subs}</td><td className="num">{d.verified}</td></tr>)}</tbody></table>
      </details>

      <h2>Accounts</h2>
      <form className="optbar" action="/mod/users"><input name="q" defaultValue={term} placeholder="handle" aria-label="Search a handle" />
        <input type="hidden" name="filter" value="all" /><button className="btn small">Search</button>
        <span className="grp"> Show: {filt("watch", "to watch (new, or sharing an address)")} · {filt("suspended", "suspended")} · {filt("all", "all")}</span></form>
      <table className="t small">
        <thead><tr><th>Handle</th><th>Since</th><th className="num">Subs (rejected)</th><th className="num">Points</th><th className="num">Votes</th><th className="num">Critiques</th>
          <th className="num" title="other accounts seen on the same IP address in the last 90 days (addresses are not shown)">Same address</th><th>State</th><th>Act</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><Link href={`/u/${u.handle}`}>{u.handle}</Link>{u.role !== "user" ? <span className="muted"> ({u.role})</span> : null}{u.totp ? <span className="muted" title="two-step verification on"> 🔒</span> : null}</td>
            <td className="muted">{fmtDate(u.created_at)}</td><td className="num">{u.subs} ({u.rejected})</td><td className="num">{u.points}</td>
            <td className="num">{u.votes}</td><td className="num">{u.critiques}</td><td className="num">{u.same_ip ? <b>{u.same_ip}</b> : 0}</td>
            <td>{u.deleted_at ? "deleted" : u.banned_at ? <span title={u.suspended_reason ?? ""}>suspended</span> : "active"}</td>
            <td>{!u.deleted_at && u.id !== me!.id && (u.role === "user" || me!.role === "admin") && (
              <details><summary>…</summary>
                <form action={renameUser} style={{ marginBottom: 6 }}>
                  <input type="hidden" name="handle" value={u.handle} />
                  <input name="new_handle" placeholder={`renamed-${u.id}`} aria-label="New handle" style={{ width: 130 }} />
                  <input name="reason" required placeholder="reason (logged)" aria-label="Reason" style={{ width: 170 }} />
                  <button className="btn small">Rename</button>
                </form>
                <form action={suspendUser}>
                  <input type="hidden" name="handle" value={u.handle} />
                  <input type="hidden" name="action" value={u.banned_at ? "lift" : "suspend"} />
                  <input name="reason" required placeholder="reason (logged)" aria-label="Reason" style={{ width: 170 }} />
                  <button className="btn small">{u.banned_at ? "Lift suspension" : "Suspend"}</button>
                </form>
              </details>
            )}</td>
          </tr>
        ))}
        {!users.length && <tr><td colSpan={9} className="muted">Nobody to show.</td></tr>}</tbody>
      </table>
      <p className="small muted">Renaming keeps the account and its history (use it for a handle that advertises, impersonates or offends). Suspending signs the account
        out everywhere, stops its API keys and releases its desk leases. Moderators cannot act on moderators or admins. Rules: <Link href="/docs/moderation">Moderation</Link>.</p>

      <h2>Account actions (audit log)</h2>
      <ul className="small">{actions.map((a, i) => (
        <li key={i}>{fmtDate(a.created_at)} · <b>{a.handle ?? "system"}</b> {a.action.replace("user.", "")} {a.data?.from ? `${a.data.from} → ${a.data.to}` : a.data?.handle ?? a.target}{a.data?.reason ? <span className="muted"> — {a.data.reason}</span> : null}</li>
      ))}{!actions.length && <li className="muted">None yet.</li>}</ul>
    </>
  );
}
