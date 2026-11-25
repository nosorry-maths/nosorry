"use client";
import { useActionState, useState, useTransition } from "react";
import { changePassword, confirmTotp, deleteAccount, disableTotp, startTotp } from "@/app/actions";

type Msg = { ok?: string; error?: string; secret?: string; uri?: string } | null;
const Note = ({ m }: { m: Msg }) => (m?.error ? <div className="alert" role="alert">{m.error}</div> : m?.ok ? <div className="note">{m.ok}</div> : null);

export function PasswordForm() {
  const [m, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="box"><h4>Password</h4><div className="in">
      <Note m={m} />
      <div className="field-row"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" type="password" name="current" required autoComplete="current-password" /></div>
      <div className="field-row"><label htmlFor="pw-new">New password</label><input id="pw-new" type="password" name="password" required minLength={10} autoComplete="new-password" />
        <div className="hint">At least 10 characters. Your other sessions are signed out.</div></div>
      <button className="btn" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
    </div></form>
  );
}

export function TotpPanel({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<Msg>(null);
  const [pendingStart, start] = useTransition();
  const [confirmMsg, confirm, pendingConfirm] = useActionState(confirmTotp, null);
  const [offMsg, off, pendingOff] = useActionState(disableTotp, null);
  if (enabled && !confirmMsg?.ok) {
    return (
      <form action={off} className="box"><h4>Two-step verification: on</h4><div className="in">
        <Note m={offMsg} />
        {!offMsg?.ok && <>
          <p className="small" style={{ marginTop: 0 }}>Signing in needs your password and a code from your authenticator app. To turn it off, give both.</p>
          <div className="field-row"><label htmlFor="off-pw">Password</label><input id="off-pw" type="password" name="current" required autoComplete="current-password" /></div>
          <div className="field-row"><label htmlFor="off-code">Code</label><input id="off-code" name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" className="mono" /></div>
          <button className="btn" disabled={pendingOff}>Turn off</button>
        </>}
      </div></form>
    );
  }
  return (
    <div className="box"><h4>Two-step verification: {confirmMsg?.ok ? "on" : "off"}</h4><div className="in">
      <Note m={confirmMsg} />
      {!confirmMsg?.ok && !setup?.secret && <>
        <p className="small" style={{ marginTop: 0 }}>Recommended, and expected of moderators: signing in then also needs a 6-digit code from an authenticator app
          (Aegis, 2FAS, Google Authenticator, 1Password, Bitwarden…).</p>
        {setup?.error && <div className="alert">{setup.error}</div>}
        <button className="btn primary" disabled={pendingStart} onClick={() => start(async () => setSetup(await startTotp()))}>Set up two-step verification</button>
      </>}
      {!confirmMsg?.ok && setup?.secret && (
        <form action={confirm}>
          <p className="small" style={{ marginTop: 0 }}>In your authenticator app, add an account with this key (or open the link on your phone), then type the code it shows.</p>
          <p className="mono" style={{ wordBreak: "break-all" }}><b>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</b></p>
          <p className="small"><a href={setup.uri}>Open in an authenticator app</a></p>
          <div className="field-row"><label htmlFor="totp-code">Code</label><input id="totp-code" name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" className="mono" /></div>
          <button className="btn primary" disabled={pendingConfirm}>Turn on</button>
        </form>
      )}
    </div></div>
  );
}

export function DeleteAccountForm({ handle }: { handle: string }) {
  const [m, action, pending] = useActionState(deleteAccount, null);
  const [open, setOpen] = useState(false);
  return (
    <div className="box"><h4>Delete your account</h4><div className="in">
      <p className="small" style={{ marginTop: 0 }}>Your email, password, sessions, API keys and profile are erased. Public contributions (proofs, critiques, comments)
        stay published under their licence, attributed to <code>deleted-…</code>, and your points leave the leaderboards. This cannot be undone.</p>
      {!open ? <button className="btn" onClick={() => setOpen(true)}>Delete my account…</button> : (
        <form action={action}>
          <Note m={m} />
          <div className="field-row"><label htmlFor="del-pw">Password</label><input id="del-pw" type="password" name="current" required autoComplete="current-password" /></div>
          <div className="field-row"><label htmlFor="del-h">Type your handle (<b>{handle}</b>) to confirm</label><input id="del-h" name="confirm" required autoComplete="off" /></div>
          <button className="btn" style={{ borderColor: "#a00", color: "#a00" }} disabled={pending}>Delete my account for good</button>
        </form>
      )}
    </div></div>
  );
}
