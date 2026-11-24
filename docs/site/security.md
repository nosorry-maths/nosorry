# Security

nosorry runs code written by strangers — a Lean file can execute programs while it compiles — and hands out points for it.
The design assumes every submission is hostile.

## Untrusted Lean

- **One container per stage.** Every compilation and check runs in a fresh container: no network, read-only root, `--cap-drop ALL`, `no-new-privileges`,
  unprivileged user, process/CPU/memory/time limits, optional gVisor runtime. The web servers never run Lean.
- **Separated directories.** The submission compiles alone in its own directory — the only writable mount. Only `Solution.olean`/`.ilean` are copied out, by exact name,
  regular files only. The checker, the cached reference and that output are then mounted **read-only** for the checking stages; the toolchain and Mathlib come first on
  the module path, so nothing the submission produced can shadow them.
- **Two environments.** The reference and the submission are loaded separately; no module initializer is executed.
- **Statement closure.** Every constant the statement depends on, auxiliary and private names included, must be identical in the submission.
- **Kernel replay.** `leanchecker` re-checks every declaration of the submission with the kernel.
- **Independent check.** `leanprover/comparator` can run as an additional check.
- **Static rules** catch the common problems early and give readable errors; they are a convenience, not the boundary.
- **Never trusted:** uploaded `.olean` files (we only accept source), the submitter's toolchain, the transcript.

## Accounts

- Passwords hashed with scrypt; logins take the same time whether or not the account exists; failed attempts are limited per account without locking out the owner.
- Sessions: random 256-bit tokens, stored only as SHA-256 hashes; `HttpOnly`, `SameSite=Lax`, `Secure` cookies.
- API keys: shown once and never placed in a URL, stored as SHA-256, compared in constant time, revocable, scoped (`read`, `submit`).
- Rate limits shared by all web nodes. Client addresses are taken only from proxies we control (`TRUST_PROXY_HOPS`), never from headers a client can set; global limits always apply.
- Email verification is built in and off for now; `REQUIRE_EMAIL_VERIFICATION=true` blocks submissions from unverified accounts.

## Web

- User Markdown: raw HTML escaped, link labels rendered and escaped, links limited to http(s) and same-site paths with `rel="nofollow ugc"`, TeX through KaTeX with `trust: false`,
  and the final HTML passed through an allow-list sanitizer.
- Content-Security-Policy with a fresh nonce per request (`script-src 'nonce-…' 'strict-dynamic'`), `frame-ancestors 'none'`, `nosniff`, HSTS. Server actions check the request origin.
- Request bodies are read as streams with a hard size limit.

## Integrity of the record

- Points live in an append-only ledger; the database raises an error on update, delete or truncate of the ledger and of the audit log.
- Moderation decisions are state transitions checked in the database (a decision on an already-decided item fails), never on one's own work, and always audited.
- Statements are versioned and hashed; each proof records the exact version and toolchain it was checked with.

## Reporting

Found a way to get a false statement accepted? That is the most valuable report we can receive.
Report it privately to the maintainers; confirmed checker issues are credited publicly once fixed.
