// copy of ../../shared/preflight.mjs — keep in sync (scripts/sync-skill.mjs)
// Static pre-checks on submitted Lean source. Shared by the web API (instant feedback), the CLI and the worker.
// This is a cheap first filter and a source of clear error messages, NOT the security boundary: the stage isolation
// (worker/sandbox.mjs), the statement/axiom checker on compiled terms (Compare.lean) and the kernel replay are.

import crypto from "node:crypto";

/**
 * Remove comments, string literals, char literals and the contents of «guillemet» identifiers, so that banned words
 * inside them don't trigger, and so that they can't hide code from the rules. Unknown constructs err on the side of
 * keeping text visible (more false positives, never fewer checks).
 */
export function stripLean(src) {
  let out = "", i = 0, depth = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (depth === 0 && src.startsWith("--", i)) { while (i < n && src[i] !== "\n") i++; continue; }
    if (src.startsWith("/-", i)) { depth++; i += 2; continue; }
    if (depth > 0 && src.startsWith("-/", i)) { depth--; i += 2; continue; }
    if (depth > 0) { if (c === "\n") out += "\n"; i++; continue; }
    // raw strings r"…", r#"…"#, r##"…"##
    const raw = /^r(#*)"/.exec(src.slice(i, i + 12));
    if (raw && !/[\w.']/.test(src[i - 1] ?? "")) {
      const close = '"' + raw[1];
      const end = src.indexOf(close, i + raw[0].length);
      out += '""';
      i = end < 0 ? n : end + close.length;
      continue;
    }
    if (c === '"') { out += '""'; i++; while (i < n && src[i] !== '"') { if (src[i] === "\\") i++; i++; } i++; continue; }
    // char literals: 'a', '\n', '\'', '"'
    if (c === "'" && !/[\w.'!?₀-₉]/.test(src[i - 1] ?? "")) {
      const m = /^'(\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/u.exec(src.slice(i, i + 16));
      if (m) { out += "' '"; i += m[0].length; continue; }
    }
    // «identifiers» may contain anything except »; keep a neutral placeholder
    if (c === "«") { const end = src.indexOf("»", i + 1); out += "«x»"; i = end < 0 ? n : end + 1; continue; }
    out += c; i++;
  }
  return out;
}

const RULES = [
  // [regex on stripped source, code, message]
  [/\baxiom\s/, "axiom", "new axioms are not allowed"],
  [/\bunsafe\b|\bpartial\s+def\b/, "unsafe", "`unsafe` / `partial` definitions are not allowed"],
  [/\bimplemented_by\b|\bextern\b|\bexport\s+\w+\s*\(/, "ffi", "`implemented_by` / `extern` are not allowed"],
  [/\bnative_decide\b|\bofReduceBool\b|\bofReduceNat\b|\btrustCompiler\b|decide\s*\+\s*native|\bnative\s*:=\s*true/, "native", "`native_decide` trusts the compiler and is not accepted"],
  [/#eval\b|#exit\b|#print\b|#check\w*\b|#reduce\b|#synth\b|\brun_cmd\b|\brun_elab\b|\brun_meta\b|\brun_tac\b|\bby_elab\b/, "command", "evaluation / debugging commands are not allowed"],
  // LeanSearchClient & friends: useful while searching, but they call the network (blocked in the sandbox) and are not proofs.
  [/#(leansearch|loogle|moogle|statesearch)\b|\b(exact\?|apply\?|rw\?|hint)(?![\w?])/, "search", "search commands (#leansearch, #loogle, exact?…) must be replaced by the lemmas they found before submitting"],
  [/\b(elab|elab_rules|macro|macro_rules|syntax|declare_syntax_cat|notation3?|infixl?|infixr|prefix|postfix|deriving\s+instance)\b/, "meta", "custom syntax / elaborators are not allowed in solutions"],
  [/@\[[^\]]*\b(term_elab|command_elab|tactic|macro|init|env_linter|builtin_\w+|delab|app_unexpander|csimp|implemented_by)\b[^\]]*\]/, "meta-attr", "meta-level attributes are not allowed in solutions"],
  [/\binitialize\b|\bbuiltin_initialize\b/, "init", "initializers are not allowed"],
  [/set_option\s+(?!maxHeartbeats\s+[1-9]\d{0,6}\b|maxRecDepth\s+[1-9]\d{0,4}\b|synthInstance\.maxHeartbeats\s+[1-9]\d{0,6}\b|linter\.|autoImplicit\b|relaxedAutoImplicit\b|pp\.)\S/, "option", "only maxHeartbeats (≤ 9,999,999), maxRecDepth, synthInstance.maxHeartbeats, linter.*, autoImplicit and pp.* options are allowed"],
  [/\b(IO|EIO|BaseIO|liftIO|unsafeIO|unsafeBaseIO|unsafeEIO|IO\.\w+|System\.\w+)\b/, "io", "IO is not allowed"],
  [/\bopaque\b/, "opaque", "`opaque` declarations are not allowed"],
  [/\bLean\.(Elab|Meta|Environment|Kernel|addDecl|Compiler)\b|\bimport\s+Lean\b/, "meta-api", "the Lean meta-programming API is not allowed in solutions"],
];
// Rules a reference statement may legitimately trip (statements define notation); solutions may reuse exactly those lines.
const STATEMENT_EXEMPT = new Set(["meta"]);

const ALLOWED_IMPORT = /^(Mathlib|Batteries|Aesop|Qq|Plausible|ProofWidgets|Init|Std|FormalConjecturesUtil|FormalConjecturesForMathlib|FormalConjectures\.Util|Physlib|QuantumInfo)(\.|$)/;
// Libraries refused on purpose, with the reason shown to the submitter.
const REFUSED_IMPORT = [
  [/^SciLean(\.|$)/, "SciLean is a scientific-computing library that relies on axioms and sorry by design; it cannot be used in proofs"],
  [/^PhyslibAlpha(\.|$)/, "PhyslibAlpha is Physlib's unreviewed staging area; import Physlib instead"],
];
const BIDI = /[‪-‮⁦-⁩]/;

/**
 * @param {string} src Lean source
 * @param {{kind?: 'proof'|'disproof'|'partial'|'formalization', challenge?: string}} opts
 *   challenge: reference source. A solution line identical to a reference line is exempt only from the notation/syntax
 *   rule (so a solution can restate the reference's own notation); every other rule still applies to it.
 */
export function preflight(src, opts = {}) {
  const errors = [], warnings = [];
  if (typeof src !== "string" || !src.trim()) return { ok: false, errors: [{ code: "empty", message: "empty source" }], warnings, imports: [], sorryCount: 0 };
  if (BIDI.test(src)) errors.push({ code: "bidi", message: "bidirectional control characters are not allowed" });
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(src)) errors.push({ code: "control", message: "control characters are not allowed" });
  const full = stripLean(src);
  let exemptView = full;
  if (opts.challenge) {
    const ref = new Set(stripLean(opts.challenge).split("\n").map((l) => l.trim()).filter((l) => l.length > 3));
    exemptView = full.split("\n").map((l) => (ref.has(l.trim()) ? "" : l)).join("\n");
  }
  const imports = [...full.matchAll(/(^|\n)\s*(public\s+|private\s+)?(meta\s+)?import\s+(all\s+)?([\w.]+)/g)].map((m) => m[5]);
  for (const imp of imports) {
    const refused = REFUSED_IMPORT.find(([re]) => re.test(imp));
    if (refused) errors.push({ code: "import", message: `import ${imp} refused: ${refused[1]}` });
    else if (!ALLOWED_IMPORT.test(imp)) errors.push({ code: "import", message: `import not allowed: ${imp}` });
  }
  for (const [re, code, message] of RULES) {
    if (opts.kind === "formalization" && (code === "meta")) continue; // statements may define notation; humans review them
    const view = STATEMENT_EXEMPT.has(code) ? exemptView : full;
    if (re.test(view)) errors.push({ code, message });
  }
  const sorryCount = (full.match(/\bsorry\b/g) ?? []).length + (full.match(/\badmit\b/g) ?? []).length;
  if ((opts.kind === "proof" || opts.kind === "disproof") && sorryCount > 0)
    warnings.push(`${sorryCount} sorry found: only declarations the target does not depend on may keep sorry`);
  return { ok: errors.length === 0, errors, warnings, imports, sorryCount };
}

/**
 * Fingerprint for duplicate detection: comments, whitespace and local names removed, so renaming lemmas or
 * reformatting does not make a copied proof look new. (A semantic fingerprint on compiled terms is planned.)
 */
export function fingerprint(src) {
  const s = stripLean(src)
    .replace(/\b(theorem|lemma|def|abbrev|instance)\s+[^\s:({[]+/g, "$1 _")   // declaration names
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(s).digest("hex");
}
