"use server";
import { redirect, unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { one, q, tx } from "@/lib/db";
import { emit } from "@/lib/feed";
import { hashPassword, verifyPassword, DUMMY_HASH, sha256, token } from "@/lib/crypto";
import { createSession, destroySession, currentUser, clientIp, audit, isModerator, canSubmit, type User } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { config } from "@/lib/config";
import { createSubmission, type SubmissionInput } from "@/lib/submissions";
import { POINTS } from "../../shared/scoring.mjs";
import { rescoreProblem } from "../../shared/ledger.mjs";
import { preflight } from "../../shared/preflight.mjs";
import { saveThread } from "@/lib/research";
import { newApiKey } from "@/lib/apikeys";
import { verifyTotp, newTotpSecret, totpStep } from "@/lib/totp";
import { handleProblem } from "@/lib/handles";
import { currentSessionId } from "@/lib/auth";

const str = (f: FormData, k: string, max = 100_000) => String(f.get(k) ?? "").slice(0, max).trim();
const safeNext = (n: string) => (/^\/(?![/\\])/.test(n) ? n : "/");

// ─────────── accounts ───────────
export async function signup(_: unknown, f: FormData) {
  const ip = await clientIp();
  // Per-IP limit when we know the IP (trusted proxy), plus a global ceiling that always applies.
  if (ip && !(await rateLimit(`signup:${ip}`, config.limits.signupsPerIpPerHour, 3600))) return { error: "Too many sign-ups from this address. Try again later." };
  if (!(await rateLimit("signup:global", Number(process.env.SIGNUPS_PER_HOUR ?? 200), 3600))) return { error: "Registrations are temporarily paused. Try again in an hour." };
  const handle = str(f, "handle", 40), password = String(f.get("password") ?? ""), email = str(f, "email", 200) || null;
  const bad = handleProblem(handle);
  if (bad) return { error: bad };
  if (f.get("terms") !== "on") return { error: "Please accept the Terms of use and the Privacy policy." };
  if (password.length < 10 || password.length > 200) return { error: "Password: at least 10 characters." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Invalid email address." };
  if (f.get("website")) return { error: "Rejected." }; // honeypot
  const exists = await one("SELECT 1 FROM users WHERE handle=$1 OR (email IS NOT NULL AND email=$2)", [handle, email]);
  if (exists) return { error: "That handle or email is already taken." };
  const u = await one<{ id: number }>("INSERT INTO users(handle, password_hash, email, accepted_terms_at) VALUES ($1,$2,$3, now()) RETURNING id", [handle, hashPassword(password), email]);
  await audit(u!.id, "signup", `user:${u!.id}`);
  // Email verification hook: when REQUIRE_EMAIL_VERIFICATION is on, create an email_tokens row and send a link here.
  await createSession(u!.id);
  // One-shot onboarding: an API key is created right away and handed to /start exactly once through a short-lived,
  // HttpOnly cookie scoped to /start (consumed and deleted by consumeSetupKey). It never appears in a URL.
  const key = await newApiKey(u!.id, "setup");
  (await cookies()).set(SETUP_COOKIE, key, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/start", maxAge: 600,
  });
  const next = safeNext(str(f, "next", 300));
  redirect(next === "/" || next === "/start" ? "/start?welcome=1#setup" : next);
}

export async function login(_: unknown, f: FormData) {
  const ip = await clientIp();
  if (ip && !(await rateLimit(`login:${ip}`, config.limits.loginsPerIpPer15m, 900))) return { error: "Too many attempts from this address. Wait 15 minutes." };
  // Step 2 of a two-step sign-in: the challenge from step 1 and the authenticator code.
  const challenge = str(f, "challenge", 100);
  if (challenge) {
    const ch = await one<{ user_id: number; next: string | null; tries: number; totp_secret: string | null }>(
      `UPDATE login_challenges c SET tries = tries + 1 FROM users u WHERE c.id=$1 AND c.expires_at > now() AND u.id=c.user_id AND u.banned_at IS NULL
       RETURNING c.user_id, c.next, c.tries, u.totp_secret`, [sha256(challenge)]);
    if (!ch || ch.tries > 5 || !ch.totp_secret) {
      await q("DELETE FROM login_challenges WHERE id=$1", [sha256(challenge)]);
      return { error: "This sign-in expired. Start again with your password." };
    }
    if (!(await verifyTotp(ch.user_id, ch.totp_secret, str(f, "code", 12)))) {
      await audit(ch.user_id, "login.2fa_failed", `user:${ch.user_id}`);
      return { need2fa: true, challenge, error: "Wrong or already used code." };
    }
    await q("DELETE FROM login_challenges WHERE id=$1 OR expires_at < now()", [sha256(challenge)]);
    await createSession(ch.user_id);
    await audit(ch.user_id, "login", `user:${ch.user_id}`, { two_step: true });
    redirect(safeNext(ch.next ?? "/"));
  }
  const handle = str(f, "handle", 200), password = String(f.get("password") ?? "");
  const u = await one<{ id: number; password_hash: string; banned_at: string | null; totp_secret: string | null; totp_enabled_at: string | null }>(
    "SELECT id, password_hash, banned_at, totp_secret, totp_enabled_at FROM users WHERE (handle=$1 OR email=$1) AND deleted_at IS NULL", [handle]);
  // Failures only are counted per account (a third party cannot lock out someone who types the right password).
  const failKey = `login-fail:${handle.toLowerCase()}`;
  const blocked = !(await rateLimit(failKey, 10, 900, 0));
  const ok = verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) {
    await rateLimit(failKey, 10, 900, 1);
    return { error: blocked ? "Too many failed attempts on this account. Wait 15 minutes." : "Wrong handle or password." };
  }
  if (blocked) return { error: "Too many failed attempts on this account. Wait 15 minutes." };
  if (u.banned_at) return { error: "This account is suspended." };
  if (u.totp_enabled_at && u.totp_secret) {
    const t = token(32);
    await q("INSERT INTO login_challenges(id, user_id, next, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')", [sha256(t), u.id, safeNext(str(f, "next", 300))]);
    return { need2fa: true, challenge: t };
  }
  await createSession(u.id);
  await audit(u.id, "login", `user:${u.id}`);
  redirect(safeNext(str(f, "next", 300)));
}

