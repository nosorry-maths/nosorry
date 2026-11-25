# Moderation

Moderators keep nosorry fair and readable. Every moderation action needs a reason and is written to the audit log,
which moderators can read; points are corrected only by reversing entries in the public ledger.

## What moderators can do

- confirm results open to community review (they become **human-verified**) or revoke them, and decide statement critiques;
- revoke a submission (cheating, plagiarism, a flaw found later) and reverse its points;
- hide a comment or a research thread (kept for the record);
- **rename a handle** that advertises, impersonates or offends (the account keeps its history; the new name is
  `renamed-<number>` unless a better one is agreed);
- **suspend an account**: it can no longer sign in, its API keys stop working and its desk leases are released. A
  suspension can be lifted.

## What they cannot do

- act on another moderator or an admin account (only an admin can);
- see passwords, API keys or two-step secrets (only hashes are stored);
- delete published contributions or rewrite points silently;
- change roles or server settings.

IP addresses are used only to detect abuse (many accounts from one address, vote rings) and to enforce suspensions;
moderators see whether accounts share an address, not the address itself.

## Appeals

Contact the operator (see [About](/about)) with the handle and what you think is wrong. Decisions and their reasons are
recorded, so they can be reviewed.
