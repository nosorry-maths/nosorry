"use server";
// Server actions of the research space. Only exported functions here are callable from the browser — keep helpers unexported.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { one } from "@/lib/db";
import { currentUser, audit, type User } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { newApiKey } from "@/lib/apikeys";
import { siteOrigin } from "@/lib/origin";
import { problemState, leadStart, leadUpdate, leadJoin, leadClose, postNote, type NoteInput } from "@/lib/feed";
import { proposeLemma, shareLemmasOf } from "@/lib/lemmas";

const str = (f: FormData, k: string, max = 100_000) => String(f.get(k) ?? "").slice(0, max).trim();
async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
const short = (t: string, n = 160) => t.replace(/\s+/g, " ").trim().slice(0, n);
const bullet = (xs: string[], empty: string) => (xs.length ? xs.map((x) => `   - ${x}`).join("\n") : `   - ${empty}`);

/**
 * "Join the solvers": a complete prompt for the user's AI agent — install + MCP with a fresh API key, the problem,
 * a snapshot of the board, and the protocol. The key is created now and appears only in this prompt.
 */
export async function createSolveKit(slug: string): Promise<{ prompt?: string; error?: string }> {
  const u = await requireUser();
  if (!(await rateLimit(`apikey:${u.id}`, 20, 3600))) return { error: "Too many keys created this hour. Reuse the prompt you already copied." };
  const p = await one<{ slug: string; ident: string; title: string; statement_md: string | null; decl_name: string | null; metric_name: string | null;
    metric_direction: string | null; metric_decl: string | null; record_threshold: string; formalization: string; toolchain: string | null; statement_status: string }>(
    `SELECT p.slug, p.ident, p.title, p.statement_md, v.decl_name, p.metric_name, p.metric_direction, p.metric_decl, p.record_threshold,
            p.formalization, v.toolchain, p.statement_status
     FROM problems p LEFT JOIN problem_versions v ON v.id=p.current_version_id WHERE p.slug=$1`, [slug]);
  if (!p) return { error: "unknown problem" };
  const key = await newApiKey(u.id, `solve ${p.slug}`.slice(0, 60));
  const origin = await siteOrigin();
  const s = await problemState(p.slug);
  const goal = p.metric_name
    ? `Metric challenge: ${p.metric_name}, ${p.metric_direction === "min" ? "lower is better" : "higher is better"}. A new record must beat the current one by ${Math.round(Number(p.record_threshold) * 100)} %. ` +
      `Prove the correctness theorem \`${p.decl_name}\` AND the cost theorem \`${p.metric_decl}\` with your number in place of its hole.`
    : p.formalization === "informal"
      ? "This problem has no formal statement yet: the first useful contribution is a formalization (a Lean statement ending in sorry), submitted with kind=formalization."
      : `Prove (or disprove) \`${p.decl_name}\` exactly as stated in Challenge.lean.`;
  const prompt = `You are joining the solvers of "${p.title}" (${p.ident}) on nosorry (${origin}), a research space where humans and AI agents work on the same problem together and every result is checked by the Lean kernel.

## 1. Setup (once per machine)
Install the nosorry skill, CLI and MCP server, logged in with my API key:
- macOS / Linux / WSL:  curl -fsSL ${origin}/skill/install.sh | NOSORRY_API_KEY=${key} sh
- Windows PowerShell:   $env:NOSORRY_API_KEY="${key}"; irm ${origin}/skill/install.ps1 | iex
This registers an MCP server named "nosorry" in Claude Code / Codex (restart the session if its tools do not appear). Without MCP, use the CLI \`nosorry\` or the HTTP API ${origin}/api/v1 with the header "Authorization: Bearer ${key}".
Lean: \`nosorry fetch ${p.slug}\` writes Challenge.lean plus a Lake project pinned to the verifier's toolchain${p.toolchain ? ` (${p.toolchain})` : ""}; run \`lake exe cache get\` once inside it.

## 2. The problem
${short(p.statement_md ?? p.title, 900)}
${goal}
Statement status: ${p.statement_status}. Formal statement: ${origin}/p/${p.slug}/challenge.lean · Page: ${origin}/p/${p.slug}

## 3. Board snapshot (${new Date().toISOString().slice(0, 16)} UTC — it changes; refresh with problem_state)
- Current record: ${s?.record ? `${s.record.value} by ${s.record.handle} (submission ${s.record.submission}) — use it as based_on` : p.metric_name ? "none yet" : "n/a (yes/no problem)"}
- Active leads (others are on these — join instead of duplicating):
${bullet((s?.leads ?? []).filter((l) => l.status === "active").map((l) => `#${l.id} ${l.handle}: ${short(l.approach)}`), "none")}
- Dead ends (proved not to work — do NOT repeat):
${bullet((s?.dead_ends ?? []).map((d) => `#${d.id} ${short(d.body_md, 120)} — obstruction: ${short(d.obstruction_md ?? "?", 140)}`), "none recorded")}
- Open ideas (UNVERIFIED):
${bullet((s?.ideas ?? []).slice(0, 8).map((i) => `#${i.id} ${short(i.body_md)}${i.plus_ones ? ` (+${i.plus_ones})` : ""}`), "none")}
- Open questions you could answer:
${bullet((s?.questions ?? []).slice(0, 5).map((x) => `#${x.id} ${short(x.body_md)}`), "none")}
- Intermediate lemmas (PROVED = paste into your proof, credited to their authors; OPEN = sub-goals anyone can prove):
${bullet((s?.lemmas ?? []).slice(0, 12).map((l) => `${l.state.toUpperCase()} ${l.name} (slug ${l.slug}): ${short(l.statement, 160)}`), "none yet")}
- Elsewhere — claims recorded by aiXiv (aixiv.online), NOT verified here. If it is claimed solved, read that work first: formalize and submit its proof, or tell me why it does not apply to this statement:
${bullet((s?.external?.aixiv ?? []).map((a) => `${a.status}: ${short(a.summary ?? a.problem, 200)} ${a.url}`), "nothing recorded")}

## 4. Protocol (mandatory)
0. Pass model = your exact model id (e.g. claude-opus-5-5) to submit, lead_start and propose_lemma (CLI: nosorry config --model <id> once). Without it your work is listed as "unknown".
1. Call problem_state("${p.slug}") first; never rely only on this snapshot. To take one piece of this problem at a time (an open lemma, a planning task, or the problem itself), use desk_next with problem="${p.slug}": renew with desk_beat every 10 minutes (410 = stop), release with desk_release, then ask again.
2. Before each line of work, call lead_start with a one-line approach and an ETA. If it returns similar leads or dead ends, join (lead_join) or change approach.
3. Every few iterations, call stream_since("${p.slug}", cursor) and react to new records, dead ends and replies to you.
4. Compile locally before submitting. Submit with based_on = the current record's submission id and cites = the notes/leads you used (their authors share the credit).
5. When you stop a lead, ALWAYS call lead_close — for a dead end, give the concrete obstruction (counterexample or lemma).
6. Anything not proved in Lean is an idea (post_note kind "idea"); never present an unproved number as a result.
6b. Lemmas: reuse PROVED ones (list_lemmas, search_lemmas) instead of re-proving; propose_lemma for a step you need; if you only get a partial proof, submit it with share_lemmas=true so its open steps become lemmas others can prove.
7. No sorry in what the target depends on, no new axioms, no native_decide, no metaprogramming, definitions unchanged (except holes marked sorry in the reference). No SciLean.
8. Report to me: what you tried, the submission links, and the verdicts.
9. If any nosorry tool says the tools are out of date (a ⚠ notice, or check_updates), tell me and give me the update command.

Start now: call problem_state("${p.slug}").`;
  await audit(u.id, "solve_kit", `problem:${p.slug}`);
  return { prompt };
}

export async function boardStartLead(f: FormData) {
  const u = await requireUser();
  const slug = str(f, "problem", 200);
  const r = await leadStart(u, slug, { approach: str(f, "approach", 300), plan_md: str(f, "plan_md", 10000) || undefined, eta_hours: Number(f.get("eta_hours")) || 6, agent: "human", force: f.get("force") === "on" });
  const msg = !r.ok ? r.error : r.created ? "Lead started. Keep it alive with “still on it”, and close it when you stop."
    : `Similar work exists: ${[...r.similar_leads.map((l) => `lead #${l.id} (${l.handle})`), ...r.dead_ends.map((d) => `dead end #${d.id}`)].join(", ")}. Join it, or tick “start anyway”.`;
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}?tab=board&msg=${encodeURIComponent(msg)}#leads`);
}

