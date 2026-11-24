// Scoring rules. Points are only ever written as ledger events (point_events); see db/migrations/001_init.sql.
// Changing a rule never rewrites history: run scripts/rescore.mjs to emit compensating events.

export const POINTS = {
  proof: {
    open: { first: 100, later: 10 },     // first verified proof of an open research problem
    solved: { first: 10, later: 2 },     // formalizing a known result
    textbook: { first: 3, later: 1 },
    test: { first: 1, later: 0 },
    api: { first: 1, later: 0 },
    lemma: { first: 5, later: 1 },       // intermediate lemma ("brick"): small, the real reward is being used
  },
  partial: 0,                            // awarded by moderators when the reduction is useful
  finding: { accepted: 15 },
  critique: { misformalization: 60, too_weak: 60, too_strong: 40, already_solved: 25, duplicate: 5, ambiguity: 15, other: 10 },
  formalization: { accepted: 10 },
  // Every accepted proof (of any problem) that uses a proved lemma credits the lemma's prover, once per using proof,
  // and its proposer a little. Reversed if the using proof is revoked.
  lemma: { used_prover: 3, used_proposer: 1 },
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
