#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SOURCE_DIR"
test -f configs/week04.env && test -f scripts/benchmark.py && test -f data/prompts.jsonl || {
  echo 'Extract and keep the complete Week 4 package together.' >&2; exit 1;
}
test "$(id -u)" -ne 0 || { echo 'Run as your normal user, not root.' >&2; exit 1; }

CONFIG_FILE="${PGX4_CONFIG_FILE:-configs/week04.env}"
test -f "$CONFIG_FILE" || { echo "Missing config: $CONFIG_FILE" >&2; exit 1; }
# The package owns these declarative files; do not source user-supplied paths.
case "$CONFIG_FILE" in configs/week04.env|configs/reduced.env) ;; *) echo 'Config must be one of the packaged env files.' >&2; exit 1;; esac
set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
set +a

PGX4_WORK_DIR="${PGX4_WORK_DIR:-/AI_PGX/week04-vllm-serving}"
WORK_DIR="$(readlink -m -- "$PGX4_WORK_DIR")"
case "$WORK_DIR" in /AI_PGX/week04-vllm-serving|"$HOME"/AI_PGX/week04-vllm-serving) ;; *)
  echo "Refusing unapproved work path: $WORK_DIR" >&2
  echo 'Use /AI_PGX/week04-vllm-serving or $HOME/AI_PGX/week04-vllm-serving.' >&2
  exit 1;;
esac
CONTAINER_NAME="pgx52-week04-vllm"
MANIFEST_DIR="$WORK_DIR/manifests"
CACHE_DIR="$WORK_DIR/cache/huggingface"
RESULTS_DIR="$WORK_DIR/results"
EXPORTS_DIR="$WORK_DIR/exports"

require_setup() {
  test -d "$WORK_DIR" || { echo "Run: bash run_week04.sh setup" >&2; exit 1; }
}
image_ref() {
  if test -s "$MANIFEST_DIR/image-ref.txt"; then head -n1 "$MANIFEST_DIR/image-ref.txt"; else printf '%s\n' "$VLLM_IMAGE"; fi
}
port_free() {
  ! ss -ltn "sport = :$HOST_PORT" | tail -n +2 | grep -q .
}