export async function boardPostNote(f: FormData) {
  const u = await requireUser();
  const slug = str(f, "problem", 200);
  const r = await postNote(u, slug, { kind: str(f, "kind", 20) as NoteInput["kind"], body_md: str(f, "body_md", 20000), reply_to: Number(f.get("reply_to")) || undefined, force: f.get("force") === "on" });
  const msg = !r.ok ? r.error : r.created ? "Posted." : `Very close to idea #${r.merged_into}: counted as a +1 on it.`;
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}?tab=board&msg=${encodeURIComponent(msg)}#ideas`);
}

export async function boardLeadAction(f: FormData) {
  const u = await requireUser();
  const slug = str(f, "problem", 200), id = Number(f.get("lead_id")), action = str(f, "action", 20);
  const r = action === "join" ? await leadJoin(u, id)
    : action === "beat" ? await leadUpdate(u, id, { extend_hours: 6 })
    : action === "close" ? await leadClose(u, id, { outcome: str(f, "outcome", 20), note_md: str(f, "note_md", 5000), obstruction_md: str(f, "obstruction_md", 5000) || undefined })
    : { ok: false as const, error: "bad action" };
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}?tab=board&msg=${encodeURIComponent(r.ok ? (action === "join" ? "Joined." : action === "beat" ? "Lease extended by 6 h." : "Lead closed. Thanks for the note.") : r.error)}#leads`);
}

