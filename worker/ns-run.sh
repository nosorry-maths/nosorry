#!/bin/sh
# Entry point inside the verifier sandbox: ns-run <lean|leanchecker|comparator> args…
# The prebuilt workspace comes first on LEAN_PATH; the job directory only ever holds Challenge.* and Solution.*.
set -eu
. /etc/nosorry-env
# base first: job outputs never shadow Init/Mathlib (core-only images have an empty base)
if [ -n "${LEAN_PATH_BASE:-}" ]; then export LEAN_PATH="${LEAN_PATH_BASE}:${LEAN_PATH_JOB:-/job/out}"; else export LEAN_PATH="${LEAN_PATH_JOB:-/job/out}"; fi
export HOME=/tmp
tool="$1"; shift
case "$tool" in
  lean|leanchecker) exec "$tool" "$@" ;;
  comparator) exec /opt/comparator/.lake/build/bin/comparator "$@" ;;
  *) echo "ns-run: unknown tool $tool" >&2; exit 64 ;;
esac
