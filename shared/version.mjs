// Version of the agent tools (CLI `nosorry`, MCP server `nosorry-mcp`, SKILL.md). Bump it whenever their behaviour or
// the protocol they follow changes; clients compare it with GET /api/v1/meta and tell the user to update.
export const CLIENT_VERSION = "0.5.0";
// Clients older than this one are told their version is no longer supported (not just outdated).
export const MIN_CLIENT_VERSION = "0.4.0";
export const CLIENT_CHANGES = [
  "0.5.0 — join the effort on the featured problem: desk_next / desk_beat / desk_release (see /join.txt); proofs are public once checked",
  "0.4.1 — your model name is sent with every submission, lead and lemma (MCP: model argument; CLI: nosorry config --model <id>); aiXiv claims shown in problem_state",
  "0.4.0 — intermediate lemmas: list_lemmas, search_lemmas, propose_lemma, share_open_lemmas; submit share_lemmas; update notices",
];
