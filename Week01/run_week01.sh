#!/usr/bin/env bash
# PGX52 Week 01: one entry point, with evidence-preserving installation.
set -euo pipefail
umask 077

readonly PROJECT_ROOT='/AI_PGX/week01-platform-baseline'
readonly PROJECT_PARENT='/AI_PGX'

usage() {
  cat <<'HELP'
Usage:
  bash run_week01.sh [all] [--runs N] [--image-digest DIGEST]
  bash run_week01.sh setup [--image-digest DIGEST]
  bash run_week01.sh run
  bash run_week01.sh inspect
  bash run_week01.sh export
  bash run_week01.sh fresh-start
  bash run_week01.sh --help

all          Set up, run N benchmarks, inspect the latest result, and export.
             This is the default command; N defaults to 3.
setup        Install supplied runtime scripts and validate the environment.
run          Install supplied runtime scripts and perform one benchmark run.
inspect      Display the latest result using the installed runner.
export       Generate the chart, checksums, and archive using the installed runner.
fresh-start  Explicitly invoke fresh_start.sh to back up and recreate the project.
             Run this from a copy outside the project. Then run all.

Project: /AI_PGX/week01-platform-baseline (fixed)
Run on the Arm64 PGX as your normal user, with Docker GPU access configured.
--runs accepts a positive integer and applies only to all.
--image-digest applies only to all/setup and must be an exact reference:
  nvcr.io/nvidia/pytorch@sha256:<64 lowercase hexadecimal characters>

Normal installation preserves results and image locks. Different installed
runtime scripts are backed up before replacement. If existing run evidence
uses a different benchmark source, installation stops; fresh-start is explicit.
A stability warning is retained and does not prevent the next run or export.
This script does not install drivers/packages or publish anything to GitHub.
HELP
}

fail() { printf 'Week 01 stopped: %s\n' "$*" >&2; exit 1; }

