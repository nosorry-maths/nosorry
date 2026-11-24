import Link from "next/link";
import { notFound } from "next/navigation";
import { getSubject, listProblems, subjectTree, collectionCounts, mscCounts, PAGE, STATUS_FILTERS } from "@/lib/data";
import { ProblemEntry, Pager } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_ORDER = ["research", "open", "unsolved", "solved", "proved", "informal", "textbook", "test", "all"];
const SORTS = [["", "source order"], ["easy", "shortest statement first"], ["recent", "recently updated"], ["activity", "most activity"]] as const;

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const s = await getSubject(decodeURIComponent((await params).code));
  return { title: s ? `${s.name}` : "Not found" };
}

export default async function List({ params, searchParams }: {
  params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const code = decodeURIComponent((await params).code);
  const sp = await searchParams;
  const subject = await getSubject(code);
  if (!subject) notFound();
  const catCode = subject.level === 2 ? subject.code : subject.level === 3 ? subject.parent : null;
  const [tree, list, colls, mscs] = await Promise.all([
    subjectTree(),
    listProblems({ subject: code, status: sp.status, collection: sp.collection, sort: sp.sort, page: Number(sp.page ?? 1), variants: sp.variants === "1" }),
    collectionCounts(code),
    catCode ? mscCounts(catCode) : Promise.resolve([]),
  ]);
  const parent = subject.parent ? tree.find((t) => t.code === subject.parent) : null;
  const grand = parent?.parent ? tree.find((t) => t.code === parent.parent) : null;
  const field = subject.level === 1 ? subject.code : subject.level === 2 ? subject.parent! : grand?.code ?? "math";
  const cats = tree.filter((t) => t.level === 2 && t.parent === field && t.n > 0);
  const href = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, page: undefined, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return `/list/${encodeURIComponent(code)}${s ? `?${s}` : ""}`;
  };
  const cur = sp.status ?? "research";
  const codeLabel = subject.code.startsWith("msc:") ? `MSC ${subject.code.slice(4)}` : subject.code;

  return (
    <div className="cols left">
      <aside className="side">
        <h4>{tree.find((t) => t.code === field)?.name}</h4>
        <ul>
          {cats.map((c) => (
            <li key={c.code} className={c.code === catCode ? "on" : ""}>
              <Link href={`/list/${c.code}`}>{c.name}</Link><span className="count">{c.n}</span>
            </li>
          ))}
        </ul>
        {mscs.length > 1 && (<>
          <h4>MSC2020 classes <span className="muted" style={{ fontWeight: "normal" }}>(incl. cross-listed)</span></h4>
          <ul>
            {mscs.map((m) => (
              <li key={m.code} className={m.code === code ? "on" : ""}>
                <Link href={`/list/${encodeURIComponent(m.code)}`}>{m.code.slice(4)} {m.name}</Link><span className="count">{m.n}</span>
              </li>
            ))}
          </ul>
        </>)}
        <h4>Source</h4>
        <ul>
          <li className={!sp.collection ? "on" : ""}><Link href={href({ collection: undefined })}>All sources</Link></li>
          {colls.map((c) => (
            <li key={c.slug} className={sp.collection === c.slug ? "on" : ""}>
              <Link href={href({ collection: c.slug })}>{c.name}</Link><span className="count">{c.n}</span>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        <div className="crumbs">
          {grand && <><Link href={`/list/${grand.code}`}>{grand.name}</Link> &gt; </>}
          {parent && <><Link href={`/list/${parent.code}`}>{parent.name}</Link> &gt; </>}
          {codeLabel}
        </div>
        <div className="list-head">
          <h1>{subject.name}{subject.level > 1 && <span className="muted" style={{ fontWeight: "normal", fontSize: ".75em" }}> ({codeLabel})</span>}</h1>
          <p className="list-meta">
            {list.total.toLocaleString("en")} {list.total === 1 ? "entry" : "entries"}{sp.collection ? ` from ${colls.find((c) => c.slug === sp.collection)?.name}` : ""}
            {list.total > 0 && <>, showing {(list.page - 1) * PAGE + 1}–{Math.min(list.page * PAGE, list.total)}</>}
            {sp.variants !== "1" && <> · formal variants hidden</>}
          </p>
        </div>
        <div className="optbar">
          <span className="grp">Show:{" "}
            {STATUS_ORDER.map((k) => {
              const f = STATUS_FILTERS[k];
              return cur === k
                ? <b key={k} title={f.help} aria-current="true">{f.label} </b>
                : <Link key={k} href={href({ status: k === "research" ? undefined : k })} title={f.help}>{f.label} </Link>;
            })}
          </span>
          <span className="grp">Sort:{" "}
            {SORTS.map(([k, l]) => ((sp.sort ?? "") === k ? <b key={k}>{l} </b> : <Link key={k} href={href({ sort: k || undefined })}>{l} </Link>))}
          </span>
          <span className="grp"><Link href={href({ variants: sp.variants === "1" ? undefined : "1" })} title="other formal statements of the same informal problem (weaker, stronger, special cases)">
            {sp.variants === "1" ? "hide formal variants" : "include formal variants"}</Link></span>
        </div>
        <p className="small muted" style={{ margin: "0 0 4px" }}><b>{STATUS_FILTERS[cur]?.label}</b>: {STATUS_FILTERS[cur]?.help}.</p>
        <hr style={{ margin: "4px 0 0" }} />
        <dl className="listing">
          {list.rows.map((p, i) => <ProblemEntry key={p.id} p={p} n={(list.page - 1) * PAGE + i + 1} />)}
        </dl>
        {!list.rows.length && <p className="muted">No problems match these filters.</p>}
        <Pager page={list.page} hasMore={list.hasMore} base={(p) => href({ page: String(p) })} />
      </section>
    </div>
  );
}
