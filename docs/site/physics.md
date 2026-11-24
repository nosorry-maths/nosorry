# Physics and other fields

Lean checks *mathematical* statements. Physics fits when the problem is a precise statement about a model — a Hilbert space, a Lagrangian, a metric — and that is what nosorry accepts. Whether the model describes the world is a matter for people, so physics statements get a stricter human review.

## What is here

| Source | What | Status on nosorry | Licence |
|---|---|---|---|
| [formal-conjectures](https://github.com/google-deepmind/formal-conjectures) · OpenQuantumProblems | open problems in quantum information (MUBs, entanglement, channels…), already formalized | [Quantum Information](/list/physics.quantum-info), provable now | Apache-2.0 |
| [Physlib](https://github.com/leanprover-community/physlib) (ex-PhysLean) · *informal lemmas* and "prove / show" TODOs | classical mechanics, relativity & cosmology, quantum mechanics, QFT, electromagnetism | [awaiting formalization](/list/physics?status=informal) | Apache-2.0 |
| LeanPhysBench / Lean4PHYS, PhysProver (PhysLeanData), FormalScience (FormalPhysics) | ~200–5,000 textbook-level physics exercises in Lean | **not imported**: the repositories publish no licence for their statements; we import only with an open licence or the authors' written permission | — |

## From words to a provable statement

Physlib statements arrive as text. To make one provable:

1. Open it (status *awaiting formalization*) and click **Formalize this problem**.
2. Write a Lean file against Physlib whose target theorem ends in `sorry`, using Physlib's own definitions. Submit it as a *formalization* of that problem (or `nosorry formalize Statement.lean --problem <slug> --decl Ns.name`).
3. The file is compiled; a moderator accepts it (+10 points). The problem now has a formal statement, in **draft**.
4. A reviewer with physics background checks the statement and writes a review note: **units and dimensions, idealisations (point masses, no friction…), boundary and initial conditions, signs and conventions, the domain of validity**. Only then does the statement become *reviewed* and proofs earn points.
5. A proof is then verified exactly like a mathematics proof, in a sandbox built from the pinned Physlib commit.

## Verification levels

Every problem declares how a solution is checked:

| Level | Meaning | Supported |
|---|---|---|
| `lean-kernel` | a Lean proof checked by the kernel (the full pipeline) | yes |
| `certificate` | an external solver result (SMT, dReal, SOS, interval arithmetic) — accepted **only** with a certificate replayed and checked in Lean | not yet |
| `cas` | a symbolic answer checked by a computer-algebra system — not a formal proof, shown as such | not yet |
| `numeric-tolerance` | a numeric answer within a tolerance — not a formal proof, shown as such | not yet |

Problems at an unsupported level accept findings only, so nothing uncertified is ever scored as a proof. A solver saying "sat", "unsat" or "δ-sat" is never enough on its own.

## Rules specific to physics

- **No SciLean.** It is a scientific-computing library that relies on axioms and `sorry` by design; importing it is refused. `PhyslibAlpha` (Physlib's staging area) is refused too.
- **One workspace per source.** Physlib pins its own Lean (v4.36) and Mathlib, different from formal-conjectures. Each problem records the workspace that verifies it, and the worker uses the matching sandbox image.
- **Synthetic statements** (machine-generated, as in parts of PhysLeanData) stay *draft* until a person has reviewed them.
- **Heuristic physics** (path integrals, renormalisation, non-rigorous limits) is out of scope unless stated as precise mathematics.

## Machine learning and chemistry

The taxonomy has `ml.theory`, `ml.optimization` and `chem.general`. Candidate sources (Optlib for optimization proofs, learning-theory formalizations) are being evaluated; chemistry has almost no Lean formalization yet. Propose problems through *formalization* submissions.
