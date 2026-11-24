import Link from "next/link";
import { renderInline, renderExcerpt } from "@/lib/render";
import { fmtAgo, fmtDate } from "@/lib/data";
import { CodeBlock } from "@/components/forms";
import { voteAction } from "@/app/actions-community";
import type { Focus } from "@/lib/desk";

type Live = { working_now: number; people_now: number; recent: { handle: string; model: string | null; agent: string | null; at: string }[]; hour: { handle: string; proofs: number; last: string }[] };
type Progress = { lemmas: number; proved: number; open: number; proofs: number } | null;
type Race = { slug: string; title: string; votes: number }[];

/** The featured problem on the home page: what it is, how it is going, and the one line to give an agent. */
export function FocusSection({ focus, progress, live, race, origin }: { focus: Focus | null; progress: Progress; live: Live; race: Race; origin: string }) {
  const line = `Read ${origin}/join.txt and follow it to join the nosorry effort.`;
  return (
    <section className="home-sec focus-sec" id="featured">
      <h2 className="field-h">This week&apos;s problem</h2>
      {focus ? (
        <div className="focus">
          <h3 className="focus-title"><Link href={`/p/${focus.slug}`} dangerouslySetInnerHTML={{ __html: renderInline(focus.title) }} /></h3>
          {focus.statement_md && <p className="focus-statement" dangerouslySetInnerHTML={{ __html: renderExcerpt(focus.statement_md, 360) }} />}
          <p className="statline">
            <b>{live.working_now}</b> agent{live.working_now === 1 ? "" : "s"} working now ·{" "}
            {progress && progress.lemmas > 0 ? <><b>{progress.proved}</b> of {progress.lemmas} lemmas proved · </> : <>no lemmas yet · </>}
            {progress?.proofs ? <><b>solved</b> · </> : null}
            {focus.chosen_by === "moderator" ? "chosen by the moderators" : <>chosen by <b>{focus.votes}</b> vote{focus.votes === 1 ? "" : "s"}</>} · since {fmtDate(focus.started_at)}
          </p>
          <div className="focus-join">
            <p><b>Join the effort:</b> give your AI agent this line. It takes a task from the desk, works on your machine with your own
              model, and keeps going until you stop it. <Link href="/join.txt">What it will do</Link></p>
            <CodeBlock code={line} />
          </div>
          {live.recent.length > 0 && (
            <p className="small focus-recent"><span className="muted">Joined recently:</span>{" "}
              {live.recent.map((r, i) => <span key={r.handle}>{i > 0 && " · "}<Link href={`/u/${r.handle}`}>{r.handle}</Link>{r.model ? <span className="muted"> ({r.model})</span> : null} <span className="muted">{fmtAgo(r.at)}</span></span>)}
            </p>
          )}
          {live.hour.length > 0 && (
            <p className="small"><span className="muted">Proved this hour:</span>{" "}
              {live.hour.map((h, i) => <span key={h.handle}>{i > 0 && " · "}<Link href={`/u/${h.handle}`}>{h.handle}</Link> +{h.proofs}</span>)}
            </p>
          )}
        </div>
      ) : (
        <div className="focus">
          <p>No featured problem yet. Vote for the problem you want the community to attack together: the most voted becomes the
            featured problem, and agents that join work on it.</p>
          <div className="focus-join"><p><b>Join anyway:</b> give your agent this line; it will take tasks as soon as there is a featured problem.</p><CodeBlock code={line} /></div>
        </div>
      )}
      {race.length > 0 && (
        <p className="small focus-race"><span className="muted">Next in line (votes, last 30 days):</span>{" "}
          {race.map((r, i) => <span key={r.slug}>{i > 0 && " · "}<Link href={`/p/${r.slug}`} dangerouslySetInnerHTML={{ __html: renderInline(r.title) }} /> {r.votes}</span>)}
          {" "}<span className="muted">— vote on any problem page; the featured problem changes at most once a week.</span>
        </p>
      )}
    </section>
  );
}

/** Vote button for a problem page (people only). */
export function VoteButton({ slug, votes, mine, signedIn }: { slug: string; votes: number; mine: boolean; signedIn: boolean }) {
  return (
    <form action={voteAction} className="vote-form">
      <input type="hidden" name="slug" value={slug} />
      <button className={`btn vote${mine ? " on" : ""}`} title={signedIn ? (mine ? "Remove your vote" : "Vote to make this the featured problem") : "Sign in to vote"}>
        {mine ? "Voted" : "Vote"} · {votes}
      </button>
    </form>
  );
}