PGX_ACTION='all'
PGX_RUNS='3'
PGX_RUNS_SET=0
PGX_IMAGE_DIGEST=''
if [[ $# -gt 0 && "$1" != -* ]]; then
  PGX_ACTION="$1"
  shift
fi
case "$PGX_ACTION" in all|setup|run|inspect|export|fresh-start) ;;
  *) fail "Unknown command: $PGX_ACTION. Use --help." ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --runs)
      [[ $# -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || fail '--runs requires a positive integer.'
      [[ ${#2} -le 6 ]] || fail '--runs is too large (maximum 999999).'
      [[ "$PGX_RUNS_SET" -eq 0 ]] || fail '--runs was specified more than once.'
      PGX_RUNS="$2"; PGX_RUNS_SET=1; shift 2 ;;
    --image-digest)
      [[ $# -ge 2 ]] || fail '--image-digest requires a value.'
      [[ -z "$PGX_IMAGE_DIGEST" ]] || fail '--image-digest was specified more than once.'
      [[ "$2" =~ ^nvcr\.io/nvidia/pytorch@sha256:[0-9a-f]{64}$ ]] || fail 'Use a full NVIDIA PyTorch SHA-256 digest reference.'
      PGX_IMAGE_DIGEST="$2"; shift 2 ;;
    *) fail "Unknown argument: $1. Use --help." ;;
  esac
done
[[ "$PGX_RUNS_SET" -eq 0 || "$PGX_ACTION" == all ]] || fail '--runs applies only to all; run performs one benchmark.'
[[ -z "$PGX_IMAGE_DIGEST" || "$PGX_ACTION" == all || "$PGX_ACTION" == setup ]] || fail '--image-digest applies only to all/setup.'

[[ "$EUID" -ne 0 ]] || fail 'Run as your normal user, without sudo bash.'
[[ "$(uname -m)" == aarch64 ]] || fail 'Run this script on your Arm64 PGX (aarch64).'
for PGX_COMMAND in docker python3 realpath mkdir id flock; do
  command -v "$PGX_COMMAND" >/dev/null || fail "Required command is unavailable: $PGX_COMMAND"
done
docker info >/dev/null || fail 'Docker is not usable by this user. Resolve Docker access first.'
readonly SOURCE_ROOT="$(realpath -e -- "$(dirname -- "${BASH_SOURCE[0]}")")"

if [[ "$PGX_ACTION" == fresh-start ]]; then
  [[ -f "$SOURCE_ROOT/fresh_start.sh" && ! -L "$SOURCE_ROOT/fresh_start.sh" ]] || fail 'Bundled fresh_start.sh is missing or is a symlink.'
  exec bash "$SOURCE_ROOT/fresh_start.sh"
fi

[[ ! -L "$PROJECT_PARENT" ]] || fail 'The project parent must not be a symlink.'
[[ ! -L "$PROJECT_ROOT" ]] || fail 'The project must not be a symlink.'

if [[ "$PGX_ACTION" == all || "$PGX_ACTION" == setup || "$PGX_ACTION" == run ]]; then
  for PGX_RELATIVE in scripts/week01.py scripts/monitor_host.sh scripts/plot_results.py benchmarks/torch_baseline.py; do
    [[ -f "$SOURCE_ROOT/$PGX_RELATIVE" && ! -L "$SOURCE_ROOT/$PGX_RELATIVE" ]] || fail "Missing regular source file: $PGX_RELATIVE"
  done
  [[ ! -L "$SOURCE_ROOT/scripts" && ! -L "$SOURCE_ROOT/benchmarks" ]] || fail 'Source directories must not be symlinks.'

  # Only parent creation may require sudo. Existing permissions are not changed.
  if [[ ! -e "$PROJECT_PARENT" ]]; then
    command -v sudo >/dev/null || fail "sudo is needed to create $PROJECT_PARENT."
    sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" -- "$PROJECT_PARENT"
  fi
  [[ -d "$PROJECT_PARENT" && "$(realpath -e -- "$PROJECT_PARENT")" == "$PROJECT_PARENT" ]] || fail 'Invalid project parent.'
  if [[ ! -e "$PROJECT_ROOT" ]]; then
    mkdir -- "$PROJECT_ROOT"
  fi
  [[ -d "$PROJECT_ROOT" && "$(realpath -e -- "$PROJECT_ROOT")" == "$PROJECT_ROOT" ]] || fail 'Invalid project directory.'

  # Validate each path before mkdir/open. Lock the same file used by week01.py.
  [[ ! -L "$PROJECT_ROOT/notes" ]] || fail 'notes must not be a symlink.'
  mkdir -p -- "$PROJECT_ROOT/notes"
  [[ ! -L "$PROJECT_ROOT/notes/operation-lock" ]] || fail 'The operation lock must not be a symlink.'
  [[ ! -e "$PROJECT_ROOT/notes/operation-lock" || -f "$PROJECT_ROOT/notes/operation-lock" ]] || fail 'Invalid operation lock.'
  exec 9<>"$PROJECT_ROOT/notes/operation-lock"
  flock -n 9 || fail 'Another Week 01 operation is running. Let it finish before installing.'

  python3 - "$SOURCE_ROOT" "$PROJECT_ROOT" "$PGX_IMAGE_DIGEST" <<'PY'
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

source, root = map(Path, sys.argv[1:3])
explicit = sys.argv[3]
runtime = ('scripts/week01.py', 'scripts/monitor_host.sh',
           'scripts/plot_results.py', 'benchmarks/torch_baseline.py')
directories = ('scripts', 'benchmarks', 'config', 'docs', 'env', 'logs', 'notes',
               'results', 'results/raw', 'results/summary', 'tests', 'notes/source-backups')

def stop(message):
    raise SystemExit('Week 01 stopped: ' + message)

for name in directories:
    path = root / name
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        stop(f'Expected a real directory: {path}')
for name in runtime:
    path = root / name
    if path.is_symlink() or (path.exists() and not path.is_file()):
        stop(f'Expected a regular runtime file: {path}')

incoming = {name: (source / name).read_bytes() for name in runtime}
benchmark = 'benchmarks/torch_baseline.py'
incoming_hash = hashlib.sha256(incoming[benchmark]).hexdigest()
evidence = sorted((root / 'results/raw').glob('torch-baseline-*.*'))
metadata = sorted((root / 'env').glob('run-*.json'))
for path in metadata:
    if path.is_symlink():
        stop(f'Run metadata must not be a symlink: {path}')
    try:
        recorded = json.loads(path.read_text())['benchmark_sha256']
    except (ValueError, KeyError, TypeError) as exc:
        stop(f'Cannot validate benchmark provenance in {path}: {exc}')
    if recorded != incoming_hash:
        stop('Existing run metadata records different benchmark source bytes. '
             'Keep this folder intact; use the matching source or explicitly fresh-start.')
if evidence:
    current = root / benchmark
    if not current.is_file() or hashlib.sha256(current.read_bytes()).hexdigest() != incoming_hash:
        stop('Existing results have missing or different installed benchmark source. '
             'Keep this folder intact; use the matching source or explicitly fresh-start.')

# Older playbooks saved timestamped locks only. Preserve the exact image choice
# by promoting a unique legacy digest; never execute environment files as code.
digest_re = re.compile(r'nvcr\.io/nvidia/pytorch@sha256:[0-9a-f]{64}')
canonical = root / 'env/container-lock.env'
def read_digest(path):
    if path.is_symlink() or not path.is_file():
        stop(f'Invalid image lock: {path}')
    fields = {}
    for line in path.read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            fields[key] = value.strip()
    value = fields.get('IMAGE_DIGEST', '')
    if not digest_re.fullmatch(value):
        stop(f'Invalid image digest in {path}; original file retained.')
    return value

promotion = None
if canonical.exists() or canonical.is_symlink():
    locked = read_digest(canonical)
    if explicit and explicit != locked:
        stop('The explicit image digest differs from the canonical lock. Existing lock retained.')
else:
    candidates = {read_digest(path) for path in sorted((root / 'env').glob('container-lock-*.env'))}
    if explicit and candidates and explicit not in candidates:
        stop('Choose an image digest already recorded by this project.')
    if len(candidates) > 1 and not explicit:
        stop('Multiple historical image digests exist. Select the intended recorded digest '
             'with setup --image-digest. Recorded values: ' + ', '.join(sorted(candidates)))
    if candidates:
        promotion = explicit or next(iter(candidates))

for name in directories:
    (root / name).mkdir(parents=True, exist_ok=True)

changed = [name for name in runtime
           if (root / name).exists() and (root / name).read_bytes() != incoming[name]]
if changed:
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup = root / 'notes/source-backups' / stamp
    backup.mkdir()
    for name in changed:
        target = backup / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / name).read_bytes())
    print('Previous runtime source preserved:', backup)

for name in runtime:
    target = root / name
    if target.exists() and target.read_bytes() == incoming[name]:
        continue  # Includes execution directly from the installed project.
    fd, temporary = tempfile.mkstemp(prefix='.week01-install-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(incoming[name])
        os.chmod(temporary, 0o700)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

if promotion:
    with canonical.open('x') as handle:
        handle.write('IMAGE_TAG=nvcr.io/nvidia/pytorch:25.11-py3\n'
                     'IMAGE_ARCH=arm64\nIMAGE_DIGEST=' + promotion + '\n')
    print('Existing image choice preserved in canonical lock:', promotion)
print('Runtime ready:', root)
PY
  flock -u 9
  exec 9>&-
else
  [[ -d "$PROJECT_ROOT" && "$(realpath -e -- "$PROJECT_ROOT")" == "$PROJECT_ROOT" ]] || fail 'Run setup first; the project directory does not exist.'
  for PGX_RELATIVE in env logs notes results results/raw results/summary scripts benchmarks; do
    [[ -d "$PROJECT_ROOT/$PGX_RELATIVE" && ! -L "$PROJECT_ROOT/$PGX_RELATIVE" ]] || fail "Expected a real project directory: $PGX_RELATIVE"
  done
  [[ ! -L "$PROJECT_ROOT/env/container-lock.env" ]] || fail 'The image lock must not be a symlink.'
fi

[[ ! -L "$PROJECT_ROOT/scripts" && ! -L "$PROJECT_ROOT/scripts/week01.py" && -f "$PROJECT_ROOT/scripts/week01.py" ]] || fail 'Installed runner is missing or is a symlink. Run setup first.'
[[ -d "$PROJECT_ROOT/notes" && ! -L "$PROJECT_ROOT/notes" && ! -L "$PROJECT_ROOT/notes/operation-lock" ]] || fail 'Invalid notes directory or operation lock.'

PGX_SETUP_ARGS=(setup)
if [[ -n "$PGX_IMAGE_DIGEST" ]]; then
  PGX_SETUP_ARGS+=(--image-digest "$PGX_IMAGE_DIGEST")
fi
case "$PGX_ACTION" in
  all)
    python3 "$PROJECT_ROOT/scripts/week01.py" "${PGX_SETUP_ARGS[@]}"
    for (( PGX_INDEX=1; PGX_INDEX<=PGX_RUNS; PGX_INDEX++ )); do
      printf '\nBenchmark run %s of %s\n' "$PGX_INDEX" "$PGX_RUNS"
      python3 "$PROJECT_ROOT/scripts/week01.py" run
    done
    python3 "$PROJECT_ROOT/scripts/week01.py" inspect
    python3 "$PROJECT_ROOT/scripts/week01.py" export
    printf '\nWeek 01 command sequence completed. Review the retained stability results.\n'
    ;;
  setup) python3 "$PROJECT_ROOT/scripts/week01.py" "${PGX_SETUP_ARGS[@]}" ;;
  run|inspect|export) python3 "$PROJECT_ROOT/scripts/week01.py" "$PGX_ACTION" ;;
esac