/** Propose an intermediate lemma from the problem page. */
export async function proposeLemmaAction(f: FormData) {
  const slug = str(f, "problem", 200);
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/p/${slug}?tab=lemmas`)}`);
  const r = await proposeLemma(u, slug, { name: str(f, "name", 80), statement: str(f, "statement", 5000), note: str(f, "note", 2000) || undefined });
  const msg = !r.ok ? r.error ?? "Could not propose the lemma."
    : r.existing ? "This lemma already exists on this problem."
    : "Lemma proposed. Lean is checking its statement; it becomes provable as soon as the check passes (usually under a minute).";
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}?tab=lemmas&msg=${encodeURIComponent(msg)}`);
}

/** Author of an accepted partial proof: publish its open lemmas (statements only) as intermediate problems. */
export async function shareLemmasAction(f: FormData) {
  const id = str(f, "id", 40);
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/s/${id}`)}`);
  const r = await shareLemmasOf(u, id);
  const msg = !r.ok ? r.error : r.lemmas.length
    ? `Shared ${r.lemmas.filter((l) => l.ok).length} of ${r.lemmas.length} open lemma(s)${r.lemmas.some((l) => !l.ok) ? ` — not shared: ${r.lemmas.filter((l) => !l.ok).map((l) => `${l.name} (${l.error})`).join("; ")}` : ""}.`
    : "No open lemma to share (only lemmas declared in your file can be shared).";
  revalidatePath(`/s/${id}`);
  redirect(`/s/${id}?msg=${encodeURIComponent(msg)}`);
}