export async function logout() {
  await destroySession();
  redirect("/");
}

async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
async function requireMod(): Promise<User> {
  const u = await requireUser();
  if (!isModerator(u)) throw new Error("forbidden");
  return u;
}

// ─────────── account security (account page) ───────────
type Msg = { ok?: string; error?: string; secret?: string; uri?: string };

/** Change the password: the current one is required; every other session of the account is signed out. */
export async function changePassword(_: unknown, f: FormData): Promise<Msg> {
  const u = await requireUser();
  if (!(await rateLimit(`pwchange:${u.id}`, 5, 900))) return { error: "Too many attempts. Wait 15 minutes." };
  const cur = String(f.get("current") ?? ""), next = String(f.get("password") ?? "");
  const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [u.id]);
  if (!row || !verifyPassword(cur, row.password_hash)) return { error: "The current password is wrong." };
  if (next.length < 10 || next.length > 200) return { error: "New password: at least 10 characters." };
  if (next === cur) return { error: "The new password is the same as the current one." };
  await q("UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1", [u.id, hashPassword(next)]);
  await q("DELETE FROM sessions WHERE user_id=$1 AND id <> $2", [u.id, (await currentSessionId()) ?? ""]);
  await audit(u.id, "password.change", `user:${u.id}`);
  return { ok: "Password changed. Your other sessions were signed out." };
}

/** Sign out one session (by its hashed id) or every other session of the account. */
export async function revokeSession(f: FormData) {
  const u = await requireUser();
  const id = str(f, "session", 100), mine = (await currentSessionId()) ?? "";
  if (id === "others") await q("DELETE FROM sessions WHERE user_id=$1 AND id <> $2", [u.id, mine]);
  else if (id && id !== mine) await q("DELETE FROM sessions WHERE user_id=$1 AND id=$2", [u.id, id]);
  await audit(u.id, "session.revoke", `user:${u.id}`, { which: id === "others" ? "others" : "one" });
  revalidatePath("/account");
}

/** Step 1 of two-step verification: a new secret, stored but not active until a code from it is confirmed. */
export async function startTotp(): Promise<Msg> {
  const u = await requireUser();
  const row = await one<{ totp_enabled_at: string | null }>("SELECT totp_enabled_at FROM users WHERE id=$1", [u.id]);
  if (row?.totp_enabled_at) return { error: "Two-step verification is already on." };
  const secret = newTotpSecret();
  await q("UPDATE users SET totp_secret=$2 WHERE id=$1", [u.id, secret]);
  const { otpauthUri } = await import("@/lib/totp");
  return { secret, uri: otpauthUri(u.handle, secret) };
}

/** Step 2: the first code from the authenticator turns it on. */
export async function confirmTotp(_: unknown, f: FormData): Promise<Msg> {
  const u = await requireUser();
  if (!(await rateLimit(`totp:${u.id}`, 10, 900))) return { error: "Too many attempts. Wait 15 minutes." };
  const row = await one<{ totp_secret: string | null; totp_enabled_at: string | null }>("SELECT totp_secret, totp_enabled_at FROM users WHERE id=$1", [u.id]);
  if (!row?.totp_secret || row.totp_enabled_at) return { error: "Start the setup again." };
  if (!(await verifyTotp(u.id, row.totp_secret, str(f, "code", 12)))) return { error: "That code does not match. Check the time on your phone and try the next code." };
  await q("UPDATE users SET totp_enabled_at=now() WHERE id=$1", [u.id]);
  await q("DELETE FROM sessions WHERE user_id=$1 AND id <> $2", [u.id, (await currentSessionId()) ?? ""]);
  await audit(u.id, "2fa.enable", `user:${u.id}`);
  revalidatePath("/account");
  return { ok: "Two-step verification is on. Other sessions were signed out." };
}

/** Turning it off needs the password and a current code. */
export async function disableTotp(_: unknown, f: FormData): Promise<Msg> {
  const u = await requireUser();
  if (!(await rateLimit(`totp:${u.id}`, 10, 900))) return { error: "Too many attempts. Wait 15 minutes." };
  const row = await one<{ password_hash: string; totp_secret: string | null }>("SELECT password_hash, totp_secret FROM users WHERE id=$1", [u.id]);
  if (!row || !verifyPassword(String(f.get("current") ?? ""), row.password_hash)) return { error: "The password is wrong." };
  if (!row.totp_secret || totpStep(row.totp_secret, str(f, "code", 12)) == null || !(await verifyTotp(u.id, row.totp_secret, str(f, "code", 12))))
    return { error: "The code is wrong." };
  await q("UPDATE users SET totp_secret=NULL, totp_enabled_at=NULL WHERE id=$1", [u.id]);
  await audit(u.id, "2fa.disable", `user:${u.id}`);
  revalidatePath("/account");
  return { ok: "Two-step verification is off." };
}

