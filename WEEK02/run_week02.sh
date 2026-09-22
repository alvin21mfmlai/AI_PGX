#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ "$ROOT" != / && "$ROOT" != "$HOME" && -f "$ROOT/configs/full.json" && -f "$ROOT/scripts/week02.py" ]] || exit 2
cd -- "$ROOT"
for d in results manifests exports cache; do
  [[ ! -L "$ROOT/$d" ]] || { echo "Refusing symlink directory: $d" >&2; exit 2; }
  mkdir -p -- "$ROOT/$d"
done
ACTION="${1:-help}"

get_image() {
  [[ -f manifests/image.lock && ! -L manifests/image.lock ]] || { echo 'Run lock first.' >&2; exit 2; }
  IMAGE="$(< manifests/image.lock)"
  [[ "$IMAGE" =~ ^nvcr.io/nvidia/pytorch@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid image lock.' >&2; exit 2; }
  [[ "$(docker image inspect --format '{{.Architecture}}' "$IMAGE")" == arm64 ]] || exit 2
}

case "$ACTION" in
  lock)
    [[ "$(uname -m)" == aarch64 ]] || { echo 'Expected native aarch64 host.' >&2; exit 2; }
    [[ ! -e manifests/image.lock ]] || { echo 'Image already locked; no overwrite.'; exit 0; }
    docker info >/dev/null
    driver="$(nvidia-smi -i 0 --query-gpu=driver_version --format=csv,noheader)"
    major="${driver%%.*}"
    [[ "$major" =~ ^[0-9]+$ && "$major" -ge 580 ]] || { echo 'CUDA 13 candidate requires driver branch >=580; use Lenovo-supported update path.' >&2; exit 2; }
    docker pull --platform linux/arm64 nvcr.io/nvidia/pytorch:25.11-py3
    [[ "$(docker image inspect --format '{{.Architecture}}' nvcr.io/nvidia/pytorch:25.11-py3)" == arm64 ]] || exit 2
    IMAGE="$(docker image inspect --format '{{index .RepoDigests 0}}' nvcr.io/nvidia/pytorch:25.11-py3)"
    [[ "$IMAGE" =~ ^nvcr.io/nvidia/pytorch@sha256:[a-f0-9]{64}$ ]] || exit 2
    (set -o noclobber; printf '%s\n' "$IMAGE" > manifests/image.lock)
    docker image inspect "$IMAGE" > manifests/image-inspect.json
    echo "Locked native Arm64 image: $IMAGE"
    ;;
  manifest)
    get_image
    stamp="$(date -u +%Y%m%dT%H%M%S%NZ)"
    M="manifests/$stamp"
    mkdir -- "$M"
    { date -u; uname -srmo; cat /etc/os-release; lscpu; free -h; df -h .; docker version; } > "$M/host.txt" 2>&1
    nvidia-smi -q > "$M/nvidia-smi-private.txt"
    dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' > "$M/host-packages.tsv"
    sha256sum run_week02.sh scripts/week02.py tests/test_week02.py configs/*.json > "$M/source.sha256"
    cp -- manifests/image.lock "$M/image.lock"
    docker run --rm --platform linux/arm64 --gpus all --network none \
      --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
      --read-only --tmpfs /tmp:rw,nosuid,size=1g --env HOME=/tmp \
      --env NVIDIA_IMEX_CHANNELS=0 --entrypoint bash "$IMAGE" -lc \
      'python --version; python -m pip freeze --all; nvcc --version; dpkg-query -W; python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.__config__.show()); print(torch.cuda.is_available()); print(torch.cuda.get_device_capability(0)); print(torch.cuda.get_arch_list())"' \
      > "$M/container.txt" 2>&1
    echo "Captured $M (review identifiers before publishing)."
    ;;
  run|cpu)
    MODE="${2:-full}"
    if [[ "$ACTION" == cpu ]]; then MODE=cpu; fi
    [[ "$MODE" == full || "$MODE" == reduced || "$MODE" == cpu ]] || exit 2
    ID="$(date -u +%Y%m%dT%H%M%S%NZ)-$MODE"
    OUT="results/$ID"
    printf '%s\n' "$ID" > manifests/last-run.txt
    python3 -m unittest discover -s tests -v
    if [[ "$MODE" == cpu ]]; then
      python3 scripts/week02.py run --config configs/cpu.json --out "$OUT" 2>&1 | tee "results/$ID-console.txt"
    else
      get_image
      NAME="pgx52-w02-$ID"
      printf '%s\n' "$NAME" > manifests/last-container.txt
      docker run --rm --name "$NAME" --label pgx52.week=02 \
        --platform linux/arm64 --gpus all --network none \
        --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
        --read-only --tmpfs /tmp:rw,nosuid,size=1g --shm-size=1g \
        --memory=12g --memory-swap=12g \
        --mount "type=bind,source=$ROOT,target=/work" --workdir /work \
        --env HOME=/tmp --env CUDA_CACHE_PATH=/tmp/cuda-cache \
        --env OMP_NUM_THREADS=4 --env OPENBLAS_NUM_THREADS=4 \
        --env NVIDIA_IMEX_CHANNELS=0 --env PYTHONDONTWRITEBYTECODE=1 \
        --entrypoint python "$IMAGE" scripts/week02.py run \
          --config "configs/$MODE.json" --out "$OUT" 2>&1 | tee "results/$ID-console.txt"
      cp -- manifests/image.lock "$OUT/image.lock"
    fi
    sha256sum run_week02.sh scripts/week02.py tests/test_week02.py configs/*.json > "$OUT/source.sha256"
    python3 scripts/week02.py report --out "$OUT"
    echo "Run ID: $ID"
    echo "Dashboard: $ROOT/$OUT/dashboard.html"
    ;;
  report|export)
    ID="${2:-$(< manifests/last-run.txt)}"
    [[ "$ID" =~ ^[0-9]{8}T[0-9]{15}Z-(full|reduced|cpu)$ ]] || { echo 'Invalid run ID.' >&2; exit 2; }
    [[ -d "results/$ID" && ! -L "results/$ID" ]] || exit 2
    if [[ "$ACTION" == report ]]; then
      python3 scripts/week02.py report --out "results/$ID"
    else
      [[ ! -e "exports/$ID.tar.gz" ]] || { echo 'Export already exists; refusing overwrite.' >&2; exit 2; }
      tar --exclude='__pycache__' -czf "exports/$ID.tar.gz" -- "results/$ID" configs scripts tests run_week02.sh README.md LICENSING.md
      sha256sum "exports/$ID.tar.gz"
      tar -tzf "exports/$ID.tar.gz"
    fi
    ;;
  stop)
    NAME="$(< manifests/last-container.txt)"
    [[ "$NAME" =~ ^pgx52-w02-[0-9]{8}T[0-9]{15}Z-(full|reduced)$ ]] || exit 2
    [[ "$(docker inspect --format '{{index .Config.Labels "pgx52.week"}}' "$NAME")" == 02 ]] || exit 2
    docker stop --time 30 "$NAME"
    ;;
  *)
    echo 'Usage: bash run_week02.sh lock|manifest|run [full|reduced]|cpu|report [RUN_ID]|export [RUN_ID]|stop'
    ;;
esac
