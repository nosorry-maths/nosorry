import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { recentSubmissions, fmtDate } from "@/lib/data";
import { siteOrigin } from "@/lib/origin";
import { SubmissionTable } from "@/components/ui";
import { ApiKeyForm, ConfirmSubmit } from "@/components/forms";
import { revokeApiKey, logout } from "@/app/actions";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");
  const { welcome } = await searchParams;
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
              <li><b><Link href="/list/math?status=open&sort=easy">Review a statement</Link></b> — a misformalization found is worth 60 points.</li>
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

      <h2>Your submissions</h2>
      <SubmissionTable rows={subs} />
      <form action={logout} style={{ marginTop: 24 }}><button className="btn">Sign out</button></form>
    </>
  );
}
