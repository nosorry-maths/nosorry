// Intermediate lemmas ("bricks"), shared by the web app (TypeScript) and the worker.
//
// A lemma is a problem with status 'lemma' attached to a parent problem. Its statement file is the parent's
// Challenge.lean with the lemma added just before the closing `end <Namespace>`, so it sees exactly the parent's
// imports and definitions. The statement is checked by the normal 'formalization' path of the worker (it must compile,
// be a theorem stated with `sorry`, and add no axiom); the worker then accepts it automatically — no human review,
// because a lemma only matters when a kernel-checked proof uses it.
import crypto from "node:crypto";
import { POINTS } from "./scoring.mjs";

/** A model id (claude-…, gpt-…, gemini-…) rather than an agent name. */
const MODEL_LIKE = /^(claude|gpt|o\d|gemini|grok|llama|mistral|qwen|deepseek|kimi|glm)[-\w.]*$/i;

export const LEMMA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_']{0,59}$/;
export const MAX_LEMMAS_PER_PARENT = 300;

const ALPH = "0123456789abcdefghjkmnpqrstvwxyz";
const shortId = (prefix, len = 10) => prefix + "-" + Array.from(crypto.randomBytes(len), (x) => ALPH[x % 32]).join("");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clip = (s, n) => (s == null ? s : String(s).slice(0, n));

const OPEN = "([{⟨⦃⟪", CLOSE = ")]}⟩⦄⟫";

/** Index of the first occurrence of `token` at bracket depth 0, outside comments and strings; -1 if none. */
export function topLevelIndex(s, token) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "-" && s[i + 1] === "-") { const e = s.indexOf("\n", i); if (e < 0) return -1; i = e; continue; }
    if (ch === "/" && s[i + 1] === "-") {
      let nest = 1; i += 2;
      while (i < s.length && nest > 0) {
        if (s[i] === "/" && s[i + 1] === "-") { nest++; i += 2; } else if (s[i] === "-" && s[i + 1] === "/") { nest--; i += 2; } else i++;
      }
      i--; continue;
    }
    if (ch === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === "\\") i++; i++; } continue; }
    if (OPEN.includes(ch)) { depth++; continue; }
    if (CLOSE.includes(ch)) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && s.startsWith(token, i)) {
      // `:` must not be part of `:=` when looking for the type separator.
      if (token === ":" && s[i + 1] === "=") continue;
      return i;
    }
  }
  return -1;
}

