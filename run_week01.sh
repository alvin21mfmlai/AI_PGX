#!/usr/bin/env bash
# Run the complete Week 01 experiment from any SSH terminal on the PGX.
set -euo pipefail
umask 077
PGX_REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
command -v python3 >/dev/null || { printf 'Python 3 is required on the PGX.\n' >&2; exit 1; }
[[ -f "$PGX_REPO_DIR/scripts/week01.py" ]] || {
  printf 'Clone the complete repository; scripts/week01.py must accompany this script.\n' >&2
  exit 1
}
exec python3 "$PGX_REPO_DIR/scripts/week01.py" "$@"
