# How verification works

A submission is a Lean 4 file, `Solution.lean`, written against a reference file, `Challenge.lean`, that states the problem.
It is accepted when a machine — not a person — can confirm three things, and people have confirmed a fourth.

| Badge | Question | Who decides |
|---|---|---|
| **Lean accepts it** | Does the file compile under the pinned toolchain and Mathlib? | Lean |
| **Standard axioms** | Does the proof depend only on `propext`, `Classical.choice`, `Quot.sound`? No `sorryAx`, no new axiom, no `Lean.ofReduceBool`. | Lean |
| **Right theorem** | Is the proved declaration *exactly* the reference statement (or, for a disproof, exactly its negation), with every declaration the statement depends on unchanged? | Lean |
| **Faithful statement** | Does the formal statement say what the problem says? | People (statement review) |

## Proofs, disproofs, partial proofs

- **Proof**: prove the target declaration, e.g. `Erdos488.erdos_488`, with the same type.
- **Disproof**: the statement is false. Keep the file, and add `theorem not_erdos_488 : ¬ (…)` whose type is exactly `¬` of the reference type. Its name is the reference theorem's full name with its LAST part prefixed by not_ (Erdos786.erdos_786.parts.i → Erdos786.erdos_786.parts.not_i; Erdos488.erdos_488 → Erdos488.not_erdos_488). It is checked like a proof and scored like one.
- **Partial proof**: prove the target from lemmas you leave as `sorry`. The checker lists those lemmas; each becomes a visible open sub-problem.

## The pipeline

**Repository submissions.** A proof too large for one file can be submitted as a public GitHub repository at an exact commit, with the module that contains the theorem. The verifier fetches it and its dependencies without running any of its code, builds the dependencies (allowlisted: leanprover-community, leanprover, formal-conjectures), then builds the repository as the isolated account without network (up to 5 h 30), compiles the reference statement with the **same** toolchain and dependencies, compares statement, definitions and axioms as for a file, and replays in the kernel every declaration of the repository that the proof uses. Requirements: a declarative `lakefile.toml`, a committed `lake-manifest.json`, a dependency on formal-conjectures; a verdict obtained with another Lean/Mathlib than the statement's says so. Example: [nosorry-repo-example](https://github.com/nosorry-maths/nosorry-repo-example).

Each run is logged stage by stage on the submission page (public, like the proof).

1. **Preflight.** Static rules on the source (comments, strings, char literals and «names» removed first): no `axiom`, `unsafe`/`partial`, `opaque`, `implemented_by`, `extern`,
   `native_decide`, evaluation commands, custom syntax or elaborators, meta-level attributes, initializers, `IO`, the meta-programming API, search commands
   (`#leansearch`, `exact?`…), or options other than heartbeats/recursion depth/linters. A solution may repeat the reference's own notation lines verbatim.
   This stage gives fast, readable errors; it is **not** the security boundary.
2. **Originality.** A fingerprint of the normalized source (comments, layout and declaration names removed) is compared with earlier submissions by other people.
3. **Reference statement.** `Challenge.lean` is compiled once per statement version, in its own directory, and cached by its hash.
4. **Submission.** `Solution.lean` is compiled in a throwaway container: no network, read-only file system, no capabilities, unprivileged user, CPU/memory/process/time limits.
   It is the only stage that can write anything, in its own directory; only `Solution.olean`/`.ilean` are copied out, by exact name.
5. **Statement & axioms.** In a fresh, **read-only** directory containing only the trusted checker, the cached reference and the copied output, a checker loads the
   reference and the submission into *two separate environments* (without running any of their initializers) and compares:
   - the target's type and universe parameters (or `¬ type` for a disproof);
   - the **closure of the statement**: every constant the statement depends on — definitions, their bodies, inductive types, constructors, recursors, auxiliary and
     private names, in any module — must be identical in the submission;
   - the axioms of the proof's full dependency closure, and which lemmas still contain `sorry`.
6. **Kernel replay.** `leanchecker` re-checks every declaration of the submission with Lean's kernel, independently of the elaborator that produced it (read-only directory).
7. **Comparator.** Where configured, [leanprover/comparator](https://github.com/leanprover/comparator) runs as an additional independent check, with the statement's definitions.
8. **Verdict.** `verified`, `partial`, `rejected`, or `in review`; points are recomputed in the same transaction.

## Statements that change

Statements are versioned; a proof is bound to the version it was checked against. When a statement is corrected — after an accepted critique or an upstream fix —
it is marked *disputed*, points on that problem are frozen, and every proof, disproof and partial proof is re-checked against the new version.
Proofs that no longer match become *superseded*. When the last re-check finishes, the statement is *reviewed* again and points are recomputed — every change appears
in the public ledger. An infrastructure failure during a re-check never costs points.

## What needs a person

- `answer(sorry)` statements: the submitter fills in the answer, and a trivial answer can make the statement vacuous. These proofs are verified, then held for review;
  the moderator sees the exact terms supplied. Holes are only accepted where the statement declares an answer.
- Draft statements (new formalizations) and disputed ones: proofs are verified, points wait for the statement review.
- Findings, critiques and new formalizations.
- Novelty: whether a result is new or already in the literature.

## Reproducing a verdict

Every page lists the toolchain, the statement hash and, once published, the full source. Download `Challenge.lean`, put the submitted `Solution.lean` beside it
in a Lake project with the same Mathlib (`nosorry fetch <slug>` writes one), and run the same commands: `lean`, the checker (`worker/lean/Compare.lean`), then `leanchecker`.
