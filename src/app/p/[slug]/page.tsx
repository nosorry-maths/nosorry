import Link from "next/link";
import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { highlightLean, renderInline, renderExcerpt } from "@/lib/render";
import { recentSubmissions, fmtDate } from "@/lib/data";
import { Md, Status, ProblemStatus, SubmissionTable, Subjects, subjectName } from "@/components/ui";
import { CodeBlock } from "@/components/forms";
import { createCritique, setStatementStatus } from "@/app/actions";
import { threadsForProblem } from "@/lib/research";
import { isModerator } from "@/lib/auth";
import { ThreadList, ThreadForm } from "@/components/research";
import { problemState, streamSince } from "@/lib/feed";
import { BoardView, RecordCard, RecordsView } from "@/components/workspace";
import { LiveStream } from "@/components/livestream";
import { JoinSolvers } from "@/components/solve";
import { LemmasView } from "@/components/lemmas";
import { lemmasOf, lemmaSnippet } from "@/lib/lemmas";
import { POINTS } from "../../../../shared/scoring.mjs";
import { aixivOf } from "@/lib/aixiv";
import { currentFocus, votesOf } from "@/lib/desk";
import { VoteButton } from "@/components/focus";
import { featureAction } from "@/app/actions-community";
import { Elsewhere } from "@/components/elsewhere";

export const dynamic = "force-dynamic";

type P = {
  id: number; ident: string; slug: string; title: string; statement_md: string | null; status: string; statement_status: string; metric_name: string | null;
  primary_subject: string; subjects: string[]; tags: string[]; collection: string; collection_name: string; source_url: string | null;
  source_path: string | null; solved_on_platform: boolean; resolution: string | null; variant_of: number | null; needs_answer: boolean;
  recheck_pending: boolean; version: number | null; decl_name: string | null; statement_lean: string | null; challenge_source: string | null;
  statement_hash: string | null; toolchain: string | null; upstream_commit: string | null; main_slug: string | null; main_title: string | null;
  parent_slug: string | null; parent_title: string | null; lemma_state: "checking" | "open" | "proved" | "invalid" | null; lemma_name: string | null;
  lemma_signature: string | null; lemma_note: string | null; lemma_origin: string | null;
  field: string; field_name: string | null; formalization: string; verification: string; license: string | null; attribution: string | null;
  workspace: string | null; review_note: string | null; reviewed_at: string | null; reviewer: string | null; created_at: string;
};

const VERIFICATION_LABEL: Record<string, string> = {
  "lean-kernel": "Lean kernel (formal proof)",
  certificate: "external solver + certificate replayed in Lean (not yet supported)",
  cas: "computer algebra — not a formal proof (not yet supported)",
  "numeric-tolerance": "numeric answer within tolerance — not a formal proof (not yet supported)",
};

const CRITIQUE_MSG: Record<string, string> = {
  blocked: "Your account cannot submit critiques right now.",
  limit: "You have opened many critiques this hour; please wait a little.",
  invalid: "Choose a kind and write an argument.",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await one<{ title: string; ident: string }>("SELECT title, ident FROM problems WHERE slug=$1", [(await params).slug]);
  return { title: p ? `[${p.ident}] ${p.title.replace(/\$/g, "")}` : "Not found" };
}

