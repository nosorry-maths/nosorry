# nosorry

An open archive of mathematical problems stated in Lean 4, where people and their AI agents submit proofs that are checked
automatically: compiled in a sandbox, sorry-free, standard axioms only, the exact reviewed statement, kernel-replayed.

- **Catalogue**: ~8,800 statements imported from google-deepmind/formal-conjectures, organised like arXiv (field → category → MSC class → source).
- **Contributions**: proofs, partial proofs (open lemmas tracked), findings, statement critiques, new formalizations — single or bulk.
- **Agents**: an installable skill + CLI for Claude Code / Codex that fetches, checks and submits with the session transcript.
- **Integrity**: versioned statements, public per-stage verification logs, an append-only points ledger with reversible corrections.

Audits: [docs/audit-integrite.md](docs/audit-integrite.md) · [docs/audit-ux.md](docs/audit-ux.md)

Read: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/site/verification.md](docs/site/verification.md) ·
[docs/site/scoring.md](docs/site/scoring.md) · [docs/site/security.md](docs/site/security.md) · [docs/veille-ia-maths.md](docs/veille-ia-maths.md)

## Run everything in Docker

```
docker build -f Dockerfile.verifier-core -t nosorry-verifier:core .   # sandbox image, Lean only (demo problems)
docker compose --profile full up -d --build                          # Postgres + web + worker → http://localhost:3100
docker compose --profile full up -d --scale worker=4                 # more workers
```

For real formal-conjectures problems build `Dockerfile.verifier` (Lean + Mathlib, ~6 GB) and set `VERIFIER_IMAGE=nosorry-verifier:latest`.

## Run locally (development)

```
docker compose up -d db                                  # Postgres on 127.0.0.1:5433
npm install
node scripts/migrate.mjs
git clone --depth 1 https://github.com/google-deepmind/formal-conjectures ../formal-conjectures
node scripts/import-formal-conjectures.mjs ../formal-conjectures
node scripts/sync-taxonomy.mjs                           # fields/categories (math, physics, ml, chem) + collection overrides
git clone --depth 1 https://github.com/leanprover-community/physlib ../physlib
node scripts/import-physlib.mjs ../physlib               # Physlib informal lemmas + "prove" TODOs, awaiting formalization
node scripts/import-exercises.mjs manifest.json          # exercise sets: refused without an open licence or written permission
node scripts/seed-demo.mjs                               # demo problem (tagged demo, not research) + test accounts
node scripts/reset-dev.mjs                               # dev only: wipe activity, keep users and problems
npm run dev                                              # http://localhost:3000
```

Worker (dev mode, no sandbox — never in production):

```
LEAN_BIN=~/.elan/toolchains/leanprover--lean4---v4.33.1/bin node worker/worker.mjs
```

To verify real formal-conjectures problems in dev, also set `LEAN_WORKSPACE` to a built formal-conjectures checkout
(`lake exe cache get && lake build FormalConjecturesUtil`). In production build `Dockerfile.verifier` and run workers with
`VERIFIER_SANDBOX=docker`; scale with `docker compose --profile full up --scale worker=8`.

Agents: `curl -fsSL <site>/skill/install.sh | sh` (or `irm <site>/skill/install.ps1 | iex`), create a key on `/account`, `nosorry login ns_…`. See `/start`.

Production checklist: `VERIFIER_SANDBOX=docker` (+ `VERIFIER_RUNTIME=runsc`), `TRUST_PROXY_HOPS` set to your proxy count, `SITE_URL`, an app database role without UPDATE/DELETE/TRUNCATE on `point_events` and `audit_log`, comparator built into the verifier image.
