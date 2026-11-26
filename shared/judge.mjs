// Verdict rules on the checker's JSON (worker/lean/Compare.lean). Shared by the worker and by the negative controls
// (scripts/verifier-controls.mjs), so that the controls test exactly the rules used in production.

export const PERMITTED_AXIOMS = ["propext", "Classical.choice", "Quot.sound"];

/**
 * Problems with the target theorem of a submission, from the checker's output. Empty list = accepted.
 * @param {any} j checker output for the target
 * @param {{kind:string, needsAnswer?:boolean}} o
 * @returns {string[]}
 */
export function compareProblems(j, { kind, needsAnswer = false }) {
  const problems = [];
  if (!j.is_theorem) problems.push("target is not a theorem");
  if (!j.type_matches || !j.levels_match) problems.push(kind === "disproof"
    ? `${j.target} must have type ¬ (reference statement)` : "statement differs from the reference");
  if (j.has_sorry && kind !== "partial") problems.push(
    j.open_lemmas.length === 1 && j.open_lemmas[0] === j.target ? "the target theorem itself still uses sorry"
      : `the proof still depends on sorry (${j.open_lemmas.join(", ")}) — submit it as a partial proof instead`);
  if (j.definition_mismatches.length) problems.push(`declarations the statement depends on were changed or are missing: ${j.definition_mismatches.slice(0, 20).join(", ")}`);
  if (j.answer_filled && !needsAnswer) problems.push("the reference type contains sorry outside an answer(...) slot; report it as a critique");
  if (j.forbidden_axioms.length) problems.push(`non-standard axioms: ${j.forbidden_axioms.join(", ")}`);
  return problems;
}

/**
 * The score of a record race, from the checker's output for the metric theorem.
 * @returns {{ok:true, value:number} | {ok:false, error:string}}
 */
export function judgeMetric(j, metricDecl) {
  if (j.error) return { ok: false, error: j.error };
  if (!j.type_matches || j.definition_mismatches.length) return { ok: false, error: `${metricDecl} must keep the reference statement, with your value in place of the hole` };
  if (j.forbidden_axioms.length || j.has_sorry) return { ok: false, error: `${metricDecl} is not fully proved (sorry or extra axioms)` };
  if (j.answer_nats.length !== 1) return { ok: false, error: `${metricDecl}: expected exactly one natural-number literal in place of the hole, got ${JSON.stringify(j.answers)}` };
  return { ok: true, value: j.answer_nats[0] };
}
