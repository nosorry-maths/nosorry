#!/usr/bin/env node
// Negative controls of the verifier: small submissions that MUST be rejected (a changed statement, an added axiom,
// a changed definition, sorry, native_decide, a fake score…) and one that must be accepted. Each runs the real
// pipeline: the static rules (shared/preflight.mjs), the Lean stages on the GitHub verifier (same workflow as
// production), then the verdict rules (shared/judge.mjs). Writes nothing to the database.
//
// A control passes when the verdict is the expected one. For the rejections, the report also says which layers
// caught it: the static rules AND the checker should both catch what they can (defence in depth), so a control
// caught only by the static rules is flagged.
//
//   node scripts/verifier-controls.mjs [--only name,name] [--parallel 3]
// Needs the GitHub verifier token (GITHUB_VERIFY_TOKEN or var/github-token.txt), like the worker.
import { preflight } from "../shared/preflight.mjs";
import { compareProblems, judgeMetric } from "../shared/judge.mjs";
import { runRemote } from "../worker/github-backend.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ONLY = arg("--only")?.split(",");
const PARALLEL = Number(arg("--parallel") ?? 3);

// A record race in miniature, in core Lean (no Mathlib: each run takes a few minutes, not twenty).
const CHALLENGE = `namespace NSControl

def double (n : Nat) : Nat := n + n

/-- The construction: fill this definition. -/
def answer : Nat := sorry

/-- The main target. -/
theorem correct : double answer = 6 := sorry

/-- The score: replace the hole by a number. Lower is better. -/
theorem metric_bound : answer ≤ sorry := sorry

end NSControl
`;
const TARGET = "NSControl.correct", METRIC = "NSControl.metric_bound";
const sol = (body) => `namespace NSControl\n\ndef double (n : Nat) : Nat := n + n\n\n${body}\n\nend NSControl\n`;
const GOOD_ANSWER = "def answer : Nat := 3";
const GOOD_CORRECT = "theorem correct : double answer = 6 := by decide";
const GOOD_METRIC = "theorem metric_bound : answer ≤ 3 := by decide";

const CONTROLS = [
  { name: "valid", expect: "accept", value: 3,
    why: "the reference solution: must be accepted with score 3",
    source: sol([GOOD_ANSWER, GOOD_CORRECT, GOOD_METRIC].join("\n\n")) },
  { name: "changed-statement", expect: "reject",
    why: "the target is weakened (a disjunction with True)",
    source: sol([GOOD_ANSWER, "theorem correct : double answer = 6 ∨ True := Or.inr trivial", GOOD_METRIC].join("\n\n")) },
  { name: "added-axiom", expect: "reject",
    why: "the proof uses a new axiom",
    source: sol([GOOD_ANSWER, "axiom cheat : ∀ n : Nat, double n = 6", "theorem correct : double answer = 6 := cheat answer", GOOD_METRIC].join("\n\n")) },
  { name: "changed-definition", expect: "reject",
    why: "a definition the statement depends on is changed",
    source: `namespace NSControl\n\ndef double (_ : Nat) : Nat := 6\n\n${GOOD_ANSWER}\n\ntheorem correct : double answer = 6 := rfl\n\n${GOOD_METRIC}\n\nend NSControl\n` },
  { name: "sorry", expect: "reject",
    why: "the target is still proved by sorry",
    source: sol([GOOD_ANSWER, "theorem correct : double answer = 6 := sorry", GOOD_METRIC].join("\n\n")) },
  { name: "native-decide", expect: "reject",
    why: "native_decide trusts the compiler (axiom Lean.ofReduceBool)",
    source: sol([GOOD_ANSWER, "theorem correct : double answer = 6 := by native_decide", GOOD_METRIC].join("\n\n")) },
  { name: "fake-score", expect: "reject",
    why: "the score is shown as 1 through a custom OfNat instance whose value is 3",
    source: sol([GOOD_ANSWER, GOOD_CORRECT, "def fakeOne : OfNat Nat 1 := ⟨3⟩", "theorem metric_bound : answer ≤ @OfNat.ofNat Nat 1 fakeOne := by decide"].join("\n\n")) },
  { name: "metric-sorry", expect: "reject",
    why: "the score theorem is not proved",
    source: sol([GOOD_ANSWER, GOOD_CORRECT, "theorem metric_bound : answer ≤ 1 := sorry"].join("\n\n")) },
];

/** The verdict of the production rules, layer by layer. */
async function runControl(c) {
  const layers = [];
  const pf = preflight(c.source, { kind: "proof", challenge: CHALLENGE });
  if (!pf.ok) layers.push(`static rules: ${pf.errors.map((e) => e.message).join("; ")}`);
  // Lean stages run even when the static rules reject, to see whether the checker would catch it too.
  const r = await runRemote({ jobId: `ctl-${c.name}`, kind: "proof", target: TARGET, metricDecl: METRIC, challenge: CHALLENGE, solution: c.source },
    (m) => console.log(`  [${c.name}] ${m}`));
  const st = r.stages ?? {};
  let value = null;
  if (!st.ref || st.ref.code !== 0) return { c, error: `the control challenge does not compile: ${st.ref?.out?.slice(-500)}` };
  if (st.sub?.code !== 0) layers.push("compilation: the submission does not compile");
  else {
    const parse = (s) => { try { return JSON.parse(s.out.trim().split("\n").pop()); } catch { return { error: "unreadable checker output" }; } };
    const j = st.compare ? parse(st.compare) : { error: "no checker run" };
    const p = j.error ? [j.error] : compareProblems(j, { kind: "proof" });
    if (p.length) layers.push(`checker: ${p.join("; ")}`);
    if (st.metric) {
      const m = judgeMetric(parse(st.metric), METRIC);
      if (!m.ok) layers.push(`metric: ${m.error}`); else value = m.value;
    } else layers.push("metric: not run");
    if (st.kernel && st.kernel.code !== 0) layers.push("kernel replay failed");
  }
  return { c, layers, value, run: r.run_url };
}

const todo = CONTROLS.filter((c) => !ONLY || ONLY.includes(c.name));
const results = [];
for (let i = 0; i < todo.length; i += PARALLEL) {
  results.push(...await Promise.all(todo.slice(i, i + PARALLEL).map((c) => runControl(c).catch((e) => ({ c, error: e.message })))));
}

let failed = 0;
console.log("");
for (const { c, layers, value, run, error } of results) {
  if (error) { failed++; console.log(`FAIL  ${c.name}: ${error}`); continue; }
  const rejected = layers.length > 0;
  const ok = c.expect === "accept" ? !rejected && value === c.value : rejected;
  if (!ok) failed++;
  const onlyStatic = rejected && layers.every((l) => l.startsWith("static rules"));
  console.log(`${ok ? "ok  " : "FAIL"}  ${c.name.padEnd(19)} expected ${c.expect}: ${c.why}`);
  if (c.expect === "accept") console.log(`        ${rejected ? "rejected: " + layers.join(" | ") : `accepted, score ${value}`}`);
  else for (const l of layers) console.log(`        caught by ${l.slice(0, 300)}`);
  if (onlyStatic) console.log("        note: only the static rules catch it — the checker alone would not");
  console.log(`        ${run}`);
}
console.log(failed ? `\n${failed} control(s) failed` : `\nall ${results.length} controls behave as expected`);
process.exit(failed ? 1 : 0);
