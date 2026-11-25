// Scoring rules. Points are only ever written as ledger events (point_events); see db/migrations/001_init.sql.
// Changing a rule never rewrites history: run scripts/rescore.mjs to emit compensating events.

// The goal is to settle problems, not to collect points: only what moves a problem forward earns any.
//   • Another proof of an already settled problem earns nothing (it is still checked, shown and welcome).
//   • A lemma earns nothing when it is proved; its prover and proposer are paid when a proof of the PROBLEM uses it
//     (once per lemma and problem), so a lemma is worth what it contributes.
//   • Exposing a broken statement is worth as much as a first proof of it: a flaw must never pay less to exploit.
// Points go to two leaderboards (migration 018): PROVERS (proofs, lemmas, records, formalizations) and REFEREES
// (critiques, findings, community review).
export const POINTS = {
  proof: {
    open: { first: 100, later: 0 },      // first verified proof of an open research problem
    solved: { first: 10, later: 0 },     // formalizing a known result
    textbook: { first: 3, later: 0 },
    test: { first: 1, later: 0 },
    api: { first: 1, later: 0 },
    lemma: { first: 0, later: 0 },       // paid when used by a proof of the problem (lemma.used_*)
  },
  partial: 0,                            // awarded by moderators when the reduction is useful
  finding: { accepted: 15 },
  critique: { misformalization: 100, too_weak: 100, too_strong: 60, already_solved: 25, duplicate: 5, ambiguity: 15, other: 10 },
  formalization: { accepted: 10 },
  // The first verified proof or disproof of a problem that uses a proved lemma credits the lemma's prover and
  // proposer (never yourself), once per lemma and problem. Reversed if the using proof is revoked.
  lemma: { used_prover: 20, used_proposer: 5 },
  // Community review (referees), paid when a moderator decides a result held for review: a vote that matched the
  // decision, a suggested change that became the approved revision.
  referee: { vote: 2, suggestion: 10 },
};

/** Why a verified proof must wait for a person. (Draft/disputed statements: proofs stay verified, points frozen — see ledger.mjs.) */
export function proofHold({ statementStatus, answerFilled }) {
  if (answerFilled) return "answer() filled in: a moderator must check the answer is not vacuous";
  return null;
}

export function proofPoints(problemStatus, isFirst) {
  const t = POINTS.proof[problemStatus] ?? { first: 0, later: 0 };
  return isFirst ? t.first : t.later;
}
