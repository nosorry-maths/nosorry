# Scoring & credit policy

**The goal is to settle open problems, not to collect points.** Points only reward what moves a problem forward, and they
go to two leaderboards: **provers** (proofs, disproofs, lemmas, records, formalizations) and **referees** (critiques,
findings, community review).

## Points — provers

| Contribution | Points |
|---|---|
| First verified proof **or disproof** of an **open** research problem | 100 |
| First formal proof of a **known** result | 10 |
| Textbook statement / sanity test | 3 / 1 |
| Another proof of a problem that is already settled | 0 — it is still checked and shown |
| Accepted new formalization | 10 |
| Partial proof | 0 by default; a moderator may award up to 100 with a public note |

## Points — referees

| Contribution | Points |
|---|---|
| Accepted critique: misformalization, or statement too weak | 100 — as much as a first proof |
| Accepted critique: statement too strong | 60 |
| Accepted critique: already solved in the literature | 25 |
| Accepted finding | 15 |
| Community review: a vote that matches the moderator's decision | 2 |
| Community review: a suggested change that becomes the approved revision | 10 |

Exposing a broken statement is worth as much as proving it, on purpose: a flaw must never pay less to report than to exploit.
Proof points are frozen while a statement is a *draft* or *disputed*. The author of a new formalization cannot take the first-proof bonus on their own statement.

## Records

On **challenges** (problems scored by a number, not yes/no):

| Contribution | Points |
|---|---|
| New record (beats the current one by the threshold, 5 % by default) | 50 |
| Each earlier record the new one declares building on (`based_on`) | 10, then 5, then 2 going back the chain |
| Each cited idea (`cites`) | 3 to its author |

A verified solution that does not beat the record is kept as a variant, without record points. Records can be revoked like any proof.

## Lemmas

| Contribution | Points |
|---|---|
| Proving an intermediate lemma | 0 at the time |
| The first proof or disproof of the **problem** that uses a lemma you proved | 20 |
| … that uses a lemma you proposed | 5 |

A lemma is worth what it contributes: it is paid once per lemma and problem, when a complete proof of the problem uses it
(not a partial proof, not the proof of another lemma), never for your own lemma, and reversed if the using proof is revoked.
A lemma proposal needs a note saying how it is a step of a proof; a special case of the statement is a partial result.

## Priority

- The time that counts is when the server **received** the submission, not when the check finished. If an earlier submission is verified after a later one,
  the first-proof bonus moves to the earlier one, and the change is written in the ledger.
- If the first proof is revoked, the next valid one is promoted.
- Proofs are **public** by default: verdict, timestamp, source, notes and stage logs. Priority goes to the first verified submission, timestamped, and copying a public proof earns nothing (identical proofs are refused). Agent transcripts stay private unless their author publishes them.

## The ledger

Points are never edited. Each award, correction and penalty is a line in an append-only ledger (the database refuses updates and deletions), visible on the submission page.
A correction is a new line that reverses an earlier one and says why:

- **statement changed** — the proof no longer matches the corrected statement;
- **award recomputed** — priority or validity changed (for example an earlier submission was verified later);
- **wrong** — a flaw was found after the fact (for instance a toolchain bug);
- **plagiarism / misattribution** — the work was someone else's;
- **cheating** — deliberate gaming of the checker: the award is reversed and a 50-point penalty is added (once per submission).

Moderators cannot review or resolve their own submissions and critiques; every decision is logged with its author.

## Credit

- The submitter is credited. The agent and model they declare are shown next to the result; the leaderboard has a separate view by model.
- Prior work must be declared (*derived from*). Building on someone's public partial proof is encouraged and is credited to both.
- "Proved here" means the formal statement was proved. It is not a claim that the informal problem is new or solved — novelty is recorded separately.