/**
 * Delete the account (Privacy §6): personal data goes (email, password, sessions, keys, profile, 2FA); public
 * contributions stay, published under the licence, attributed to "deleted-<id>". Points leave the leaderboards.
 */
export async function deleteAccount(_: unknown, f: FormData): Promise<Msg> {
  const u = await requireUser();
  if (!(await rateLimit(`delete:${u.id}`, 5, 900))) return { error: "Too many attempts. Wait 15 minutes." };
  const row = await one<{ password_hash: string; role: string }>("SELECT password_hash, role FROM users WHERE id=$1", [u.id]);
  if (!row || !verifyPassword(String(f.get("current") ?? ""), row.password_hash)) return { error: "The password is wrong." };
  if (str(f, "confirm", 40) !== u.handle) return { error: "Type your handle to confirm." };
  if (row.role !== "user") return { error: "A moderator or admin account must first be demoted by an admin." };
  await tx(async (c) => {
    await c.query(`UPDATE users SET handle=$2, display_name=NULL, email=NULL, email_verified_at=NULL, password_hash='!', bio=NULL,
      affiliation=NULL, totp_secret=NULL, totp_enabled_at=NULL, deleted_at=now(), banned_at=now(), suspended_reason='deleted by its owner'
      WHERE id=$1`, [u.id, `deleted-${u.id}`]);
    await c.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
    await c.query("UPDATE api_keys SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [u.id]);
    await c.query("UPDATE desk_leases SET state='released', reason='other', note='account deleted', ended_at=now() WHERE user_id=$1 AND state='active'", [u.id]);
  });
  await audit(u.id, "account.delete", `user:${u.id}`);
  await destroySession();
  redirect("/?deleted=1");
}

// ─────────── moderation of accounts (moderators: rename, suspend; never other moderators or admins) ───────────
async function modTarget(mod: User, handle: string) {
  const t = await one<{ id: number; handle: string; role: string; banned_at: string | null; deleted_at: string | null }>(
    "SELECT id, handle, role, banned_at, deleted_at FROM users WHERE handle=$1", [handle]);
  if (!t) throw new Error("no such user");
  if (t.id === mod.id) throw new Error("not on your own account");
  if (t.role !== "user" && mod.role !== "admin") throw new Error("only an admin can act on a moderator or admin account");
  if (t.deleted_at) throw new Error("this account was deleted");
  return t;
}

async function renameUserImpl(f: FormData) {
  const mod = await requireMod();
  const t = await modTarget(mod, str(f, "handle", 40));
  const reason = str(f, "reason", 500);
  if (!reason) throw new Error("a reason is required (it is recorded in the audit log)");
  let next = str(f, "new_handle", 40);
  if (!next) next = `renamed-${t.id}`;
  const bad = handleProblem(next);
  if (bad && !/^renamed-\d+$/.test(next)) throw new Error(bad);
  if (await one("SELECT 1 FROM users WHERE handle=$1", [next])) throw new Error("that handle is taken");
  await q("UPDATE users SET handle=$2, display_name=NULL, handle_changed_at=now() WHERE id=$1", [t.id, next]);
  await audit(mod.id, "user.rename", `user:${t.id}`, { from: t.handle, to: next, reason });
  revalidatePath("/mod/users");
}

async function suspendUserImpl(f: FormData) {
  const mod = await requireMod();
  const t = await modTarget(mod, str(f, "handle", 40));
  const reason = str(f, "reason", 500);
  if (!reason) throw new Error("a reason is required (it is recorded in the audit log)");
  if (str(f, "action", 10) === "lift") {
    await q("UPDATE users SET banned_at=NULL, suspended_reason=NULL WHERE id=$1", [t.id]);
    await audit(mod.id, "user.unsuspend", `user:${t.id}`, { handle: t.handle, reason });
    revalidatePath("/mod/users");
    return;
  }
  await tx(async (c) => {
    await c.query("UPDATE users SET banned_at=now(), suspended_reason=$2 WHERE id=$1", [t.id, reason]);
    await c.query("DELETE FROM sessions WHERE user_id=$1", [t.id]);
    await c.query("UPDATE desk_leases SET state='released', reason='other', note='account suspended', ended_at=now() WHERE user_id=$1 AND state='active'", [t.id]);
  });
  await audit(mod.id, "user.suspend", `user:${t.id}`, { handle: t.handle, reason });
  revalidatePath("/mod/users");
}


const SETUP_COOKIE = "ns_setup";


/** Returns the key in the action state (shown once, never in a URL, never stored in clear). */
export async function createApiKey(_: unknown, f: FormData): Promise<{ key?: string; name?: string; error?: string }> {
  const u = await requireUser();
  if (!(await rateLimit(`apikey:${u.id}`, 20, 3600))) return { error: "Too many keys created this hour." };
  const name = str(f, "name", 60) || "agent";
  const key = await newApiKey(u.id, name);
  revalidatePath("/account");
  return { key, name };
}

/** "Generate my setup command" on /start: a fresh key dedicated to one machine/agent. */
export async function createSetupKey(): Promise<{ key?: string; error?: string }> {
  const u = await requireUser();
  if (!(await rateLimit(`apikey:${u.id}`, 20, 3600))) return { error: "Too many keys created this hour." };
  const key = await newApiKey(u.id, `setup ${new Date().toISOString().slice(0, 10)}`);
  revalidatePath("/account");
  return { key };
}

/** Hands over the key created at sign-up, once: reads and deletes the setup cookie. */
export async function consumeSetupKey(): Promise<{ key?: string }> {
  const u = await currentUser();
  const jar = await cookies();
  const key = jar.get(SETUP_COOKIE)?.value;
  jar.delete({ name: SETUP_COOKIE, path: "/start" });
  if (!u || !key || !/^ns_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(key)) return {};
  // Only hand it back if it is a live key of the signed-in user.
  const ok = await one("SELECT 1 FROM api_keys WHERE prefix=$1 AND key_hash=$2 AND user_id=$3 AND revoked_at IS NULL", [key.split("_")[1], sha256(key), u.id]);
  return ok ? { key } : {};
}

export async function revokeApiKey(f: FormData) {
  const u = await requireUser();
  await q("UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [Number(f.get("id")), u.id]);
  await audit(u.id, "api_key.revoke", `key:${f.get("id")}`);
  revalidatePath("/account");
}

// ─────────── submissions ───────────
export async function submitWeb(_: unknown, f: FormData) {
  const u = await requireUser();
  const file = f.get("file");
  let lean = str(f, "lean_source", config.limits.leanSourceBytes);
  if (!lean && file instanceof File && file.size) lean = (await file.text()).slice(0, config.limits.leanSourceBytes);
  const tfile = f.get("transcript_file");
  let transcript = str(f, "transcript", config.limits.transcriptBytes);
  if (!transcript && tfile instanceof File && tfile.size) transcript = (await tfile.text()).slice(0, config.limits.transcriptBytes);
  const input: SubmissionInput = {
    problem: str(f, "problem", 200) || undefined,
    kind: str(f, "kind", 20) as SubmissionInput["kind"],
    lean_source: lean || undefined,
    title: str(f, "title", 300) || undefined,
    body_md: str(f, "body_md") || undefined,
    explanation_md: str(f, "explanation_md") || undefined,
    derived_from: str(f, "derived_from", 2000) || undefined,
    repo_url: str(f, "repo_url", 500) || undefined,
    target_decl: str(f, "target_decl", 200) || undefined,
    based_on: str(f, "based_on", 40) || undefined,
    cites: str(f, "cites", 300).split(/[\s,;#]+/).filter((x) => /^\d+$/.test(x)).slice(0, 20).map((id) => ({ type: "note", id: Number(id) })),
    agent: { name: str(f, "agent_name", 60) || "human", model: str(f, "agent_model", 80) || undefined },
    transcript: transcript ? { format: (str(f, "transcript_format", 30) || "text") as "text", content: transcript } : undefined,
  };
  const r = await createSubmission(u, input, await clientIp());
  if (!r.ok) return { error: r.error + (r.details ? ": " + (r.details as { message: string }[]).map((d) => d.message).join("; ") : "") };
  redirect(r.url);
}

export async function setVisibility(f: FormData) {
  const u = await requireUser();
  // Proofs are public by default; the author decides whether the agent transcript is public too.
  const id = str(f, "id", 40), vis = str(f, "visibility", 10), tr = str(f, "transcript", 10);
  const s = await one<{ user_id: number; status: string }>("SELECT user_id, status FROM submissions WHERE public_id=$1", [id]);
  if (!s || Number(s.user_id) !== Number(u.id)) throw new Error("forbidden");
  if (tr) {
    await q("UPDATE submissions SET transcript_public=$2 WHERE public_id=$1", [id, tr === "public"]);
    await audit(u.id, "submission.transcript", id, { public: tr === "public" });
  } else {
    if (vis === "public" && !["verified", "partial", "accepted", "needs_review"].includes(s.status)) throw new Error("only checked submissions can be made public");
    await q("UPDATE submissions SET visibility=$2 WHERE public_id=$1", [id, vis === "public" ? "public" : "private"]);
    await audit(u.id, "submission.visibility", id, { vis });
  }
  revalidatePath(`/s/${id}`);
}

const CRITIQUE_KINDS = ["misformalization", "too_weak", "too_strong", "ambiguity", "already_solved", "duplicate", "other"];

export async function createCritique(f: FormData) {
  const u = await requireUser();
  const slug = str(f, "problem", 200);
  if (canSubmit(u)) redirect(`/p/${slug}?critique=blocked#review`);
  if (!(await rateLimit(`crit:${u.id}`, 20, 3600))) redirect(`/p/${slug}?critique=limit#review`);
  const p = await one<{ id: number; current_version_id: number }>("SELECT id, current_version_id FROM problems WHERE slug=$1", [slug]);
  if (!p) throw new Error("unknown problem");
  const kind = str(f, "kind", 30);
  const body = str(f, "body", 50_000);
  if (!CRITIQUE_KINDS.includes(kind) || !body) redirect(`/p/${slug}?critique=invalid#review`);
  const c = await one<{ id: number }>(
    `INSERT INTO critiques(problem_id, problem_version_id, user_id, kind, body_md, proposed_source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [p.id, p.current_version_id, u.id, kind, body, str(f, "proposed", 1_000_000) || null]);
  await audit(u.id, "critique.create", `critique:${c!.id}`, { problem: slug, kind });
  await emit(null, p.id, "critique", { userId: u.id, refType: "critique", refId: c!.id, unverified: true, summary: `${u.handle} says the statement may be wrong (${kind}): ${body.replace(/^\s*#+\s*/, "").replace(/\s+/g, " ")}` });
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}?critique=${c!.id}#critique-${c!.id}`);
}

// ─────────── moderation ───────────
// Every decision is a state transition checked in SQL (WHERE status = …), audited, and points go through the ledger.
async function refreshBoard() { await q("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard").catch(() => {}); }
const MAX_MANUAL_POINTS = 100;

/** Accept or reject a submission waiting for human review (answer() proofs, findings, formalizations). */
/**
 * Confirm a result that already counts after community review: it becomes "human-verified" (the last state a result can
 * reach). Members whose vote agreed (+1) get their referee points. To refuse it, a moderator revokes it instead.
 */
async function confirmReviewImpl(f: FormData) {
  const mod = await requireMod();
  const id = str(f, "id", 40), note = str(f, "note", 5000) || null;
  await tx(async (c) => {
    const { rows: [s] } = await c.query(
      "SELECT * FROM submissions WHERE public_id=$1 AND status='verified' AND review_required AND reviewed_at IS NULL FOR UPDATE", [id]);
    if (!s) throw new Error("this result is not open to review (already confirmed, or revoked?)");
    if (s.user_id === mod.id) throw new Error("you cannot confirm your own submission");
    await c.query("UPDATE submissions SET reviewed_at=now(), reviewed_by=$2, review_note=COALESCE($3, review_note) WHERE id=$1", [s.id, mod.id, note]);
    if (s.problem_id) await emit(c, s.problem_id, "review.decision", { userId: mod.id, refType: "submission", refId: s.id,
      summary: `${s.public_id} human-verified by ${mod.handle} after community review${note ? `: ${note}` : ""}` });
    const { rows: voters } = await c.query(
      "SELECT user_id FROM submission_votes WHERE submission_id=$1 AND value=1 AND user_id NOT IN ($2,$3)", [s.id, s.user_id, mod.id]);
    for (const v of voters) await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, note, created_by) VALUES ($1,$2,$3,'referee:vote',$4,$5)",
      [v.user_id, s.id, POINTS.referee.vote, `vote matched the decision on ${s.public_id}`, mod.id]);
  });
  await audit(mod.id, "submission.confirm", id);
  await refreshBoard();
  revalidatePath(`/s/${id}`);
}

async function reviewSubmissionImpl(f: FormData) {
  const mod = await requireMod();
  const id = str(f, "id", 40), decision = str(f, "decision", 10), note = str(f, "note", 5000) || null;
  if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject");
  const points = Math.max(0, Math.min(MAX_MANUAL_POINTS, Math.trunc(Number(f.get("points") ?? 0)) || 0));
  await tx(async (c) => {
    const { rows: [s] } = await c.query("SELECT * FROM submissions WHERE public_id=$1 AND status='needs_review' FOR UPDATE", [id]);
    if (!s) throw new Error("this submission is not waiting for review (already decided?)");
    if (s.user_id === mod.id) throw new Error("you cannot review your own submission");
    if (s.kind === "partial" && points > 0 && !note) throw new Error("a public note is required when awarding points to a partial proof");
    const status = decision === "accept" ? (s.kind === "proof" || s.kind === "disproof" ? "verified" : s.kind === "partial" ? "partial" : "accepted") : "rejected";
    await c.query(`UPDATE submissions SET status=$2, review_note=$3, reviewed_by=$4,
                   reviewed_at = CASE WHEN review_required THEN now() ELSE reviewed_at END,
                   verified_at = CASE WHEN $2 = 'verified' THEN COALESCE(verified_at, now()) ELSE verified_at END WHERE id=$1`, [s.id, status, note, mod.id]);
    if (s.review_required && s.problem_id) {
      await emit(c, s.problem_id, "review.decision", { userId: mod.id, refType: "submission", refId: s.id,
        summary: decision === "accept" ? `${s.public_id} approved after community review: it now counts (${s.kind})` : `${s.public_id} rejected after review${note ? `: ${note}` : ""}` });
      if (decision === "accept") await emit(c, s.problem_id, "verified", { userId: s.user_id, refType: "submission", refId: s.id, summary: `Verified ${s.kind}, reviewed and approved` });
      // Referees: a vote that matched the decision, and (on approval) the suggested change this revision came from.
      const want = decision === "accept" ? 1 : -1;
      const { rows: voters } = await c.query(
        "SELECT user_id FROM submission_votes WHERE submission_id=$1 AND value=$2 AND user_id NOT IN ($3,$4)", [s.id, want, s.user_id, mod.id]);
      for (const v of voters) await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, note, created_by) VALUES ($1,$2,$3,'referee:vote',$4,$5)",
        [v.user_id, s.id, POINTS.referee.vote, `vote matched the decision on ${s.public_id}`, mod.id]);
      if (decision === "accept") {
        const { rows: sugg } = await c.query(
          "SELECT id, user_id FROM submission_suggestions WHERE revision_id=$1 AND status='applied' AND user_id NOT IN ($2,$3)", [s.id, s.user_id, mod.id]);
        for (const g of sugg) await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, note, created_by) VALUES ($1,$2,$3,'referee:suggestion',$4,$5)",
          [g.user_id, s.id, POINTS.referee.suggestion, `suggested change #${g.id} became the approved ${s.public_id}`, mod.id]);
      }
    }
    if (decision === "accept") {
      if (s.kind === "finding" || s.kind === "formalization" || (s.kind === "partial" && points > 0)) {
        const delta = points || (s.kind === "finding" ? POINTS.finding.accepted : POINTS.formalization.accepted);
        await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
          [s.user_id, s.id, delta, `review:${s.kind}`, note, mod.id]);
      }
      if (s.kind === "formalization") {
        // Either formalizes an existing informal problem (e.g. a Physlib lemma), or creates a new problem.
        // In both cases the statement is a *draft*: no proof earns points until the statement is reviewed.
        const decl = s.verdict?.decl_name ?? "unknown";
        const statementLean = (() => {
          const short = String(decl).split(".").pop()!;
          const i = s.lean_source.search(new RegExp(`\\b(theorem|lemma)\\s+(\\S+\\.)?${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
          return i >= 0 ? s.lean_source.slice(i).split(/:=/)[0].trim() : s.lean_source.slice(0, 4000);
        })();
        let pid: number = s.problem_id;
        let workspace = "formal-conjectures";
        if (pid) {
          const { rows: [ex] } = await c.query("SELECT id, collection, formalization FROM problems WHERE id=$1 FOR UPDATE", [pid]);
          if (!ex || ex.formalization !== "informal") throw new Error("this problem already has a formal statement");
          if (ex.collection === "physlib") workspace = "physlib";
        } else {
          const slug = `user-${String(decl).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${s.id}`;
          const { rows: [p] } = await c.query(
            `INSERT INTO problems(ident, slug, collection, title, statement_md, status, primary_subject, subjects, statement_status)
             VALUES ('tmp-'||md5(random()::text), $1, 'other', $2, $3, 'open', 'math.GM', '{math.GM}', 'draft') RETURNING id`,
            [slug, s.title ?? decl, s.body_md]);
          await c.query("UPDATE problems SET ident = 'NS.' || lpad(id::text, 5, '0') WHERE id=$1", [p.id]);
          pid = p.id;
        }
        const { rows: [v] } = await c.query(
          `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, workspace, change_reason, created_by)
           VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [pid, decl, s.lean_source, statementLean, sha256(s.lean_source), config.toolchain, workspace, `formalized by submission ${s.public_id}`, s.user_id]);
        await c.query(`UPDATE problems SET current_version_id=$2, formalization='formal', statement_status='draft', updated_at=now(),
                       search_text=ns_fold(title || ' ' || slug || ' ' || ident || ' ' || $3 || ' ' || coalesce(statement_md,'')) WHERE id=$1`, [pid, v.id, decl]);
        await c.query("UPDATE submissions SET problem_id=$2, problem_version_id=$3 WHERE id=$1", [s.id, pid, v.id]);
      }
    }
    if (s.problem_id && (s.kind === "proof" || s.kind === "disproof")) await rescoreProblem(c, s.problem_id, mod.id);
    await c.query("INSERT INTO audit_log(actor_id, action, target, data, ip) VALUES ($1,'review',$2,$3,$4)", [mod.id, id, JSON.stringify({ decision, points, note }), await clientIp()]);
  });
  await refreshBoard();
  revalidatePath(`/s/${id}`);
  revalidatePath("/mod");
}

/** Revoke a submission after the fact (cheating, wrong proof discovered, misattribution). Points are reversed in the ledger. */
async function revokeSubmissionImpl(f: FormData) {
  const mod = await requireMod();
  const id = str(f, "id", 40), reason = str(f, "reason", 40), note = str(f, "note", 5000);
  if (!["wrong", "cheating", "plagiarism", "other"].includes(reason)) throw new Error("bad reason");
  if (!note) throw new Error("a public note is required");
  await tx(async (c) => {
    const { rows: [s] } = await c.query(
      "SELECT id, user_id, problem_id, kind FROM submissions WHERE public_id=$1 AND status IN ('verified','partial','accepted','needs_review') FOR UPDATE", [id]);
    if (!s) throw new Error("only a checked, non-revoked submission can be revoked");
    if (s.user_id === mod.id) throw new Error("you cannot moderate your own submission");
    await c.query("UPDATE submissions SET status='revoked', review_note=$2, reviewed_by=$3 WHERE id=$1", [s.id, note, mod.id]);
    // A revoked record stops being the record (its points are reversed below like any other award).
    const { rows: revoked } = await c.query("UPDATE records SET revoked_at=now() WHERE submission_id=$1 AND revoked_at IS NULL RETURNING id", [s.id]);
    if (revoked.length) await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary)
      VALUES ($1,'record',$2,'record',$3,$4)`, [s.problem_id, mod.id, revoked[0].id, `Record #${revoked[0].id} revoked: ${note}`]);
    // Non-proof awards (findings, partial rewards) are reversed directly; proof awards are recomputed for the whole problem.
    const { rows } = await c.query(
      `SELECT e.* FROM point_events e WHERE e.submission_id=$1 AND e.delta > 0 AND e.reason NOT LIKE 'proof:%'
       AND NOT EXISTS (SELECT 1 FROM point_events r WHERE r.reverses_id=e.id)`, [s.id]);
    for (const e of rows) await c.query(
      "INSERT INTO point_events(user_id, submission_id, delta, reason, note, reverses_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [e.user_id, s.id, -e.delta, `revoke:${reason}`, note, e.id, mod.id]);
    if (s.problem_id) await rescoreProblem(c, s.problem_id, mod.id);
    // A lemma whose only proof is revoked is open again (and stops being reusable).
    if (s.problem_id) await c.query(`UPDATE problems p SET lemma_state = CASE WHEN EXISTS (SELECT 1 FROM submissions x WHERE x.problem_id=p.id
        AND x.kind='proof' AND x.status='verified') THEN 'proved' ELSE 'open' END WHERE p.id=$1 AND p.status='lemma' AND p.lemma_state='proved'`, [s.problem_id]);
    if (reason === "cheating") await c.query(
      `INSERT INTO point_events(user_id, submission_id, delta, reason, note, created_by)
       SELECT $1,$2,-50,'penalty:cheating',$3,$4 WHERE NOT EXISTS (SELECT 1 FROM point_events WHERE submission_id=$2 AND reason='penalty:cheating')`,
      [s.user_id, s.id, note, mod.id]);
    await c.query("INSERT INTO audit_log(actor_id, action, target, data, ip) VALUES ($1,'revoke',$2,$3,$4)", [mod.id, id, JSON.stringify({ reason, note }), await clientIp()]);
  });
  await refreshBoard();
  revalidatePath(`/s/${id}`);
}

/** Resolve a statement critique. Accepting with a corrected source creates a new version and re-verifies every proof. */
async function resolveCritiqueImpl(f: FormData) {
  const mod = await requireMod();
  const id = Number(f.get("id")), decision = str(f, "decision", 10), resolution = str(f, "resolution", 20_000);
  if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject");
  const newSource = str(f, "new_source", 1_000_000);
  const newStatus = str(f, "statement_status", 20);
  if (newStatus && !["draft", "reviewed", "disputed", "frozen"].includes(newStatus)) throw new Error("bad statement status");
  if (!resolution) throw new Error("a public resolution note is required");
  await tx(async (c) => {
    const { rows: [cr] } = await c.query("SELECT * FROM critiques WHERE id=$1 AND status='open' FOR UPDATE", [id]);
    if (!cr) throw new Error("this critique is not open (already decided?)");
    if (cr.user_id === mod.id) throw new Error("you cannot resolve your own critique");
    await c.query("UPDATE critiques SET status=$2, resolution_md=$3, resolved_by=$4, resolved_at=now() WHERE id=$1",
      [id, decision === "accept" ? "accepted" : "rejected", resolution, mod.id]);
    await emit(c, cr.problem_id, "critique.resolve", { userId: mod.id, refType: "critique", refId: id,
      summary: `Critique #${id} ${decision === "accept" ? "accepted" : "rejected"} by ${mod.handle}: ${resolution.replace(/\s+/g, " ")}` });
    if (decision === "accept") {
      const pts = POINTS.critique[cr.kind as keyof typeof POINTS.critique] ?? 10;
      await c.query("INSERT INTO point_events(user_id, critique_id, delta, reason, created_by) VALUES ($1,$2,$3,$4,$5)",
        [cr.user_id, id, pts, `critique:${cr.kind}`, mod.id]);
      if (newSource) {
        const { rows: [cur] } = await c.query(
          "SELECT v.* FROM problems p JOIN problem_versions v ON v.id=p.current_version_id WHERE p.id=$1", [cr.problem_id]);
        // The corrected statement must still declare the same target with `sorry` and pass the statement rules.
        const pf = preflight(newSource, { kind: "formalization" });
        if (!pf.ok) throw new Error("corrected statement rejected: " + (pf.errors as { message: string }[]).map((e) => e.message).join("; "));
        const short = String(cur.decl_name).split(".").pop()!;
        if (!new RegExp(`\\b(theorem|lemma)\\s+(\\S+\\.)?${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(newSource))
          throw new Error(`corrected statement must still declare ${cur.decl_name}`);
        const stmt = newSource.slice(newSource.search(new RegExp(`\\b(theorem|lemma)\\s+(\\S+\\.)?${short}\\b`))).split(/:=/)[0].trim();
        const { rows: [v] } = await c.query(
          `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, change_reason, critique_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [cr.problem_id, cur.version + 1, cur.decl_name, newSource, stmt, sha256(newSource), cur.toolchain, `critique #${id} (${cr.kind})`, id, mod.id]);
        // Points stay frozen ("disputed") until every proof has been re-checked against the new version.
        await c.query("UPDATE problems SET current_version_id=$2, statement_status='disputed', recheck_pending=true, updated_at=now() WHERE id=$1", [cr.problem_id, v.id]);
        const { rows } = await c.query(
          `UPDATE submissions SET problem_version_id=$2, status='queued'
           WHERE problem_id=$1 AND kind IN ('proof','disproof','partial') AND status IN ('verified','needs_review','partial') RETURNING id`, [cr.problem_id, v.id]);
        for (const s of rows) await c.query("INSERT INTO jobs(kind, submission_id, priority) VALUES ('reverify',$1,40)", [s.id]);
        await c.query("INSERT INTO audit_log(actor_id, action, target, data) VALUES ($1,'statement.version',$2,$3)",
          [mod.id, `problem:${cr.problem_id}`, JSON.stringify({ version: cur.version + 1, rechecks: rows.length })]);
      }
    }
    if (newStatus) await c.query("UPDATE problems SET statement_status=$2, recheck_pending=false WHERE id=$1", [cr.problem_id, newStatus]);
    await rescoreProblem(c, cr.problem_id, mod.id);
    await c.query("INSERT INTO audit_log(actor_id, action, target, data, ip) VALUES ($1,'critique.resolve',$2,$3,$4)",
      [mod.id, `critique:${id}`, JSON.stringify({ decision, newStatus, newVersion: !!newSource }), await clientIp()]);
  });
  await refreshBoard();
  revalidatePath("/mod");
}

async function setStatementStatusImpl(f: FormData) {
  const mod = await requireMod();
  const slug = str(f, "slug", 200), st = str(f, "statement_status", 20), note = str(f, "review_note", 5000);
  if (!["draft", "reviewed", "disputed", "frozen"].includes(st)) throw new Error("bad status");
  await tx(async (c) => {
    const { rows: [cur] } = await c.query(
      "SELECT p.id, p.field, p.formalization, v.created_by FROM problems p LEFT JOIN problem_versions v ON v.id=p.current_version_id WHERE p.slug=$1 FOR UPDATE OF p", [slug]);
    if (!cur) throw new Error("unknown problem");
    if (cur.formalization === "informal" && st !== "draft") throw new Error("an informal problem has no formal statement to review yet");
    if (st === "reviewed" && cur.created_by === mod.id) throw new Error("you cannot review a statement you formalized yourself");
    // Physics statements encode a model (units, idealisations, boundary conditions): the review must say what was checked.
    if (st === "reviewed" && cur.field === "physics" && note.length < 40)
      throw new Error("physics statements need a review note (≥ 40 characters): units, idealisations, model assumptions checked");
    const { rows: [p] } = await c.query("UPDATE problems SET statement_status=$2, updated_at=now() WHERE id=$1 RETURNING id", [cur.id, st]);
    await c.query("UPDATE problem_versions SET reviewed_by=$2, reviewed_at=now(), review_note=COALESCE(NULLIF($3,''), review_note) WHERE id=(SELECT current_version_id FROM problems WHERE id=$1)", [p.id, mod.id, note]);
    await rescoreProblem(c, p.id, mod.id);
  });
  await audit(mod.id, "statement_status", slug, { st });
  await refreshBoard();
  revalidatePath(`/p/${slug}`);
}

// ─────────── community research threads ───────────
export async function saveResearchThread(f: FormData) {
  const u = await requireUser();
  const slug = str(f, "problem", 200);
  const r = await saveThread(u, slug, {
    repo_url: str(f, "repo_url", 500), summary_md: str(f, "summary_md", 20_000), approach: str(f, "approach", 200),
    status: str(f, "status", 20), open_to_collaborators: f.get("open_to_collaborators") === "on",
  });
  if (!r.ok) redirect(`/p/${slug}?research=${encodeURIComponent(r.error)}#research`);
  await audit(u.id, r.created ? "research.create" : "research.update", `thread:${r.id}`, { problem: slug });
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}?research=saved#thread-${r.id}`);
}

async function hideResearchThreadImpl(f: FormData) {
  const mod = await requireMod();
  const id = Number(f.get("id")), slug = str(f, "problem", 200), note = str(f, "note", 500);
  if (!note) throw new Error("a reason is required");
  const t = await one<{ user_id: number }>("UPDATE research_threads SET status='hidden', hidden_by=$2 WHERE id=$1 AND user_id <> $2 RETURNING user_id", [id, mod.id]);
  if (!t) throw new Error("not found, or your own thread");
  await audit(mod.id, "research.hide", `thread:${id}`, { note });
  revalidatePath(`/p/${slug}`);
}

/** Moderation decisions that the rules refuse (your own item, missing note…) come back as a message on the page the
 *  form was on, instead of an error page. Next.js control flow (redirect/notFound) passes through untouched. */
async function guarded(f: FormData, fn: (f: FormData) => Promise<unknown>, back: (f: FormData) => string) {
  try {
    await fn(f);
  } catch (e) {
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : "This action could not be completed.";
    const to = back(f);
    redirect(`${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg.charAt(0).toUpperCase() + msg.slice(1) + ".")}`);
  }
}
export async function confirmReview(f: FormData) { await guarded(f, confirmReviewImpl, f => `/s/${str(f, "id", 40)}`); }
export async function reviewSubmission(f: FormData) { await guarded(f, reviewSubmissionImpl, f => `/s/${str(f, "id", 40)}`); }
export async function revokeSubmission(f: FormData) { await guarded(f, revokeSubmissionImpl, f => `/s/${str(f, "id", 40)}`); }
export async function resolveCritique(f: FormData) { await guarded(f, resolveCritiqueImpl, () => "/mod"); }
export async function setStatementStatus(f: FormData) { await guarded(f, setStatementStatusImpl, f => `/p/${str(f, "slug", 200)}?tab=statement`); }
export async function renameUser(f: FormData) { await guarded(f, renameUserImpl, () => "/mod/users"); }
export async function suspendUser(f: FormData) { await guarded(f, suspendUserImpl, () => "/mod/users"); }
export async function hideResearchThread(f: FormData) { await guarded(f, hideResearchThreadImpl, f => `/p/${str(f, "problem", 200)}`); }
