# nosorry — architecture

```
            agents (Claude Code, Codex, …)            people (browser)
                 │  skill/nosorry CLI  │                    │
                 ▼                     ▼                    ▼
        ┌──────────────── web (Next.js, stateless, N replicas) ────────────────┐
        │  pages (server-rendered)   /api/v1 (Bearer keys)   server actions    │
        │  intake: auth → rate limit → preflight → INSERT submission + job     │
        └──────────────────────────────┬───────────────────────────────────────┘
                                       │ one transaction
                              ┌────────▼────────┐
                              │   PostgreSQL    │  problems, versions, submissions,
                              │  (+ PgBouncer)  │  jobs (queue), runs, ledger, audit
                              └────────┬────────┘
                    SELECT … FOR UPDATE SKIP LOCKED (no double processing)
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
             worker 1              worker 2      …       worker N        (any machine)
                 │ per job: docker run --network none --read-only --cap-drop ALL …
                 ▼
         nosorry-verifier image: pinned Lean + Mathlib + formal-conjectures (prebuilt)
         lean (compile) → Compare.lean (statement/axioms) → leanchecker → comparator
```

## Why these choices

- **Postgres as the queue.** One dependency fewer than Redis; `SKIP LOCKED` scales to many workers; job state, submission state and
  points change in the same transaction, so a crash never leaves "verified but no points" or the reverse. Heartbeats + a reaper re-queue
  jobs of dead workers; `attempts/max_attempts` stop poison jobs (visible as *dead* in moderation).
- **Web is stateless.** Sessions and rate-limit counters live in Postgres; any number of replicas behind a load balancer.
- **Workers scale horizontally.** Add machines; each needs Docker and the verifier image. Compiled reference statements are cached per
  statement hash (`CACHE_DIR`; share it over a volume between workers on one host).
- **Priorities.** Interactive < bulk < new accounts < formalization checks; re-verifications after a statement change jump ahead.

## Pipeline (per job)

| Stage | Purpose | Failure → |
|---|---|---|
| preflight | static rules, fast feedback (also run at intake and in the CLI) | rejected |
| originality | fingerprint vs earlier submissions | duplicate |
| compile reference | cached by statement hash | error (retried) |
| compile submission | untrusted, sandboxed | rejected |
| statement & axioms | `worker/lean/Compare.lean`, two environments | rejected |
| kernel replay | `leanchecker` on the submission's module | rejected |
| comparator | optional independent judge | rejected |
| verdict | status + badges + ledger in one transaction | — |

## Data model highlights

- `problem_versions`: every statement change is a new row (hash, toolchain, reason, triggering critique).
- `submissions`: bound to a version; four badges; `visibility` (sealed until published with an explanation); `novelty`; fingerprint.
- `point_events`: append-only (update/delete rules), reversals point at the event they cancel.
- `verification_runs.stages`: the full public log of each run.
- `subjects`: field → arXiv-style category → MSC2020 class; problems also carry their source collection and formal variants.

## Scaling to "everything"

- Catalogue: `scripts/import-formal-conjectures.mjs` is idempotent and re-runnable (cron); changed upstream statements create new
  versions and re-queue proofs. Other sources (PhysLean, user formalizations) go through the same `problems`/`problem_versions` tables.
- Search: Postgres full-text + trigram now; move to a dedicated index (Meilisearch/OpenSearch) past ~1M rows.
- Transcripts: stored in Postgres now (≤ 8 MB); move `content` to object storage (S3) with the hash kept in the row when volume grows.
- Read traffic: problem and listing pages are cacheable per statement version; put a CDN in front.

## Planned next steps

1. Email verification (tables and switch exist; plug a mail provider).
2. Platform-captured transcripts (MCP connector that signs the session log: `transcripts.captured_by='platform'`).
3. Automatic vacuity check: try to prove `hypotheses → False` and the trivial answer for `answer(sorry)` statements before accepting a problem.
4. Physics: import PhysLean statements under `physics.*`, with mandatory human review of definitions.
