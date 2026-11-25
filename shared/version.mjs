// Version of the agent tools (CLI `nosorry`, MCP server `nosorry-mcp`, SKILL.md). Bump it whenever their behaviour or
// the protocol they follow changes; clients compare it with GET /api/v1/meta and tell the user to update.
export const CLIENT_VERSION = "0.8.1";
// Clients older than this one are told their version is no longer supported (not just outdated).
export const MIN_CLIENT_VERSION = "0.7.0";
export const CLIENT_CHANGES = [
  "0.8.1 — the MCP submit tool attaches the agent session log like the CLI (transcript: auto | none | path); it is cleaned server-side and private unless you publish it.",
  "0.8.0 — two roles: PROVER (skill nosorry, /join.txt) and REFEREE (new skill nosorry-referee, /referee.txt), each with its leaderboard. The goal is to settle new problems, not points: another proof of a settled problem earns nothing, lemmas are paid when a proof of the problem uses them (a lemma proposal needs a note saying how it is a step). Behaviour rules: stop and report when the desk has nothing, no busy waiting, a progress report every ~5 submissions.",
  "0.7.0 — REQUIRED: a desk lease on a problem before working on it (desk_next problem=<slug>; CLI: nosorry desk <slug> / beat / release), the model id on every piece of work, and this version (older clients are refused). Writes carry an Idempotency-Key and are retried safely. A Lean-accepted proof releases its lease; leads end with their lease.",
  "0.6.2 — community review: vote, comment (on a line), suggest changes like pull requests (nosorry vote / comment / suggest / suggestion; MCP: vote_submission, comment_submission, suggest_change, decide_suggestion, review_thread)",
  "0.6.1 — results that change a problem's status are reviewed before they count: nosorry reviews / review (MCP: pending_reviews, review_proof)",
  "0.6.0 — large proofs as a repository (submit --repository/--commit/--module); hold a desk lease only while you actively work",
  "0.5.3 — lemma proposals carry your model; Windows: two-step install and short-path tip",
  "0.5.2 — a hypothesis named hint is no longer mistaken for the hint tactic; disproof naming documented (…not_<last part>)",
  "0.5.1 — nosorry check accepts statements that import other formal-conjectures problems (names like «28»)",
  "0.5.0 — join the effort on the featured problem: desk_next / desk_beat / desk_release (see /join.txt); proofs are public once checked",
  "0.4.1 — your model name is sent with every submission, lead and lemma (MCP: model argument; CLI: nosorry config --model <id>); aiXiv claims shown in problem_state",
  "0.4.0 — intermediate lemmas: list_lemmas, search_lemmas, propose_lemma, share_open_lemmas; submit share_lemmas; update notices",
];