/** Commands that would end the declaration and inject something else into the statement file. */
const COMMAND_LINE = /^\s*(?:@\[|#|axiom\b|theorem\b|lemma\b|def\b|abbrev\b|instance\b|structure\b|class\b|inductive\b|namespace\b|section\b|end\b|open\b|import\b|module\b|set_option\b|attribute\b|macro\b|syntax\b|elab\b|notation\b|infix|prefix|postfix|variable\b|universe\b|opaque\b|private\b|protected\b|noncomputable\b|unsafe\b|partial\b|example\b|mutual\b|initialize\b|builtin_)/;

/**
 * Accepts "theorem foo (n : ℕ) : P n", "foo (n : ℕ) : P n" or "(n : ℕ) : P n" (optionally followed by ":= …") and
 * returns the signature "(n : ℕ) : P n". Throws a readable Error when it cannot be used as a lemma statement.
 */
export function normalizeSignature(name, statement) {
  if (!LEMMA_NAME_RE.test(name ?? "")) throw new Error("lemma name must be a plain Lean identifier (letters, digits, _ and ', at most 60 characters)");
  let s = String(statement ?? "").replace(/\r/g, "").trim();
  s = s.replace(/^\/--[\s\S]*?-\/\s*/, "");
  const kw = /^(?:(?:private|protected)\s+)*(?:theorem|lemma)\s+[^\s(:{[⦃⟨]+/;
  if (kw.test(s)) s = s.replace(kw, "");
  else if (s.startsWith(name) && /^[\s(:{[⦃⟨]/.test(s.slice(name.length))) s = s.slice(name.length);
  const def = topLevelIndex(s, ":=");
  if (def >= 0) s = s.slice(0, def);
  s = s.trim();
  if (!s) throw new Error("the statement is empty");
  if (s.length > 4000) throw new Error("the statement is too long (4000 characters at most)");
  if (/\bsorry\b/.test(s)) throw new Error("the statement must not contain sorry");
  if (s.split("\n").slice(1).some((l) => COMMAND_LINE.test(l) && !/^\s/.test(l))) throw new Error("the statement must be a single declaration (no other Lean command)");
  if (topLevelIndex(s, ":") < 0) throw new Error("the statement must have a type, like `(n : ℕ) (h : 0 < n) : n ≤ n ^ 2`");
  // Continuation lines must be indented so Lean reads them as part of the declaration.
  return s.split("\n").map((l, i) => (i === 0 || /^\s/.test(l) || !l ? l : "    " + l)).join("\n");
}

/** Inserts the lemma before the trailing `end <Namespace>` lines of the parent statement file. */
export function buildLemmaChallenge(parentSource, name, sig, note) {
  const lines = parentSource.replace(/\r/g, "").split("\n");
  let i = lines.length - 1;
  const ends = [];
  let insertAt = lines.length;
  while (i >= 0) {
    const l = lines[i].trim();
    if (!l || l.startsWith("--")) { i--; continue; }
    const m = l.match(/^end\s+(\S+)$/);
    if (!m) break;
    ends.push(m[1]); insertAt = i; i--;
  }
  const ns = ends.join(".");   // collected bottom-up: outermost namespace first
  const doc = (note ?? "").split("\n")[0].replace(/-\//g, "- /").slice(0, 200).trim();
  const block = ["", `/-- Intermediate lemma (nosorry)${doc ? `: ${doc}` : ""} -/`, `theorem ${name} ${sig} := by`, "  sorry", ""];
  const out = [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)].join("\n");
  return { source: out, target: ns ? `${ns}.${name}` : name };
}

/** Signature of a declaration in a Lean source, for open lemmas shared from a partial proof. */
export function extractSignature(src, shortName) {
  const esc = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:@\\[[^\\]\\n]*\\][ \\t\\n]*)?(?:(?:private|protected)\\s+)*(?:theorem|lemma)\\s+(?:\\S+\\.)?${esc}(?=[\\s(:{[⦃⟨])`);
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  const end = topLevelIndex(rest, ":=");
  if (end < 0) return null;
  return rest.slice(0, end).trim();
}

/** Strips Lean's private-name prefix: `_private.src.Solution.0.A.b` → `A.b`. */
export const publicName = (n) => String(n).replace(/^_private\.(?:[^.]+\.)*?0\./, "");

export async function parentRow(c, ref) {
  const { rows: [p] } = await c.query(
    `SELECT p.id, p.slug, p.title, p.collection, p.field, p.primary_subject, p.subjects, p.formalization, p.status, p.statement_status,
            v.challenge_source, v.workspace, v.toolchain
     FROM problems p LEFT JOIN problem_versions v ON v.id=p.current_version_id
     WHERE ${typeof ref === "number" ? "p.id=$1" : "(p.slug=$1 OR p.ident=$1)"}`, [ref]);
  return p ?? null;
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Creates a lemma of `parent` and queues the check of its statement. Returns { ok, lemma_id, slug, submission, target }
 * or { ok:false, error } / { ok:true, existing:true, … } when the same lemma already exists.
 */
/** @param {any} c @param {{ parent: any, userId: number, name: string, statement: string, note?: string|null, origin?: string, originSubmissionId?: number|null, agentName?: string|null, agentModel?: string|null }} args */
export async function createLemma(c, { parent, userId, name, statement, note, origin = "proposed", originSubmissionId = null, agentName = null, agentModel = null }) {
  // Older clients send the model id in the agent field: recognise it, so lemma statements are not listed as "unknown".
  if (!agentModel && agentName && MODEL_LIKE.test(agentName)) { agentModel = agentName; agentName = null; }
  if (!parent) return { ok: false, error: "unknown problem" };
  if (parent.formalization !== "formal" || !parent.challenge_source) return { ok: false, error: "this problem has no formal statement yet: lemmas need one to build on" };
  if (parent.status === "withdrawn") return { ok: false, error: "problem withdrawn" };
  let sig;
  try { sig = normalizeSignature(name, statement); } catch (e) { return { ok: false, error: e.message }; }
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  const { rows: same } = await c.query(
    `SELECT id, slug, lemma_name, lemma_signature, lemma_state FROM problems
     WHERE parent_id=$1 AND status='lemma' AND lemma_state <> 'invalid' AND (lemma_name=$2 OR regexp_replace(lemma_signature, '\\s+', ' ', 'g') = $3)`,
    [parent.id, name, norm(sig)]);
  if (same.length) {
    const s = same[0];
    return s.lemma_name === name && norm(s.lemma_signature) !== norm(sig)
      ? { ok: false, error: `a different lemma named ${name} already exists on this problem: pick another name` }
      : { ok: true, existing: true, lemma_id: Number(s.id), slug: s.slug, state: s.lemma_state };
  }
  const { rows: [{ n }] } = await c.query("SELECT count(*)::int AS n FROM problems WHERE parent_id=$1 AND status='lemma'", [parent.id]);
  if (n >= MAX_LEMMAS_PER_PARENT) return { ok: false, error: "this problem already has too many lemmas" };

  const { source, target } = buildLemmaChallenge(parent.challenge_source, name, sig, note);
  const statementMd = `${(note ?? "").trim() ? `${note.trim()}\n\n` : ""}\`\`\`lean\ntheorem ${name} ${sig}\n\`\`\``;
  const base = `lemma-${slugify(parent.slug).slice(0, 40)}-${slugify(name).slice(0, 40)}`;
  const { rows: [p] } = await c.query(
    `INSERT INTO problems(ident, slug, collection, field, title, statement_md, status, primary_subject, subjects, tags,
       statement_status, formalization, parent_id, lemma_state, lemma_origin, origin_submission_id, proposed_by, lemma_note, lemma_name, lemma_signature)
     VALUES ('tmp-'||md5(random()::text), 'tmp-'||md5(random()::text), $1, $2, $3, $4, 'lemma', $5, $6, '{lemma}',
       'draft', 'informal', $7, 'checking', $8, $9, $10, $11, $12, $13) RETURNING id`,
    [parent.collection, parent.field ?? "math", clip(`Lemma ${name} · ${parent.title}`, 300), statementMd, parent.primary_subject, parent.subjects ?? [],
     parent.id, origin, originSubmissionId, userId, clip(note, 2000) ?? null, name, sig]);
  // The clean slug goes to the live lemma: a rejected twin (same parent and name) that holds it is renamed aside.
  await c.query(`UPDATE problems SET slug = slug || '-invalid-' || id
                 WHERE slug=$1 AND status='lemma' AND lemma_state='invalid' AND parent_id=$2 AND lemma_name=$3`, [base, parent.id, name]);
  const { rows: [{ taken }] } = await c.query("SELECT EXISTS (SELECT 1 FROM problems WHERE slug=$1) AS taken", [base]);
  const slug = taken ? `${base}-${p.id}` : base;
  await c.query(`UPDATE problems SET ident='NS.' || lpad(id::text, 5, '0'), slug=$2,
                 search_text = ns_fold($3 || ' ' || $2 || ' ' || $4 || ' ' || coalesce($5, '')) WHERE id=$1`,
    [p.id, slug, `Lemma ${name} ${parent.title}`, sig, note ?? ""]);
  const publicId = shortId("s");
  const { rows: [s] } = await c.query(
    `INSERT INTO submissions(public_id, user_id, problem_id, kind, title, body_md, lean_source, source_hash, agent_name, agent_model, status, verdict)
     VALUES ($1,$2,$3,'formalization',$4,$5,$6,$7,$8,$9,'queued',$10) RETURNING id`,
    [publicId, userId, p.id, clip(`Statement of lemma ${name}`, 300), clip(note, 20_000) ?? null, source, sha256(source), clip(agentName, 60) ?? null,
     clip(agentModel, 80) ?? null, JSON.stringify({ decl_name: target, lemma: true })]);
  await c.query("INSERT INTO jobs(kind, submission_id, priority) VALUES ('check_formalization',$1,140)", [s.id]);
  await c.query("NOTIFY nosorry_jobs");
  return { ok: true, lemma_id: Number(p.id), slug, submission: publicId, target, signature: sig };
}

/** Worker: the statement check of a lemma passed → it becomes an open lemma, provable like any problem. */
export async function acceptLemmaStatement(c, sub) {
  const { rows: [l] } = await c.query(
    `SELECT l.id, l.parent_id, l.lemma_name, l.lemma_signature, pv.workspace, pv.toolchain
     FROM problems l JOIN problems par ON par.id=l.parent_id LEFT JOIN problem_versions pv ON pv.id=par.current_version_id
     WHERE l.id=$1 AND l.status='lemma' FOR UPDATE OF l`, [sub.problem_id]);
  if (!l) return;
  const { rows: [{ next }] } = await c.query("SELECT coalesce(max(version),0)+1 AS next FROM problem_versions WHERE problem_id=$1", [l.id]);
  const { rows: [v] } = await c.query(
    `INSERT INTO problem_versions(problem_id, version, decl_name, challenge_source, statement_lean, statement_hash, toolchain, workspace, change_reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [l.id, next, sub.verdict?.decl_name ?? sub.decl_name_hint, sub.lean_source, `theorem ${l.lemma_name} ${l.lemma_signature}`, sha256(sub.lean_source),
     l.toolchain ?? "leanprover/lean4:v4.33.1", l.workspace ?? "formal-conjectures", `lemma statement checked by submission ${sub.public_id}`, sub.user_id]);
  await c.query(`UPDATE problems SET current_version_id=$2, formalization='formal', statement_status='reviewed', lemma_state='open', updated_at=now() WHERE id=$1`, [l.id, v.id]);
  await c.query("UPDATE submissions SET problem_version_id=$2 WHERE id=$1", [sub.id, v.id]);
  const { rows: [u] } = await c.query("SELECT handle FROM users WHERE id=$1", [sub.user_id]);
  await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary) VALUES ($1,'lemma',$2,'problem',$3,$4)`,
    [l.parent_id, sub.user_id, l.id, clip(`${u?.handle ?? "someone"} proposed lemma ${l.lemma_name}: ${l.lemma_signature.replace(/\s+/g, " ")}`, 400)]);
}

/** Worker: the statement check failed → the lemma is marked invalid with the reason (its name becomes free again). */
export async function rejectLemmaStatement(c, sub, reason) {
  // Keep the first Lean error (not the warnings before it), with the lemma's own line numbers stripped of the file prefix.
  const text = String(reason ?? "").trim();
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /\berror:/.test(l));
  const core = i >= 0 ? lines.slice(i, i + 8).join("\n").replace(/^src\/Challenge\.lean:/, "line ") : text;
  await c.query("UPDATE problems SET lemma_state='invalid', lemma_note=$2, updated_at=now() WHERE id=$1 AND status='lemma'",
    [sub.problem_id, clip(`Statement check failed: ${core.trim()}`, 1500)]);
}

/** Worker: a lemma received its first verified proof. Lemma proofs are published so that others can reuse them. */
export async function onLemmaProved(c, sub) {
  const { rows: [l] } = await c.query("SELECT id, parent_id, lemma_name, lemma_state FROM problems WHERE id=$1 AND status='lemma'", [sub.problem_id]);
  if (!l) return;
  await c.query("UPDATE submissions SET visibility='public' WHERE id=$1", [sub.id]);
  if (l.lemma_state === "proved") return;
  await c.query("UPDATE problems SET lemma_state='proved', updated_at=now() WHERE id=$1", [l.id]);
  const { rows: [u] } = await c.query("SELECT handle FROM users WHERE id=$1", [sub.user_id]);
  await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary) VALUES ($1,'lemma.proved',$2,'submission',$3,$4)`,
    [l.parent_id, sub.user_id, sub.id, `${u?.handle ?? "someone"} proved lemma ${l.lemma_name}: it can now be reused in proofs`]);
}

/**
 * Worker: an accepted proof/partial defines (and uses) some declarations of its own; those matching proved lemmas
 * credit the lemma's prover and proposer, once per using submission, never for using your own lemma.
 */
export async function creditLemmaUses(c, sub, ownDecls) {
  const names = [...new Set((ownDecls ?? []).map(publicName))].slice(0, 500);
  if (!names.length) return [];
  const { rows: lemmas } = await c.query(
    `SELECT l.id, l.parent_id, l.lemma_name, l.proposed_by, v.decl_name,
            (SELECT s.user_id FROM submissions s WHERE s.problem_id=l.id AND s.kind='proof' AND s.status='verified' ORDER BY s.created_at LIMIT 1) AS prover
     FROM problems l JOIN problem_versions v ON v.id=l.current_version_id
     WHERE l.status='lemma' AND l.lemma_state='proved' AND v.decl_name = ANY($1) AND l.id <> $2`, [names, sub.problem_id ?? 0]);
  const credited = [];
  for (const l of lemmas) {
    const ins = await c.query("INSERT INTO lemma_uses(lemma_id, submission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [l.id, sub.id]);
    if (!ins.rowCount) continue;
    const pay = [];
    if (l.prover && Number(l.prover) !== Number(sub.user_id)) pay.push([l.prover, POINTS.lemma.used_prover, "prover"]);
    if (l.proposed_by && Number(l.proposed_by) !== Number(sub.user_id) && Number(l.proposed_by) !== Number(l.prover)) pay.push([l.proposed_by, POINTS.lemma.used_proposer, "proposer"]);
    for (const [uid, delta, role] of pay) {
      await c.query("INSERT INTO point_events(user_id, submission_id, delta, reason, note) VALUES ($1,$2,$3,$4,$5)",
        [uid, sub.id, delta, `lemma_used:${role}`, `lemma ${l.lemma_name} (problem ${l.id}) used by submission ${sub.public_id}`]);
    }
    await c.query(`INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary) VALUES ($1,'lemma.used',$2,'submission',$3,$4)`,
      [l.parent_id, sub.user_id, sub.id, `Lemma ${l.lemma_name} was used in an accepted proof (${sub.public_id})`]);
    credited.push(l.lemma_name);
  }
  return credited;
}

/**
 * Turns the open lemmas of an accepted partial proof into intermediate problems (only their statements are shared,
 * never the proofs). Returns [{ name, ok, error?, slug? }].
 */
export async function shareOpenLemmas(c, sub, agentName = null, agentModel = sub.agent_model ?? null) {
  const open = (sub.verdict?.open_lemmas ?? []).map(publicName);
  const target = publicName(sub.verdict?.target ?? "");
  const parent = await parentRow(c, Number(sub.problem_id));
  const out = [];
  for (const full of [...new Set(open)]) {
    if (full === target) continue;
    const short = full.split(".").pop();
    if (!short || !LEMMA_NAME_RE.test(short) || /(^|\.)(_|match_|proof_|eq_\d)/.test(full)) continue;
    const sig = extractSignature(sub.lean_source ?? "", short);
    if (!sig) { out.push({ name: short, ok: false, error: "could not read its statement from the source" }); continue; }
    const r = await createLemma(c, { parent, userId: sub.user_id, name: short, statement: sig, note: `Left open by partial proof ${sub.public_id}.`,
      origin: "partial", originSubmissionId: sub.id, agentName, agentModel });
    out.push({ name: short, ...r });
  }
  return out;
}
