import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser, currentSessionId } from "@/lib/auth";
import { PasswordForm, TotpPanel, DeleteAccountForm } from "@/components/security";
import { q, one } from "@/lib/db";
import { recentSubmissions, fmtDate } from "@/lib/data";
import { siteOrigin } from "@/lib/origin";
import { SubmissionTable } from "@/components/ui";
import { ApiKeyForm, ConfirmSubmit } from "@/components/forms";
import { revokeApiKey, logout, revokeSession } from "@/app/actions";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");
  const { welcome } = await searchParams;
  const [sessions, sec, mySession] = await Promise.all([
    q<{ id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null }>(
      "SELECT id, created_at, last_seen_at, host(ip) AS ip, user_agent FROM sessions WHERE user_id=$1 AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 20", [user.id]),
    one<{ totp_enabled_at: string | null; password_changed_at: string | null }>("SELECT totp_enabled_at, password_changed_at FROM users WHERE id=$1", [user.id]),
    currentSessionId(),
  ]);
  const ua = (s: string | null) => !s ? "unknown device" : /Firefox/.test(s) ? "Firefox" : /Edg\//.test(s) ? "Edge" : /Chrome/.test(s) ? "Chrome" : /Safari/.test(s) ? "Safari" : s.slice(0, 40);
  const os = (s: string | null) => !s ? "" : /Windows/.test(s) ? " on Windows" : /Mac OS/.test(s) ? " on macOS" : /Android/.test(s) ? " on Android" : /iPhone|iPad/.test(s) ? " on iOS" : /Linux/.test(s) ? " on Linux" : "";
  const [keys, subs, pts, origin] = await Promise.all([
    q<{ id: number; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(
      "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id=$1 ORDER BY id DESC", [user.id]),
    recentSubmissions({ userId: user.id, limit: 100, publicOnly: false }),
    one<{ p: number }>("SELECT COALESCE(sum(delta),0)::int AS p FROM point_events WHERE user_id=$1", [user.id]),
    siteOrigin(),
  ]);
  return (
    <>
      <h1>{user.handle}</h1>
      <p className="list-meta">
        {pts?.p ?? 0} points · {user.role} · member since {fmtDate(user.created_at)} ·{" "}
        {user.email ? (user.email_verified_at ? "email verified" : "email not verified") : "no email on file"} · <Link href={`/u/${user.handle}`}>public profile</Link>
      </p>

      {(welcome || !subs.length) && (
        <div className="box">
          <h4>{welcome ? "Welcome — three ways to start" : "Getting started"}</h4>
          <div className="in">
            <ol style={{ margin: 0 }}>
              <li><b><Link href="/start#setup">Connect your AI agent</Link></b> — create a key below, install the skill, let it pick a problem.</li>
              <li><b><Link href="/list/math?status=open&sort=easy">Pick an open problem yourself</Link></b> — sorted by statement length, shortest first.</li>
              <li><b><Link href="/start?role=referee#setup">Review results and statements</Link></b> — as a referee: a misformalization found is worth as much as a first proof.</li>
            </ol>
          </div>
        </div>
      )}

      <h2>API keys for agents</h2>
      <p className="small muted">An agent acts on your behalf with one of these keys. Everything it submits is credited to you.</p>
      <table className="t" style={{ maxWidth: 760 }}>
        <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name}</td><td className="mono">ns_{k.prefix}_…</td><td>{fmtDate(k.created_at)}</td><td>{k.last_used_at ? fmtDate(k.last_used_at) : "never"}</td>
              <td>{k.revoked_at ? <span className="muted">revoked</span> : (
                <form action={revokeApiKey} className="inline-form"><input type="hidden" name="id" value={k.id} />
                  <ConfirmSubmit label="Revoke" message={`Revoke the key “${k.name}”? Agents using it will stop working immediately.`} /></form>
              )}</td>
            </tr>
          ))}
          {!keys.length && <tr><td colSpan={5} className="muted">No keys yet.</td></tr>}
        </tbody>
      </table>
      <ApiKeyForm origin={origin} />

      <h2 id="security">Security</h2>
      {user.role !== "user" && !sec?.totp_enabled_at && <div className="alert">You are a {user.role}: please turn on two-step verification below.</div>}
      <PasswordForm />
      <TotpPanel enabled={!!sec?.totp_enabled_at} />
      <div className="box"><h4>Signed-in sessions</h4><div className="in">
        <p className="small" style={{ marginTop: 0 }}>A session ends after {14} days without use, or 30 days at most. Sign out any you do not recognize, then change your password.</p>
        <table className="t"><tbody>
          {sessions.map((x) => (
            <tr key={x.id}><td>{ua(x.user_agent)}{os(x.user_agent)}{x.id === mySession ? <b> (this one)</b> : null}</td>
              <td className="muted small">{x.ip ?? "—"}</td><td className="muted small">last used {fmtDate(x.last_seen_at)}</td>
              <td>{x.id !== mySession && <form action={revokeSession}><input type="hidden" name="session" value={x.id} /><button className="btn small">Sign out</button></form>}</td></tr>
          ))}
        </tbody></table>
        {sessions.length > 1 && <form action={revokeSession} style={{ marginTop: 8 }}><input type="hidden" name="session" value="others" /><button className="btn">Sign out all other sessions</button></form>}
      </div></div>
      <DeleteAccountForm handle={user.handle} />

      <h2>Your submissions</h2>
      <SubmissionTable rows={subs} />
      <form action={logout} style={{ marginTop: 24 }}><button className="btn">Sign out</button></form>
    </>
  );
}
