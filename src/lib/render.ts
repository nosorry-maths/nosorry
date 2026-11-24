import "server-only";
import { Marked, type Tokens } from "marked";
import katex from "katex";
import sanitizeHtml from "sanitize-html";
import { createHighlighter, type Highlighter } from "shiki";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const SAFE_HREF = /^(https?:\/\/[^\s]+|\/(?![/\\])[^\s]*|#[\w-]*)$/i;

// Markdown for untrusted user content. Defence in depth:
//  1. renderer: raw HTML escaped, link/image labels rendered through the inline parser (escaped), hrefs allow-listed;
//  2. KaTeX with trust:false, errors fall back to escaped source;
//  3. the final HTML goes through an allow-list sanitizer (tags, attributes, classes, URL schemes).
const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) { return esc(text); },
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(href)) return label;
      const external = /^https?:/i.test(href);
      return `<a href="${esc(href)}" rel="nofollow ugc noopener noreferrer"${external ? ' target="_blank"' : ""}>${label}</a>`;
    },
    image({ text }: Tokens.Image) { return esc(text ?? ""); },
  },
});

const KATEX_TAGS = ["span", "math", "semantics", "mrow", "mi", "mo", "mn", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "mtext", "mspace", "mstyle", "mtable", "mtr", "mtd", "mover", "munder", "munderover", "annotation", "menclose", "mpadded", "mphantom", "svg", "path", "line"];

function sanitize(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "hr", "em", "strong", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a",
      "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "div", ...KATEX_TAGS],
    allowedAttributes: {
      a: ["href", "rel", "target"],
      span: ["class", "style", "aria-hidden"], div: ["class"], code: ["class"],
      math: ["xmlns", "display"], annotation: ["encoding"], mspace: ["width"], mo: ["stretchy", "fence", "separator", "lspace", "rspace", "minsize", "maxsize"],
      mstyle: ["mathsize", "displaystyle", "scriptlevel"], mtable: ["columnalign", "rowspacing", "columnspacing"], mtd: ["columnalign"],
      mpadded: ["width", "height", "depth", "voffset"], menclose: ["notation"],
      svg: ["xmlns", "width", "height", "viewBox", "preserveAspectRatio", "style"], path: ["d"], line: ["x1", "x2", "y1", "y2", "stroke-width"],
      td: ["align"], th: ["align"], ol: ["start"],
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    allowedStyles: { "*": { "height": [/^[\d.\-]+em$/], "width": [/^[\d.\-]+em$/], "vertical-align": [/^[\d.\-]+em$/], "margin-left": [/^[\d.\-]+em$/], "margin-right": [/^[\d.\-]+em$/], "top": [/^[\d.\-]+em$/], "min-width": [/^[\d.\-]+em$/], "padding-left": [/^[\d.\-]+em$/], "border-bottom-width": [/^[\d.\-]+em$/] } },
    transformTags: { a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, rel: "nofollow ugc noopener noreferrer" } }) },
  });
}

function decodeEntities(s: string) {
  return s.replace(/&#60;/g, "<").replace(/&#62;/g, ">").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function tex(src: string, display: boolean) {
  try { return katex.renderToString(decodeEntities(src), { displayMode: display, throwOnError: true, trust: false, strict: "ignore", maxExpand: 500 }); }
  catch { return `<code>${esc(src)}</code>`; }
}

function withMath(src: string, render: (text: string) => string, inlineOnly = false): string {
  const math: string[] = [];
  const put = (t: string, display: boolean) => { math.push(tex(t, display && !inlineOnly)); return `\u0000M${math.length - 1}\u0000`; };
  const text = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => put(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => put(t, true))
    .replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_, t) => put(t, false));
  return render(text).replace(/\u0000M(\d+)\u0000/g, (_, i) => math[Number(i)]);
}

export function renderMarkdown(src: string | null | undefined): string {
  if (!src) return "";
  return sanitize(withMath(src, (t) => md.parse(t, { async: false }) as string));
}

/** Titles and short labels: inline TeX only, everything else escaped. */
export function renderInline(src: string | null | undefined): string {
  if (!src) return "";
  return sanitize(withMath(src, (t) => esc(t), true));
}

/** A short plain excerpt cut at a sentence boundary, never inside a formula; display math becomes inline. */
export function renderExcerpt(src: string | null | undefined, max = 320): string {
  if (!src) return "";
  let s = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => `$${t.replace(/\s+/g, " ").trim()}$`)
    // Plain text: drop Markdown links, emphasis and heading marks (formulas are untouched: they never contain these patterns).
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(\*\*|__)(?=\S)([^*_]+?)\1/g, "$2").replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ").trim();
  if (s.length > max) {
    // Walk the text once, tracking whether we are inside $…$; only cut outside formulas.
    let inMath = false, lastMathStart = -1, sentence = -1, space = -1;
    for (let i = 0; i < max; i++) {
      const ch = s[i];
      if (ch === "$" && s[i - 1] !== "\\") { inMath = !inMath; if (inMath) lastMathStart = i; continue; }
      if (inMath) continue;
      if ((ch === "." || ch === "?" || ch === "!" || ch === "," || ch === ";") && s[i + 1] === " ") sentence = i + 1;
      if (ch === " ") space = i;
    }
    const end = sentence > max * 0.5 ? sentence : inMath ? Math.min(lastMathStart, space > 0 ? space : lastMathStart) : (space > 0 ? space : max);
    s = s.slice(0, Math.max(0, end)).trimEnd() + " …";
  }
  // inline code
  return sanitize(withMath(s, (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>"), true));
}

let hl: Promise<Highlighter> | null = null;
export async function highlightLean(code: string): Promise<string> {
  hl ??= createHighlighter({ themes: ["github-light"], langs: ["lean4"] });
  const h = await hl;
  return h.codeToHtml(code, { lang: "lean4", themes: { light: "github-light" }, defaultColor: false });
}
