import Link from "next/link";
import { renderMarkdown, renderInline, renderExcerpt } from "@/lib/render";
import type { ProblemRow, SubmissionRow } from "@/lib/data";
import { fmtDate } from "@/lib/data";
import { CATEGORIES } from "../../shared/taxonomy.mjs";

const LABEL: Record<string, string> = {
  open: "open", solved: "known result", textbook: "textbook", test: "sanity test", api: "API lemma",
  proved: "proved here", disproved: "disproved here",
  verified: "verified", human_verified: "human-verified", partial: "partial", rejected: "rejected", error: "server error", needs_review: "in review",
  queued: "queued", running: "checking", accepted: "accepted", revoked: "revoked", superseded: "superseded",
  duplicate: "duplicate", draft: "draft statement", reviewed: "reviewed statement", disputed: "disputed statement", frozen: "frozen statement",
};
const STATUS_CLASS: Record<string, string> = { proved: "verified", disproved: "verified" };
export function Status({ s }: { s: string }) {
  return <span className={`st st-${STATUS_CLASS[s] ?? s}`}>{LABEL[s] ?? s}</span>;
}

/** One status for a problem: proved/disproved here wins over open/known; the literature status is kept as a qualifier. */
export function ProblemStatus({ p }: { p: Pick<ProblemRow, "status" | "resolution" | "solved_on_platform"> }) {
  if (p.resolution) {
    return <><Status s={p.resolution} /> <span className="muted small">({p.status === "open" ? "open in the literature" : LABEL[p.status] ?? p.status})</span></>;
  }
  return <Status s={p.status} />;
}

export function Md({ src, className }: { src: string | null | undefined; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }} />;
}
export function Tex({ src, as: As = "span", className }: { src: string | null | undefined; as?: "span" | "h1" | "div"; className?: string }) {
  return <As className={className} dangerouslySetInnerHTML={{ __html: renderInline(src) }} />;
}

export const subjectName = (code: string) => (CATEGORIES as Record<string, string>)[code] ?? code;
export function Subjects({ codes }: { codes: string[] }) {
  const cats = codes.filter((s) => !s.startsWith("msc:"));
  return (
    <>
      {cats.map((c, i) => (
        <span key={c}>{i > 0 && "; "}{i === 0 ? <b>{subjectName(c)} ({c})</b> : `${subjectName(c)} (${c})`}</span>
      ))}
    </>
  );
}

/** Human-readable ledger reasons. */
export function reasonLabel(reason: string): string {
  const [a, b, c] = reason.split(":");
  if (a === "proof") return `${b === "first" ? "first" : "later"} verified proof of ${c === "open" ? "an open problem" : c === "solved" ? "a known result" : `a ${c} statement`}`;
  if (a === "critique") return `accepted critique (${b.replace("_", " ")})`;
  if (a === "review") return `accepted ${b}`;
  if (a === "revoke") return `reversed: ${b.replace("-", " ")}`;
  if (a === "rescore") return "reversed: award recomputed";
  if (a === "penalty") return `penalty: ${b}`;
  return reason;
}

/** One entry of a listing page: index + identifier line, then title / status / subjects / excerpt. */
export function ProblemEntry({ p, n }: { p: ProblemRow; n: number }) {
  return (
    <>
      <dt>
        <span className="num">[{n}]</span>
        <Link href={`/p/${p.slug}`} className="mono">{p.ident}</Link>{" "}
        [<Link href={`/p/${p.slug}/challenge.lean`}>lean</Link>, <Link href={`/submit?problem=${p.slug}`}>submit</Link>]
      </dt>
      <dd>
        <div className="list-title"><Link href={`/p/${p.slug}`} dangerouslySetInnerHTML={{ __html: renderInline(p.title) }} /></div>
        <div className="list-line"><span className="descriptor">Status:</span><ProblemStatus p={p} />
          {p.statement_status === "disputed" && <> · <Status s="disputed" /></>}
          {p.formalization === "informal" ? <> · <span className="st st-needs_review">awaiting formalization</span></> : p.statement_status === "draft" && <> · <Status s="draft" /></>}
          {(p.n_proofs ?? 0) > 0 && <> · {p.n_proofs} checked contribution{p.n_proofs === 1 ? "" : "s"}</>}
          {(p.n_threads ?? 0) > 0 && <> · <Link href={`/p/${p.slug}#research`}>{p.n_threads} {p.n_threads === 1 ? "person" : "people"} researching</Link></>}
        </div>
        <div className="list-line"><span className="descriptor">Subjects:</span><Subjects codes={p.subjects} /></div>
        {p.statement_md && <div className="list-abs" dangerouslySetInnerHTML={{ __html: renderExcerpt(p.statement_md, 300) }} />}
      </dd>
    </>
  );
}

export function SubmissionTable({ rows, showProblem = true, showSubmitter = true }: { rows: SubmissionRow[]; showProblem?: boolean; showSubmitter?: boolean }) {
  if (!rows.length) return <p className="muted small">None.</p>;
  return (
    <div className="scroll-x">
      <table className="t">
        <thead><tr><th>Id</th><th>Kind</th><th>Status</th>{showProblem && <th>Problem</th>}{showSubmitter && <th>Submitter</th>}<th>Agent / model</th><th>Date</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td><Link href={`/s/${s.public_id}`} className="mono">{s.public_id}</Link></td>
              <td>{s.kind}</td>
              <td><Status s={s.status} />{s.visibility === "private" && <span className="muted small"> · sealed</span>}</td>
              {showProblem && <td>{s.problem_slug ? <Link href={`/p/${s.problem_slug}`} dangerouslySetInnerHTML={{ __html: renderInline(s.problem_title) }} /> : <span className="muted">new formalization</span>}</td>}
              {showSubmitter && <td><Link href={`/u/${s.handle}`}>{s.handle}</Link></td>}
              <td className="muted">{[s.agent_name, s.agent_model].filter(Boolean).join(" / ") || "—"}</td>
              <td className="muted">{fmtDate(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, hasMore, base }: { page: number; hasMore: boolean; base: (p: number) => string }) {
  return (
    <div className="pager">
      {page > 1 && <Link href={base(page - 1)}>&lt; previous</Link>}
      {hasMore && <Link href={base(page + 1)}>next &gt;</Link>}
    </div>
  );
}
