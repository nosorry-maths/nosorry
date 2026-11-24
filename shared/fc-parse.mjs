// Parsing of formal-conjectures files, shared by the importer (scripts/import-formal-conjectures.mjs) and the daily
// upstream watcher (shared/fc-upstream.mjs).
import crypto from "node:crypto";
import { COLLECTIONS, COLLECTION_FIELD, MSC, categoryForMsc } from "./taxonomy.mjs";

/** Subjects, primary subject and field of a parsed declaration (same rules as the importer). */
export function subjectsFor(p) {
  const cats = [...new Set(p.ams.map(categoryForMsc))];
  const override = COLLECTION_FIELD[p.coll[0]];
  return {
    subjects: [...(override ? [override.primary] : []), ...cats, ...p.ams.filter((a) => MSC[a]).map((a) => `msc:${a}`)],
    primary: override?.primary ?? cats[0] ?? "math.GM",
    field: override?.field ?? "math",
    tags: [...p.tags, ...(p.needsAnswer ? ["answer-required"] : [])],
  };
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Find the `]` closing an attribute starting at `i` (just after `@[`), skipping strings. */
function closeBracket(s, i) {
  let depth = 1;
  for (; i < s.length; i++) {
    if (s[i] === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === "\\") i++; i++; } continue; }
    if (s[i] === "[") depth++;
    if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Every categorized declaration of a file (`@[category …] theorem …`). `rel` is the path inside the repository,
 * e.g. FormalConjectures/ErdosProblems/1038.lean.
 */
export function parseSource(src, rel) {
  src = src.replace(/\r\n/g, "\n");
  const parts = rel.split("/");
  const coll = COLLECTIONS[parts[1]] ?? COLLECTIONS.Other;
  const stem = parts.slice(2).join("/").replace(/\.lean$/, "");
  const header = src.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? stem;
  const refUrl = src.match(/\*Reference[s]?:\*[^\n]*?\((https?:\/\/[^)\s]+)\)/)?.[1] ?? null;
  const out = [];
  const re = /@\[/g;
  let m;
  while ((m = re.exec(src))) {
    const end = closeBracket(src, m.index + 2);
    if (end < 0) break;
    const attr = src.slice(m.index + 2, end).replace(/\s+/g, " ");
    const cat = attr.match(/\bcategory (research open|research solved|textbook|test|API)\b/)?.[1];
    if (!cat) continue;
    const after = src.slice(end + 1);
    const d = after.match(/^\s*(?:(?:private|protected|noncomputable)\s+)*(theorem|lemma)\s+([^\s:({[]+)/);
    if (!d) continue;
    const declStart = end + 1 + after.indexOf(d[1]);
    // namespace in effect at this position
    const stack = []; // {ns: string[]} for namespaces, {ns: []} for sections
    const nameParts = (s) => s.match(/«[^»]*»|[^.«]+/g) ?? [];
    for (const line of src.slice(0, m.index).split("\n")) {
      const n = line.match(/^\s*namespace\s+(\S+)/); if (n) stack.push({ ns: nameParts(n[1]) });
      if (/^\s*(noncomputable\s+)?section\b/.test(line)) stack.push({ ns: [] });
      if (/^\s*end\b/.test(line)) stack.pop();
    }
    const ns = stack.flatMap((x) => x.ns);
    const short = d[2].replace(/^_root_\./, "");
    const decl = d[2].startsWith("_root_.") ? short : [...ns, short].join(".");
    // statement text: from keyword to the top-level ':=' that starts the proof
    const body = src.slice(declStart);
    const stop = body.search(/:=\s*(by\b|sorry\b|\n)/);
    const statement = (stop > 0 ? body.slice(0, stop) : body.slice(0, 600)).trim();
    // docstring right before the attribute
    const before = src.slice(0, m.index).replace(/(\s*set_option[^\n]*in\s*)$/, "");
    const di = before.lastIndexOf("/--");
    const doc = di >= 0 && /-\/\s*$/.test(before) ? before.slice(di + 3).replace(/-\/\s*$/, "").trim() : null;
    const ams = [...(attr.match(/\bAMS((?:\s+\d+)+)/)?.[1] ?? "").matchAll(/\d+/g)].map((x) => x[0].padStart(2, "0"));
    const tags = ["question", "conjecture", "theorem", "formal_proof", "disproof", "answer"].filter((t) => new RegExp(`\\b${t}\\b`).test(attr));
    const status = { "research open": "open", "research solved": "solved", textbook: "textbook", test: "test", API: "api" }[cat];
    out.push({ rel, coll, stem, header, refUrl, decl, short, statement, doc, ams, tags, status,
               needsAnswer: /answer\(\s*sorry\s*\)/.test(statement), src, attrStart: m.index, declStart });
  }
  // The first research declaration is the main problem; others are variants.
  const main = out.find((p) => p.status === "open" || p.status === "solved") ?? out[0];
  const stemSlug = `${main?.coll[0]}-${(main?.stem ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  for (const p of out) {
    p.isMain = p === main;
    p.slug = p.isMain ? stemSlug : `${stemSlug}--${p.short.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    p.title = p.isMain ? p.header : `${p.header} · ${p.short.split(".").slice(-2).join(".")}`;
    p.mainSlug = stemSlug;
  }
  return out;
}

/** Remove Lean comments (`--` to end of line, nested `/- … -/`, doc comments), keeping string literals. */
export function stripComments(s) {
  let out = "", i = 0, depth = 0;
  while (i < s.length) {
    if (depth === 0 && s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === "\\") j++; j++; }
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (s.startsWith("/-", i)) { depth++; i += 2; continue; }
    if (depth > 0 && s.startsWith("-/", i)) { depth--; i += 2; if (depth === 0) out += " "; continue; }
    if (depth > 0) { i++; continue; }
    if (s.startsWith("--", i)) { while (i < s.length && s[i] !== "\n") i++; continue; }
    out += s[i++];
  }
  return out;
}

// A top-level line that starts a new command (or a comment / attribute that precedes one).
const COMMAND = /^(@\[|\/-|--|theorem\b|lemma\b|def\b|noncomputable\b|private\b|protected\b|instance\b|abbrev\b|example\b|namespace\b|section\b|open\b|end\b|variable\b|universe\b|set_option\b|structure\b|inductive\b|class\b|import\b|attribute\b|macro\b|notation\b|infix|prefix|postfix|local\b|scoped\b|axiom\b|opaque\b|#)/;

/**
 * What a problem's statement really depends on, as text: the file without comments, without the category/AMS
 * attributes, without the OTHER categorized problems of the file, and with the target cut at its `:=`.
 * So a docstring fix, a status change (open → solved) or a variant added next to it does not count as a change of
 * this statement; a change to its own text or to a definition of the file does.
 */
export function statementKey(src, target) {
  src = src.replace(/\r\n/g, "\n");
  const entries = parseSource(src, "FormalConjectures/Other/x.lean");
  const t = entries.find((e) => e.decl === target || e.short === target || e.decl.endsWith("." + target));
  if (!t) return null;
  const lineStart = (i) => src.lastIndexOf("\n", i - 1) + 1;
  const blocks = entries.map((e) => {
    let start = lineStart(e.attrStart);
    // a `set_option … in` line right above belongs to the declaration
    for (;;) {
      const prev = lineStart(start - 1);
      if (start === 0 || !/^\s*set_option\b.*\bin\s*$/.test(src.slice(prev, start - 1))) break;
      start = prev;
    }
    let end = src.indexOf("\n", e.declStart);
    while (end >= 0 && end < src.length) {
      const next = src.indexOf("\n", end + 1);
      const line = src.slice(end + 1, next < 0 ? src.length : next);
      if (COMMAND.test(line)) break;
      end = next;
    }
    return { e, start, end: end < 0 ? src.length : end };
  }).sort((a, b) => b.start - a.start); // replace from the end so indices stay valid
  let text = src;
  for (const b of blocks) {
    const replacement = b.e === t ? `\n«target» ${b.e.statement}\n` : "\n";
    text = text.slice(0, b.start) + replacement + text.slice(b.end);
  }
  return keepUsedDefinitions(stripComments(text)).replace(/\s+/g, " ").trim();
}

const NAMED = /^(?:@\[[^\]]*\]\s*)?(?:(?:private|protected|noncomputable|partial|unsafe)\s+)*(def|abbrev|structure|inductive|class|theorem|lemma)\s+([^\s:({[⦃]+)/;
// identifiers (modifier letters such as the ᶜ of Aᶜ are postfix notation, not part of the name)
const tokensOf = (s) => new Set(s.split(/[^\p{Lu}\p{Ll}\p{Lt}\p{Lo}\p{N}_.'!?₀-ₜ]+/u).filter(Boolean));

/**
 * Drop the named definitions/lemmas of the file that the target does not use, directly or through other kept text
 * (textual closure: a name counts as used when it, or Namespace.name, or name.field, appears as a token). Everything
 * else — namespaces, opens, variables, instances, notations — is always kept. Conservative by design: when in doubt a
 * definition is kept, so a change to it still counts as a change of the statement.
 */
function keepUsedDefinitions(text) {
  const lines = text.split("\n");
  const blocks = [];
  for (const line of lines) {
    if (!blocks.length || /^\S/.test(line)) blocks.push([line]); else blocks[blocks.length - 1].push(line);
  }
  const items = blocks.map((b) => {
    const body = b.join("\n");
    const m = body.match(NAMED);
    return { body, name: m && !body.startsWith("«target»") ? m[2].replace(/^_root_\./, "") : null, keep: false };
  });
  const last = (n) => n.split(".").pop();
  // namespaces opened anywhere in the file: `open erdos208` makes `erdos208.s` usable as `s`
  const opened = new Set();
  for (const m of text.matchAll(/^\s*open\s+(?:scoped\s+)?([^\n]*?)(?:\s+in)?\s*$/gm)) for (const w of m[1].split(/\s+/)) if (w) opened.add(w);
  const usedBy = (tokens, name) => {
    const seg = last(name);
    const prefix = name.slice(0, -seg.length - 1);
    const distinctive = seg.length >= 8 || /[A-Z_]/.test(seg) || (prefix && (opened.has(prefix) || opened.has(last(prefix))));
    for (const t of tokens) {
      if (t === name || t.endsWith("." + name) || t.startsWith(name + ".") || t.includes("." + name + ".")) return true;
      // a one-piece name used through dot notation (C.graph.chromaticNumber uses `graph`): any piece counts
      if (!name.includes(".") && t.split(".").includes(name)) return true;
      if (distinctive && (t === seg || t.endsWith("." + seg) || t.split(".").includes(seg))) return true;
    }
    return false;
  };
  let frontier = items.filter((i) => !i.name);
  for (const i of frontier) i.keep = true;
  while (frontier.length) {
    const tokens = new Set(frontier.flatMap((i) => [...tokensOf(i.body)]));
    frontier = items.filter((i) => !i.keep && i.name && usedBy(tokens, i.name));
    for (const i of frontier) i.keep = true;
  }
  return items.filter((i) => i.keep).map((i) => i.body).join("\n");
}

/** Fingerprint of a problem's statement for change detection (see statementKey). Null if the target is not found. */
export function semanticHash(src, target) {
  const k = statementKey(src, target);
  return k == null ? null : "v3:" + sha(k);
}