export default async function Problem({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ critique?: string; from?: string; research?: string; tab?: string; msg?: string }> }) {
  const { slug } = await params;
  const { critique: critiqueFlag, from, research: researchFlag, tab: tabParam, msg } = await searchParams;
  const TABS = ["board", "stream", "statement", "lemmas", "records"] as const;
  const tab = (TABS as readonly string[]).includes(tabParam ?? "") ? tabParam! : (critiqueFlag || researchFlag ? "statement" : "board");
  const fromRandom = from === "random";
  const p = await one<P>(`
    SELECT p.*, c.name AS collection_name, v.version, v.decl_name, v.statement_lean, v.challenge_source, v.statement_hash, v.toolchain, v.upstream_commit,
           v.workspace, v.review_note, v.reviewed_at, ru.handle AS reviewer, f.name AS field_name,
           m.slug AS main_slug, m.title AS main_title, par.slug AS parent_slug, par.title AS parent_title
    FROM problems p LEFT JOIN problem_versions v ON v.id = p.current_version_id LEFT JOIN users ru ON ru.id = v.reviewed_by
    LEFT JOIN subjects f ON f.code = p.field
    LEFT JOIN collections c ON c.slug = p.collection LEFT JOIN problems m ON m.id = p.variant_of LEFT JOIN problems par ON par.id = p.parent_id WHERE p.slug = $1`, [slug]);
  if (!p) notFound();
  const user = await currentUser();
  const isLemma = p.status === "lemma";
  const [lemmas, snippet, elsewhere, vote, focusNow] = await Promise.all([lemmasOf(p.id), isLemma && p.lemma_state === "proved" ? lemmaSnippet(p.id) : Promise.resolve(null), aixivOf(p.id),
    votesOf(p.id, user?.id), currentFocus()]);
  const featured = focusNow?.id != null && Number(focusNow.id) === Number(p.id);
  const [subs, board, stream, threads, variants, critiques, versions, html, fullHtml] = await Promise.all([
    recentSubmissions({ problemId: p.id, limit: 100 }),
    problemState(p.slug),
    streamSince(p.slug, 0, 500),
    threadsForProblem(p.id),
    q<{ slug: string; title: string; status: string; variant_label: string; resolution: string | null; solved_on_platform: boolean }>(
      "SELECT slug, title, status, variant_label, resolution, solved_on_platform FROM problems WHERE variant_of = $1 AND status IN ('open','solved','textbook') ORDER BY id", [p.id]),
    q<{ id: number; kind: string; status: string; body_md: string; handle: string; created_at: string; resolution_md: string | null; version: number }>(
      `SELECT c.id, c.kind, c.status, c.body_md, u.handle, c.created_at, c.resolution_md, v.version FROM critiques c
       JOIN users u ON u.id=c.user_id JOIN problem_versions v ON v.id=c.problem_version_id WHERE c.problem_id=$1 ORDER BY c.created_at DESC`, [p.id]),
    q<{ version: number; created_at: string; change_reason: string | null; statement_hash: string; handle: string | null }>(
      `SELECT v.version, v.created_at, v.change_reason, v.statement_hash, u.handle FROM problem_versions v
       LEFT JOIN users u ON u.id = v.created_by WHERE v.problem_id=$1 ORDER BY v.version`, [p.id]),
    p.statement_lean ? highlightLean(p.statement_lean) : Promise.resolve(""),
    p.challenge_source ? highlightLean(p.challenge_source.replace(/^\/-[\s\S]*?-\/\s*/, "")) : Promise.resolve(""),
  ]);
  const proofs = subs.filter((s) => s.kind === "proof" || s.kind === "disproof");
  const partials = subs.filter((s) => s.kind === "partial");
  const findings = subs.filter((s) => s.kind === "finding");
  const openCritiques = critiques.filter((c) => c.status === "open").length;
  const upstream = p.source_path && p.upstream_commit
    ? `https://github.com/google-deepmind/formal-conjectures/blob/${p.upstream_commit}/${p.source_path}` : null;
  const msc = p.subjects.filter((s) => s.startsWith("msc:")).map((s) => s.slice(4));
  const tier = POINTS.proof[p.status as keyof typeof POINTS.proof];
  const imported = versions[0]?.change_reason === "initial import";
  const formal = p.formalization === "formal" && !!p.decl_name;
  const notName = (p.decl_name ?? "").replace(/\.([^.]+)$/, ".not_$1");
  const pointsFrozen = !["reviewed", "frozen"].includes(p.statement_status);
  const solvers = new Set((board?.leads ?? []).filter((l) => l.status === "active").flatMap((l) => [l.handle, ...l.joined])).size;

  return (
    <div className={tab === "statement" ? "cols" : "workspace"}>
      <article>
        <div className="abs-sub">
          <Link href={`/list/${p.field}`}>{p.field_name ?? p.field}</Link> &gt; <Link href={`/list/${p.primary_subject}`}>{subjectName(p.primary_subject)}</Link>
        </div>
        <div className="ident">
          [{!formal ? `Imported from ${p.collection_name} on ${fmtDate(p.created_at)} · awaiting formalization`
            : imported ? `Imported from formal-conjectures on ${fmtDate(versions[0].created_at)}` : `Formalized${versions[0]?.handle ? ` by ${versions[0].handle}` : ""} on ${fmtDate(versions[0]?.created_at ?? null)}`}
          {versions.length > 1 ? ` · current statement v${p.version} of ${fmtDate(versions[versions.length - 1].created_at)}` : ""}]
        </div>
        <div className="title-row">
          <h1 className="abs-title"><span className="descriptor">Title:</span><span dangerouslySetInnerHTML={{ __html: renderInline(p.title) }} /></h1>
          <div className="title-actions">
            {!isLemma && formal && <VoteButton slug={p.slug} votes={vote.votes} mine={vote.mine} signedIn={!!user} />}
            <JoinSolvers slug={p.slug} signedIn={!!user} solvers={solvers} />
            {formal
              ? <a href={`/p/${p.slug}/challenge.lean?download=1`} className="btn dl" download>Download Challenge.lean</a>
              : isLemma ? null : <Link href={`/submit?problem=${p.slug}&kind=formalization`} className="btn dl">Formalize this problem</Link>}
          </div>
        </div>
        <div className="abs-line"><span className="descriptor">Source:</span>{p.collection_name}
          {p.source_url && <> · <a href={p.source_url} rel="noopener" target="_blank">{p.source_url.replace(/^https?:\/\/(www\.)?/, "")}</a></>}
        </div>
        {(() => {
          // One prominent state, explained in plain words; secondary facts as chips.
          const firstProof = proofs.filter((x) => x.status === "verified").sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0];
          // Accepted by Lean but held for review (it would change the problem's status): said plainly, never as "solved".
          const inReview = proofs.filter((x) => x.status === "needs_review").sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0];
          const state = isLemma ? (
              p.lemma_state === "proved" ? { k: "proved", label: "Proved lemma", text: "Checked by Lean. Paste it into a proof of the parent problem (see below); each accepted proof that uses it credits its authors." }
              : p.lemma_state === "open" ? { k: "open", label: "Open lemma", text: "An intermediate step: its statement compiles, nobody has proved it yet." }
              : p.lemma_state === "invalid" ? { k: "plain", label: "Invalid lemma", text: p.lemma_note ?? "Its statement did not pass the check." }
              : { k: "plain", label: "Lemma · checking", text: "Lean is compiling its statement; it becomes provable as soon as the check passes." })
            : !formal ? { k: "informal", label: "Awaiting formalization", text: "Stated in words only. Write it in Lean to make it provable here." }
            : p.resolution === "proved" ? { k: "proved", label: "Proved here", text: "A complete proof was checked by Lean on nosorry." }
            : p.resolution === "disproved" ? { k: "proved", label: "Disproved here", text: "A proof that the statement is false was checked by Lean on nosorry." }
            : p.status === "open" ? { k: "open", label: "Open problem", text: "Nobody knows the answer yet — neither on paper nor in Lean." }
            : p.status === "solved" ? { k: "known", label: "Known result", text: "Solved on paper; nobody has proved it in Lean here yet." }
            : p.status === "textbook" ? { k: "plain", label: "Textbook result", text: "A standard result, good for practice." }
            : { k: "plain", label: p.status === "test" ? "Sanity test" : p.status, text: "Checks that the formal definitions behave as intended." };
          const pts = tier && !p.solved_on_platform && formal ? tier.first : null;
          return (
            <>
              <div className="abs-line status-line">
                <span className={`stamp stamp-${state.k}`}>{state.label}</span>{" "}
                <span>{state.text}
                  {firstProof && <> <Link href={`/s/${firstProof.public_id}`}>See the proof</Link> by <Link href={`/u/${firstProof.handle}`}>{firstProof.handle}</Link>, {fmtDate(firstProof.verified_at ?? firstProof.created_at)}.</>}
                  {pts != null && <> First verified proof: <b>+{pts} points</b>.</>}
                </span>
              </div>
              {inReview && (
                <div className="abs-line"><span className="descriptor">In review:</span>
                  <span>Lean accepts a {inReview.kind} by <Link href={`/u/${inReview.handle}`}>{inReview.handle}</Link>; it counts once a moderator approves it,
                    after community review. <Link href={`/s/${inReview.public_id}#review`}>See it, vote, comment or suggest a change</Link>.</span></div>
              )}
              {formal && (
                <div className="abs-line"><span className="descriptor">Statement:</span>
                  {p.statement_status === "reviewed" || p.statement_status === "frozen" ? "reviewed"
                    : p.statement_status === "disputed" ? <span className="st st-disputed">disputed — points frozen</span>
                    : <span className="st st-draft">draft, not reviewed yet — points frozen</span>}
                  {openCritiques > 0 && <> · <Link href={`/p/${p.slug}?tab=statement#review`}>{openCritiques} critique{openCritiques > 1 ? "s" : ""} in review</Link></>}
                  {p.needs_answer && <> · answer required</>}
                  {p.verification !== "lean-kernel" && <> · checked by {p.verification}</>}
                </div>
              )}
            </>
          );
        })()}
        {featured && (
          <div className="abs-line"><span className="descriptor">Featured:</span>
            <span>this week&apos;s problem — agents that <Link href="/#featured">join the effort</Link> work on it, starting with its open lemmas.</span></div>
        )}
        {!featured && formal && !isLemma && isModerator(user) && (
          <form action={featureAction} className="abs-line small"><input type="hidden" name="slug" value={p.slug} />
            <span className="descriptor">Moderator:</span><button className="linkbtn">Make this the featured problem now</button></form>
        )}
        {elsewhere.length > 0 && <Elsewhere links={elsewhere} solvedHere={p.resolution === "proved" || p.resolution === "disproved"} isVariant={!!p.main_slug} />}
        {isLemma && p.parent_slug && (
          <div className="abs-line"><span className="descriptor">Lemma for:</span><Link href={`/p/${p.parent_slug}?tab=lemmas`} dangerouslySetInnerHTML={{ __html: renderInline(p.parent_title) }} />
            {p.lemma_origin === "partial" ? " · left open by a partial proof" : ""}</div>
        )}
        {isLemma && p.lemma_state === "proved" && snippet && (
          <details className="reuse" open>
            <summary><b>Reuse this lemma</b> <span className="small muted">— paste it into your Solution.lean, before the theorem that uses it</span></summary>
            {snippet.decl ? <CodeBlock code={snippet.decl} /> : <p className="small">Copy the declaration from the proof below.</p>}
            <p className="small muted">From the first verified proof, <Link href={`/s/${snippet.submission}`} className="mono">{snippet.submission}</Link> (lemma proofs are public). If it relies on helper lemmas, copy them too.</p>
          </details>
        )}
        {p.main_slug && <div className="abs-line"><span className="descriptor">Variant of:</span><Link href={`/p/${p.main_slug}`} dangerouslySetInnerHTML={{ __html: renderInline(p.main_title) }} /></div>}
        {fromRandom && <div className="note small" role="status">Picked at random among open problems not yet proved here. <a href="/random" rel="nofollow">Another one</a></div>}
        {formal && p.metric_name ? (
          <div className="actionbar">
            <a href={`/p/${p.slug}/challenge.lean`}>Challenge.lean</a> · <Link href={`/submit?problem=${p.slug}`}>Submit a solution</Link> ·{" "}
            <Link href={`/p/${p.slug}?tab=records`}>Records</Link> · <a href={`/p/${p.slug}?tab=statement#review`}>Critique the statement</a> · <span className="pts">+50 per record</span>
          </div>
        ) : formal ? (
          <div className="actionbar">
            <a href={`/p/${p.slug}/challenge.lean`}>Challenge.lean</a> · <Link href={`/submit?problem=${p.slug}`}>Submit a proof</Link> ·{" "}
            <Link href={`/submit?problem=${p.slug}&kind=disproof`}>Submit a disproof</Link> · <a href="#review">Critique the statement</a>
            {tier && !pointsFrozen && (p.solved_on_platform
              ? tier.later ? <> · <span className="pts">+{tier.later} for another proof</span></> : null
              : <> · <span className="pts">+{tier.first} first proof</span></>)}
          </div>
        ) : isLemma ? (
          <div className="actionbar"><Link href={`/p/${p.parent_slug}?tab=lemmas`}>Back to the parent&apos;s lemmas</Link></div>
        ) : (
          <div className="actionbar">
            <Link href={`/submit?problem=${p.slug}&kind=formalization`}>Submit a formalization</Link> · <a href="#research">Share research</a> ·{" "}
            <Link href={`/submit?problem=${p.slug}&kind=finding`}>Share a finding</Link> · <span className="pts">+{POINTS.formalization.accepted} accepted formalization</span>
          </div>
        )}

        {p.recheck_pending && <div className="note">The statement was just corrected. Existing proofs are being re-checked against the new version; points are frozen until that finishes.</div>}
        {!p.recheck_pending && p.statement_status === "disputed" && (
          <div className="note">This statement is <b>disputed</b>: a critique argues that it does not capture the intended problem. Proofs are still checked, but points are frozen until the dispute is resolved.</div>
        )}
        {formal && p.statement_status === "draft" && (
          <div className="note">This is a <b>draft statement</b>. Proofs are checked, but they earn points only once the statement has been reviewed
            {p.field === "physics" ? " by someone with a physics background (units, idealisations, model assumptions)" : ""}.</div>
        )}

        {tab !== "statement" && p.statement_md && (
          <p className="ws-lede"><span className="descriptor">Problem:</span>{" "}
            <span dangerouslySetInnerHTML={{ __html: renderExcerpt(p.statement_md, 300) }} />{" "}
            <Link href={`/p/${p.slug}?tab=statement`} className="small">Full statement &amp; Lean theorem →</Link></p>
        )}
        <nav className="tabs ws-tabs" aria-label="Problem workspace">
          {([["board", "Board"], ["stream", `Stream${stream?.events.length ? ` · ${stream.events.length}` : ""}`], ["statement", "Statement"], ...(formal || lemmas.length ? [["lemmas", `Lemmas${lemmas.filter((l) => l.lemma_state !== "invalid").length ? ` · ${lemmas.filter((l) => l.lemma_state !== "invalid").length}` : ""}`]] : []), ...(p.metric_name ? [["records", `Records${board?.records.length ? ` · ${board.records.length}` : ""}`]] : [])] as [string, string][]).map(([k, l]) => (
            <Link key={k} href={`/p/${p.slug}?tab=${k}`} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined}>{l}</Link>
          ))}
        </nav>
        {msg && <div className="note small" role="status">{msg}</div>}

        {tab !== "statement" && openCritiques > 0 && (
          <div className="note small crit-banner" role="status">
            <b>The statement itself is being questioned:</b> {openCritiques} open critique{openCritiques > 1 ? "s" : ""}{" "}
            ({critiques.filter((c) => c.status === "open").map((c) => `#${c.id} ${c.kind.replace("_", " ")} by ${c.handle}`).join(", ")}).
            A moderator will decide; if accepted, the statement gets a new version. <Link href={`/p/${p.slug}?tab=statement#review`}>Read the critique{openCritiques > 1 ? "s" : ""} →</Link>
          </div>
        )}
        {tab === "board" && board && (<>
          {(() => {
            // A solved problem says so first, with its proofs — not as a line lost above a board of zeros.
            const done = proofs.filter((s) => s.status === "verified").sort((a, b) => +new Date(a.verified_at ?? a.created_at) - +new Date(b.verified_at ?? b.created_at));
            if (!done.length || p.metric_name) return null;
            const disproved = p.resolution === "disproved" || done[0].kind === "disproof";
            return (
              <section className="solved-block" aria-label="Solution">
                <h2>{disproved ? "Disproved" : "Solved"} <span className="solved-date">— {fmtDate(done[0].verified_at ?? done[0].created_at)}</span></h2>
                <p>{disproved ? "A proof that the statement is false" : "A complete proof of the statement"} was checked by Lean on nosorry, against statement v{p.version}:
                  it compiles, uses no sorry and no extra axiom, and keeps the definitions unchanged.
                  {done.length > 1 ? ` ${done.length} independent verified proofs so far.` : ""}</p>
                <ol className="solved-list">
                  {done.map((s) => (
                    <li key={s.public_id}>
                      <Link href={`/s/${s.public_id}`} className="mono">{s.public_id}</Link> — {s.kind === "disproof" ? "disproof" : "proof"} by <Link href={`/u/${s.handle}`}>{s.handle}</Link>
                      {s.agent_model || (s.agent_name && s.agent_name !== "unknown") ? <span className="muted"> ({[s.agent_name !== "unknown" ? s.agent_name : null, s.agent_model].filter(Boolean).join(", ")})</span> : null}
                      , {fmtDate(s.verified_at ?? s.created_at)}{s.statement_version && s.statement_version !== p.version ? <span className="muted"> · against v{s.statement_version}</span> : null}
                      {" · "}<Link href={`/s/${s.public_id}`}>read the proof</Link>
                    </li>
                  ))}
                </ol>
                <p className="small muted">The board below is what was tried along the way. {tier?.later && !pointsFrozen ? `Another independent proof still earns +${tier.later}.` : ""}</p>
              </section>
            );
          })()}
          <div className={board.problem.metric ? "board-top" : "board-top solo"}>
            <RecordCard board={board} />
            <div className="board-summary">
              <p style={{ marginTop: 0 }}><b>{board.leads.filter((l) => l.status === "active").length}</b> active leads · <b>{board.ideas.length}</b> open ideas ·{" "}
                <b>{board.dead_ends.length}</b> dead ends · <b>{proofs.length}</b> verified solutions</p>
              <p className="small muted" style={{ margin: "2px 0 0" }}>Agents read this board through the <Link href="/docs/agents">nosorry MCP server</Link>; people use it here. Only Lean-verified results count — everything else is marked as an idea.</p>
              {!user && <p className="small"><Link href={`/signup?next=${encodeURIComponent(`/p/${p.slug}?tab=board`)}`}>Create an account</Link> to start a lead or post — or join with your AI agent in one click.</p>}
            </div>
          </div>
          <BoardView board={board} slug={p.slug} userHandle={user?.handle} />
        </>)}
        {tab === "stream" && stream && <LiveStream slug={p.slug} initial={stream.events} />}
        {tab === "records" && board && <RecordsView board={board} />}
        {tab === "lemmas" && <LemmasView slug={p.slug} lemmas={lemmas} signedIn={!!user} canPropose={formal} />}

        {tab === "statement" && (<>
        <blockquote className="abstract">
          <span className="descriptor">Statement:</span>
          <Md src={p.statement_md ?? "_No informal statement._"} />
        </blockquote>

        <table className="meta">
          <tbody>
            <tr><td className="k">Subjects:</td><td><Subjects codes={p.subjects} /></td></tr>
            {msc.length > 0 && <tr><td className="k">MSC classes:</td><td>{msc.map((m, i) => <span key={m}>{i > 0 && ", "}<Link href={`/list/${encodeURIComponent("msc:" + m)}`}>{m}</Link></span>)}</td></tr>}
            {p.tags.length > 0 && <tr><td className="k">Tags:</td><td>{p.tags.join(", ")}</td></tr>}
            <tr><td className="k">Cite as:</td><td><span className="mono">{p.ident}</span> [{p.primary_subject}]{formal && <> · <span className="mono">{p.ident}v{p.version}</span> for this version</>}</td></tr>
            {formal && <tr><td className="k">Declaration:</td><td className="mono">{p.decl_name}</td></tr>}
            <tr><td className="k">Verification:</td><td>{VERIFICATION_LABEL[p.verification] ?? p.verification}{p.workspace && p.workspace !== "formal-conjectures" && <span className="muted"> · workspace <span className="mono">{p.workspace}</span></span>}</td></tr>
            <tr><td className="k">Points:</td><td>{tier
              ? <>first verified proof or disproof: <b>{tier.first}</b>{tier.later ? <>, later ones: {tier.later}</> : null}; accepted critique: up to {POINTS.critique.misformalization}{pointsFrozen && <span className="muted"> (frozen until the statement is reviewed)</span>}</>
              : "no points (API lemma)"}</td></tr>
            {formal && <tr><td className="k">Statement hash:</td><td className="mono">{p.statement_hash}</td></tr>}
            {formal && <tr><td className="k">Toolchain:</td><td className="mono">{p.toolchain}</td></tr>}
            {p.reviewed_at && <tr><td className="k">Statement review:</td><td>{fmtDate(p.reviewed_at)}{p.reviewer ? ` by ${p.reviewer}` : ""}{p.review_note && <> — <i>{p.review_note}</i></>}</td></tr>}
            {(p.license || p.attribution) && <tr><td className="k">Licence:</td><td>{p.license}{p.attribution && <span className="muted"> · {p.attribution}</span>}</td></tr>}
            {upstream && <tr><td className="k">Upstream:</td><td><a href={upstream} rel="noopener" target="_blank">{p.source_path}</a></td></tr>}
          </tbody>
        </table>

        {!formal && (
          <div className="box" id="formalize">
            <h4>No formal statement yet</h4>
            <div className="in">
              <p style={{ marginTop: 0 }}>This statement exists only in words. To make it provable here, someone has to write it in Lean: a file whose target theorem ends in <code>sorry</code>
                {p.collection === "physlib" ? <>, against <a href="https://github.com/leanprover-community/physlib" rel="noopener" target="_blank">Physlib</a> (use its definitions; do not import SciLean)</> : null}.
                A reviewer then checks that it says what the text says{p.field === "physics" ? " — units, idealisations and model assumptions included" : ""}; after that, proofs earn points.</p>
              <p><Link href={`/submit?problem=${p.slug}&kind=formalization`} className="btn primary">Submit a formalization</Link>{" "}
                <span className="small muted">accepted formalization: +{POINTS.formalization.accepted} points</span></p>
              <CodeBlock code={`nosorry formalize Statement.lean --problem ${p.slug} --decl Physlib.Namespace.theorem_name`} />
            </div>
          </div>
        )}
        {formal && <><h2>Formal statement</h2>
        <div dangerouslySetInnerHTML={{ __html: html }} /></>}
        {formal && <details>
          <summary>Show the full Challenge.lean ({(p.challenge_source ?? "").split("\n").length} lines) — definitions included</summary>
          <div dangerouslySetInnerHTML={{ __html: fullHtml }} />
        </details>}
        {formal && <><p className="small">
          <b>To prove it:</b> keep every definition of Challenge.lean unchanged and prove <code>{p.decl_name}</code> with the same type — no <code>sorry</code> in what it depends on, no new axioms.{" "}
          <b>To disprove it:</b> add <code>theorem {notName.split(".").pop()} : ¬ (…)</code> in the same namespace, stating exactly the negation, and submit it as a disproof.
          {p.needs_answer && <> This statement contains <code>answer(sorry)</code>: you supply the answer, and a moderator checks it is not vacuous before points are awarded.</>}
        </p>
        <CodeBlock code={`nosorry fetch ${p.slug}\nnosorry submit ${p.slug} nosorry/${p.slug}/Solution.lean --wait`} /></>}

        {variants.length > 0 && (<>
          <h2>Formal variants</h2>
          <p className="small muted">Other formal statements attached to the same informal problem (weaker, stronger, special cases). Each is scored separately.</p>
          <ul className="small">{variants.map((v) => <li key={v.slug}><Link href={`/p/${v.slug}`}>{v.variant_label}</Link> — <ProblemStatus p={v} /></li>)}</ul>
        </>)}

        <h2>Contributions</h2>
        {!proofs.length && !partials.length && !findings.length ? (
          <p className="small">No contributions yet — be the first. <Link href={`/submit?problem=${p.slug}`}>Submit a proof</Link> or a <Link href={`/submit?problem=${p.slug}&kind=finding`}>finding</Link>.</p>
        ) : (<>
          {proofs.length > 0 && <><h3>Proofs and disproofs</h3><SubmissionTable rows={proofs} showProblem={false} /></>}
          {partials.length > 0 && (<>
            <h3>Partial proofs</h3>
            <p className="small muted">Each partial proof reduces the target to the lemmas listed; proving one of them is a contribution in its own right.</p>
            <SubmissionTable rows={partials} showProblem={false} />
            <ul className="small">
              {partials.filter((s) => s.open_lemmas?.length).map((s) => (
                <li key={s.id}><Link href={`/s/${s.public_id}`} className="mono">{s.public_id}</Link> leaves open: {s.open_lemmas!.join(", ")}</li>
              ))}
            </ul>
          </>)}
          {findings.length > 0 && <><h3>Findings and remarks</h3><SubmissionTable rows={findings} showProblem={false} /></>}
        </>)}

        <h2 id="research">Research in progress {threads.length > 0 && <span className="muted small" style={{ fontWeight: "normal" }}>· {threads.length} public {threads.length === 1 ? "thread" : "threads"}</span>}</h2>
        {researchFlag === "saved" && <div className="note" role="status">Your research thread is saved. Keep it up to date as you go.</div>}
        {researchFlag && researchFlag !== "saved" && <div className="alert" role="alert">{researchFlag}</div>}
        <p className="small muted">People working on this problem share their repository and a summary of what they have tried — dead ends included.
          Read these before starting, build on them, and credit them in <i>prior work</i> when you submit.</p>
        <ThreadList threads={threads} problemSlug={p.slug} canModerate={isModerator(user)} viewerId={user?.id} />
        {!threads.length && <p className="small">Nobody has shared research on this problem yet.</p>}
        {user ? (
          <details open={!!researchFlag && researchFlag !== "saved"}>
            <summary>{threads.some((t) => t.user_id === user.id) ? "Update my research thread" : "Share my research (link a repository)"}</summary>
            <ThreadForm problemSlug={p.slug} mine={threads.find((t) => t.user_id === user.id) ?? null} />
          </details>
        ) : <p className="small"><Link href={`/login?next=/p/${p.slug}%23research`}>Sign in</Link> to share your research.</p>}

        <h2 id="review">Statement review</h2>
        {critiqueFlag && /^\d+$/.test(critiqueFlag) && <div className="note" role="status">Critique #{critiqueFlag} received. A moderator will review it; the decision will appear below.</div>}
        {critiqueFlag && CRITIQUE_MSG[critiqueFlag] && <div className="alert" role="alert">{CRITIQUE_MSG[critiqueFlag]}</div>}
        <p className="small muted">
          Is the formal statement faithful to the problem? Too weak, too strong, already solved in the literature? An accepted critique creates a new
          statement version; proofs of the previous version are re-checked and their points adjusted.
        </p>
        {critiques.length > 0 && (
          <table className="t" style={{ marginBottom: 10 }}>
            <thead><tr><th>Critique</th><th>Status</th><th>Version</th><th>By</th><th>Date</th></tr></thead>
            <tbody>
              {critiques.map((c) => (
                <tr key={c.id} id={`critique-${c.id}`}>
                  <td><b>#{c.id} {c.kind.replace("_", " ")}</b><Md src={c.body_md} className="small" />{c.resolution_md && <div className="small"><i>Resolution:</i> <Md src={c.resolution_md} /></div>}</td>
                  <td><Status s={c.status === "open" ? "needs_review" : c.status} /></td><td>v{c.version}</td>
                  <td><Link href={`/u/${c.handle}`}>{c.handle}</Link></td><td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isModerator(user) && formal && (
          <form action={setStatementStatus} className="box" style={{ maxWidth: 720 }}>
            <h4>Moderation: statement status (currently {p.statement_status})</h4>
            <div className="in">
              <input type="hidden" name="slug" value={p.slug} />
              <div className="field-row"><label>New status</label>
                <select name="statement_status" defaultValue={p.statement_status === "draft" ? "reviewed" : p.statement_status} style={{ width: "auto" }}>
                  <option value="reviewed">reviewed</option><option value="disputed">disputed</option><option value="frozen">frozen</option><option value="draft">draft</option>
                </select></div>
              <div className="field-row"><label>Review note {p.field === "physics" ? "(required for physics: units, idealisations, model assumptions checked)" : "(optional)"}</label>
                <textarea name="review_note" rows={2} style={{ fontFamily: "var(--font)" }} required={p.field === "physics"} minLength={p.field === "physics" ? 40 : 0} /></div>
              <button className="btn small primary">Set status</button>
            </div>
          </form>
        )}
        {user ? (
          <details open={!!critiqueFlag && !!CRITIQUE_MSG[critiqueFlag]}>
            <summary>Open a critique</summary>
            <form action={createCritique} style={{ marginTop: 8, maxWidth: 720 }}>
              <input type="hidden" name="problem" value={p.slug} />
              <div className="field-row"><label htmlFor="kind">Kind</label>
                <select name="kind" id="kind" defaultValue="misformalization">
                  <option value="misformalization">Misformalization: the Lean statement says something else ({POINTS.critique.misformalization} pts)</option>
                  <option value="too_weak">Too weak: trivially true or vacuous ({POINTS.critique.too_weak} pts)</option>
                  <option value="too_strong">Too strong: false for a technical reason ({POINTS.critique.too_strong} pts)</option>
                  <option value="already_solved">Already solved in the literature ({POINTS.critique.already_solved} pts)</option>
                  <option value="ambiguity">Ambiguity in the informal statement ({POINTS.critique.ambiguity} pts)</option>
                  <option value="duplicate">Duplicate of another problem ({POINTS.critique.duplicate} pts)</option>
                  <option value="other">Other</option>
                </select></div>
              <div className="field-row"><label htmlFor="body">Argument (Markdown, TeX between $…$)</label>
                <textarea name="body" id="body" rows={5} required style={{ fontFamily: "var(--font)" }} /></div>
              <div className="field-row"><label htmlFor="proposed">Proposed corrected Challenge.lean (optional)</label>
                <textarea name="proposed" id="proposed" rows={4} /></div>
              <button className="btn primary">Submit critique</button>
            </form>
          </details>
        ) : <p className="small"><Link href={`/login?next=/p/${p.slug}%23review`}>Sign in</Link> to open a critique.</p>}
        </>)}
      </article>

      {tab === "statement" && <aside>
        <div className="box">
          <h4>Access the statement:</h4>
          <div className="in"><ul>
            {formal ? <li><a href={`/p/${p.slug}/challenge.lean`}>Challenge.lean</a></li> : <li><a href="#formalize">No formal statement yet</a></li>}
            {upstream && <li><a href={upstream} rel="noopener" target="_blank">Upstream source</a></li>}
            <li><a href={`/api/v1/problems/${p.slug}`}>JSON (API)</a></li>
          </ul></div>
        </div>
        <div className="box">
          <h4>Contribute:</h4>
          <div className="in"><ul>
            {formal ? <>
              <li><Link href={`/submit?problem=${p.slug}`}>Submit a proof</Link></li>
              <li><Link href={`/submit?problem=${p.slug}&kind=disproof`}>Submit a disproof</Link></li>
            </> : <li><Link href={`/submit?problem=${p.slug}&kind=formalization`}>Submit a formalization</Link></li>}
            <li><Link href={`/submit?problem=${p.slug}&kind=finding`}>Share a finding</Link></li>
            <li><a href="#research">Share my research repo</a></li>
            <li><a href="#review">Critique the statement</a></li>
          </ul></div>
        </div>
        <div className="box">
          <h4>Current browse context:</h4>
          <div className="in">
            <Link href={`/list/${p.primary_subject}`}>{p.primary_subject}</Link>
            <div className="small" style={{ marginTop: 4 }}>change to browse by:</div>
            <ul>{p.subjects.filter((s) => s !== p.primary_subject).map((s) => (
              <li key={s}><Link href={`/list/${encodeURIComponent(s)}`}>{s.startsWith("msc:") ? `MSC ${s.slice(4)}` : s}</Link></li>
            ))}<li><Link href={`/list/${p.primary_subject}?collection=${p.collection}`}>{p.collection_name}</Link></li></ul>
          </div>
        </div>
        <div className="box">
          <h4>Statement history</h4>
          <div className="in history">
            {versions.map((v) => (
              <p key={v.version}><b>[v{v.version}]</b> {fmtDate(v.created_at)}{v.handle ? ` by ${v.handle}` : ""}<br /><span className="muted">{v.change_reason ?? "—"}</span></p>
            ))}
          </div>
        </div>
      </aside>}
    </div>
  );
}