case "${1:-help}" in
  setup)
    WORK_PARENT="$(dirname -- "$WORK_DIR")"
    if test ! -d "$WORK_DIR" && { test ! -d "$WORK_PARENT" || test ! -w "$WORK_PARENT"; }; then
      sudo install -d -m 0750 -o "$USER" -g "$(id -gn)" "$WORK_DIR"
    fi
    install -d -m 0750 "$WORK_DIR" "$MANIFEST_DIR" "$CACHE_DIR" "$RESULTS_DIR" "$EXPORTS_DIR" "$WORK_DIR/logs"
    cp -n checkin.json "$WORK_DIR/checkin.json"
    printf '%s\n' "$SOURCE_DIR" > "$MANIFEST_DIR/source-dir.txt"
    echo "Ready: $WORK_DIR"
    ;;
  preflight)
    require_setup
    test "$(uname -m)" = aarch64 || { echo 'Expected native aarch64 on the Lenovo PGX.' >&2; exit 1; }
    for cmd in docker python3 curl sha256sum ss free df; do command -v "$cmd" >/dev/null || { echo "Missing command: $cmd" >&2; exit 1; }; done
    docker info >/dev/null
    command -v nvidia-smi >/dev/null
    test "$(df -Pk "$WORK_DIR" | awk 'NR==2 {print $4}')" -ge 41943040 || { echo 'Need at least 40 GiB free disk.' >&2; exit 1; }
    test "$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)" -ge 33554432 || { echo 'Need at least 32 GiB available unified memory before starting.' >&2; exit 1; }
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    {
      date -u +%FT%TZ; uname -a; cat /etc/os-release; lscpu; free -h; df -h "$WORK_DIR"; df -i "$WORK_DIR"
      nvidia-smi; docker version; docker info; python3 --version
      command -v nvcc >/dev/null && nvcc --version || true
      dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' 2>/dev/null || true
    } > "$MANIFEST_DIR/host-$STAMP.txt" 2>&1
    echo 'PASS: aarch64, Docker, NVIDIA driver, memory and disk preflight. No driver/toolkit changes made.'
    ;;
  pull)
    require_setup
    docker pull --platform linux/arm64 "$VLLM_IMAGE"
    ARCH="$(docker image inspect "$VLLM_IMAGE" --format '{{.Architecture}}')"
    test "$ARCH" = arm64 || { echo "Wrong image architecture: $ARCH" >&2; exit 1; }
    DIGEST_REF="$(docker image inspect "$VLLM_IMAGE" --format '{{index .RepoDigests 0}}')"
    test -n "$DIGEST_REF" && test "$DIGEST_REF" != '<no value>'
    printf '%s\n' "$DIGEST_REF" > "$MANIFEST_DIR/image-ref.txt"
    docker image inspect "$DIGEST_REF" > "$MANIFEST_DIR/image-inspect.json"
    echo "Pinned ARM64 image: $DIGEST_REF"
    ;;
  gate)
    require_setup
    IMAGE="$(image_ref)"
    docker run --rm --platform linux/arm64 --gpus all --entrypoint python3 "$IMAGE" -c \
      'import json,platform,torch; assert platform.machine()=="aarch64"; assert torch.cuda.is_available(); cap=torch.cuda.get_device_capability(); assert cap==(12,1), cap; a=torch.randn((2048,2048),device="cuda",dtype=torch.bfloat16); b=a@a; torch.cuda.synchronize(); assert torch.isfinite(b).all(); print(json.dumps({"machine":platform.machine(),"torch":torch.__version__,"cuda":torch.version.cuda,"device":torch.cuda.get_device_name(),"capability":cap,"bf16_matmul":"PASS"}))' \
      | tee "$MANIFEST_DIR/sm121-runtime-gate.json"
    echo 'PASS: actual BF16 CUDA operation executed at compute capability 12.1.'
    ;;
  download)
    require_setup
    IMAGE="$(image_ref)"
    docker run --rm --platform linux/arm64 \
      -e HF_HOME=/cache -e HF_HUB_DISABLE_TELEMETRY=1 \
      -e MODEL_HANDLE="$MODEL_HANDLE" -e MODEL_REVISION="$MODEL_REVISION" \
      -v "$CACHE_DIR:/cache" \
      --entrypoint python3 "$IMAGE" -c \
      'import os; from huggingface_hub import snapshot_download; p=snapshot_download(repo_id=os.environ["MODEL_HANDLE"],revision=os.environ["MODEL_REVISION"],cache_dir="/cache/hub"); print(p)' \
      | tee "$MANIFEST_DIR/model-download.txt"
    du -sh "$CACHE_DIR"
    echo 'Pinned public model snapshot downloaded into the Week 4 cache.'
    ;;
  serve)
    require_setup
    port_free || { echo "Host port $HOST_PORT is already in use; inspect it rather than killing anything." >&2; exit 1; }
    ! docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1 || { echo "Container $CONTAINER_NAME already exists. Use stop or inspect." >&2; exit 1; }
    IMAGE="$(image_ref)"
    docker run -d --name "$CONTAINER_NAME" --platform linux/arm64 \
      --gpus all --ipc host --ulimit memlock=-1 --ulimit stack=67108864 \
      -p "127.0.0.1:$HOST_PORT:8000" \
      -e HF_HOME=/cache -e HF_HUB_OFFLINE=1 -e HF_HUB_DISABLE_TELEMETRY=1 \
      -v "$CACHE_DIR:/cache" \
      --entrypoint '' "$IMAGE" \
      vllm serve "$MODEL_HANDLE" --revision "$MODEL_REVISION" \
        --served-model-name "$SERVED_MODEL_NAME" --host 0.0.0.0 --port 8000 \
        --dtype "$DTYPE" --max-model-len "$MAX_MODEL_LEN" \
        --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" --max-num-seqs "$MAX_NUM_SEQS" \
        --generation-config vllm > "$MANIFEST_DIR/container-id.txt"
    timeout 1200 bash -c "until curl -fsS http://127.0.0.1:$HOST_PORT/health >/dev/null; do sleep 10; done" || {
      docker logs "$CONTAINER_NAME" > "$WORK_DIR/logs/startup-failed.log" 2>&1 || true
      echo 'Server did not become healthy; logs saved. Run stop.' >&2; exit 1;
    }
    docker logs "$CONTAINER_NAME" > "$WORK_DIR/logs/server-startup.log" 2>&1
    docker inspect "$CONTAINER_NAME" > "$MANIFEST_DIR/container-inspect.json"
    docker exec "$CONTAINER_NAME" python3 -c 'import json,torch,vllm,transformers; print(json.dumps({"torch":torch.__version__,"cuda":torch.version.cuda,"vllm":vllm.__version__,"transformers":transformers.__version__,"capability":torch.cuda.get_device_capability()}))' \
      | tee "$MANIFEST_DIR/runtime-versions.json"
    echo "Healthy localhost endpoint: http://127.0.0.1:$HOST_PORT"
    ;;
  smoke)
    require_setup
    curl -fsS "http://127.0.0.1:$HOST_PORT/v1/chat/completions" \
      -H 'Content-Type: application/json' \
      -d '{"model":"'"$SERVED_MODEL_NAME"'","messages":[{"role":"user","content":"Return only {\"status\":\"ok\"}."}],"temperature":0,"max_tokens":32}' \
      | tee "$WORK_DIR/logs/smoke-response.json"
    python3 -m json.tool "$WORK_DIR/logs/smoke-response.json" >/dev/null
    echo 'PASS: API returned valid JSON. Inspect assistant content before benchmarking.'
    ;;
  benchmark)
    require_setup
    RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$CONFIG_FILE" .env)"
    OUT="$RESULTS_DIR/$RUN_ID"
    bash scripts/monitor.sh "$OUT.telemetry.csv" & MONITOR_PID=$!
    trap 'kill "$MONITOR_PID" 2>/dev/null || true; wait "$MONITOR_PID" 2>/dev/null || true' EXIT INT TERM
    python3 scripts/benchmark.py \
      --url "http://127.0.0.1:$HOST_PORT/v1/chat/completions" \
      --model "$SERVED_MODEL_NAME" --prompts data/prompts.jsonl --out "$OUT" \
      --concurrency "$BENCHMARK_CONCURRENCY" --requests "$REQUESTS_PER_LEVEL" \
      --repetitions "$REPETITIONS" --max-tokens "$MAX_TOKENS" --temperature "$TEMPERATURE"
    kill "$MONITOR_PID" 2>/dev/null || true; wait "$MONITOR_PID" 2>/dev/null || true; trap - EXIT INT TERM
    mv "$OUT.telemetry.csv" "$OUT/telemetry.csv"
    printf '%s\n' "$RUN_ID" > "$MANIFEST_DIR/last-run.txt"
    docker logs "$CONTAINER_NAME" > "$OUT/server.log" 2>&1
    echo "Complete: $OUT"
    ;;
  inspect)
    require_setup
    RUN_ID="$(cat "$MANIFEST_DIR/last-run.txt")"
    test "$(basename -- "$RUN_ID")" = "$RUN_ID"
    python3 -m json.tool "$RESULTS_DIR/$RUN_ID/summary.json"
    ;;
  test)
    python3 -m unittest discover -s tests -v
    ;;
  export)
    require_setup
    RUN_ID="$(cat "$MANIFEST_DIR/last-run.txt")"
    test "$(basename -- "$RUN_ID")" = "$RUN_ID"
    python3 scripts/export_run.py --source "$SOURCE_DIR" --work "$WORK_DIR" --run-id "$RUN_ID"
    ;;
  stop)
    if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      docker stop --time 30 "$CONTAINER_NAME" >/dev/null || true
      docker rm "$CONTAINER_NAME" >/dev/null
      echo "Stopped and removed container $CONTAINER_NAME; results/cache preserved."
    else
      echo "Container $CONTAINER_NAME is not present; nothing changed."
    fi
    ;;
  status)
    require_setup
    docker ps -a --filter "name=^/${CONTAINER_NAME}$"
    ss -ltnp "sport = :$HOST_PORT" || true
    du -sh "$WORK_DIR"/* 2>/dev/null || true
    ;;
  *)
    echo 'Usage: bash run_week04.sh {setup|preflight|pull|gate|download|serve|smoke|benchmark|inspect|test|export|status|stop}'
    echo 'Reduced path: PGX4_CONFIG_FILE=configs/reduced.env bash run_week04.sh <command>'
    ;;
esac
