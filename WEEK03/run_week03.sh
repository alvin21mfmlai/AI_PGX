#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT"
test -f locks.json && test -f scripts/week03.py && test -f scripts/gpu_gate.cu || { echo 'Extract the complete package.' >&2; exit 1; }
test "$(id -u)" -ne 0 || { echo 'Run as your normal user, not root.' >&2; exit 1; }
export LC_ALL=C.UTF-8
export OMP_NUM_THREADS=8
export CUDA_VISIBLE_DEVICES=0
export HF_HUB_OFFLINE=1
export HF_HUB_DISABLE_TELEMETRY=1
unset GGML_CUDA_ENABLE_UNIFIED_MEMORY
mkdir -p manifests models vendor runs exports build-gate
field() { python3 -c 'import json,sys;print(json.load(open("locks.json"))[sys.argv[1]])' "$1"; }
verify_source() {
  test "$(git -C vendor/llama.cpp rev-parse HEAD)" = "$(field llama_commit)"
  test -z "$(git -C vendor/llama.cpp status --porcelain --untracked-files=no)" || { echo 'Upstream source changed; stop.' >&2; exit 1; }
}
case "${1:-help}" in
  preflight)
    test "$(uname -m)" = aarch64 || { echo 'PGX execution requires native aarch64.' >&2; exit 1; }
    for tool in python3 git cmake c++ curl sha256sum; do command -v "$tool"; done
    {
      date -u +%FT%TZ; uname -srm; cat /etc/os-release
      lscpu; free -h; df -h "$ROOT"; df -i "$ROOT"
      cmake --version; c++ --version; python3 --version
      command -v nvcc && nvcc --version || true
      command -v nvidia-smi && nvidia-smi || true
      dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n'
    } > "manifests/host-$(date -u +%Y%m%dT%H%M%S).txt"
    python3 -c 'import shutil; assert shutil.disk_usage(".").free>20*1024**3,"Need at least 20 GiB free"'
    echo 'Host inventory captured. Check GPU/compiler gates next; no driver changes made.'
    ;;
  source)
    if test ! -e vendor/llama.cpp; then
      git clone --depth 1 --branch "$(field llama_tag)" https://github.com/ggml-org/llama.cpp.git vendor/llama.cpp
    fi
    verify_source
    git -C vendor/llama.cpp rev-parse HEAD > manifests/llama-commit.txt
    echo 'Exact upstream source pin verified.'
    ;;
  model)
    python3 scripts/week03.py acquire
    ;;
  build-cpu|build-gpu)
    verify_source
    MODE="${1#build-}"
    OPTS=(-DGGML_NATIVE=ON -DGGML_RPC=OFF -DGGML_CUDA=OFF -DCMAKE_BUILD_TYPE=Release)
    if test "$MODE" = gpu; then
      command -v nvcc || { echo 'CUDA compiler nvcc was not found on PATH. Use the installed Lenovo-supported toolkit or the CPU fallback.' >&2; exit 1; }
      nvcc --version 2>&1 | tee manifests/nvcc-version.txt
      echo 'Compiling the SM121a CUDA gate; actual compilation determines target support.'
      if ! nvcc -arch=sm_121a scripts/gpu_gate.cu -o build-gate/gpu-gate 2>&1 | tee manifests/gpu-gate-build.log; then
        echo 'SM121a CUDA gate compilation failed. Inspect manifests/gpu-gate-build.log; no llama.cpp build was started.' >&2
        exit 1
      fi
      echo 'Running the CUDA gate and checking device capability 12.1.'
      if ! build-gate/gpu-gate 2>&1 | tee manifests/gpu-gate.txt; then
        echo 'CUDA gate execution failed. Inspect manifests/gpu-gate.txt; no llama.cpp build was started.' >&2
        exit 1
      fi
      OPTS=(-DGGML_NATIVE=ON -DGGML_RPC=OFF -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121a-real -DCMAKE_BUILD_TYPE=Release)
    fi
    cmake -S vendor/llama.cpp -B "vendor/llama.cpp/build-$MODE" "${OPTS[@]}" 2>&1 | tee "manifests/configure-$MODE.log"
    cmake --build "vendor/llama.cpp/build-$MODE" --config Release --target llama-server llama-bench -j 4 2>&1 | tee "manifests/build-$MODE.log"
    cp "vendor/llama.cpp/build-$MODE/CMakeCache.txt" "manifests/CMakeCache-$MODE.txt"
    sha256sum "vendor/llama.cpp/build-$MODE/bin/llama-server" "vendor/llama.cpp/build-$MODE/bin/llama-bench" > "manifests/binary-$MODE-sha256.txt"
    ldd "vendor/llama.cpp/build-$MODE/bin/llama-server" > "manifests/linkage-$MODE.txt"
    "vendor/llama.cpp/build-$MODE/bin/llama-server" --version > "manifests/llama-$MODE-version.txt" 2>&1
    "vendor/llama.cpp/build-$MODE/bin/llama-server" --help > "manifests/server-$MODE-help.txt" 2>&1
    "vendor/llama.cpp/build-$MODE/bin/llama-bench" --help > "manifests/bench-$MODE-help.txt" 2>&1
    echo "$MODE build complete; real model execution remains the next gate."
    ;;
  test)
    python3 -m unittest discover -s tests -v
    ;;
  run)
    verify_source
    python3 scripts/week03.py run --config "${2:-configs/reduced.json}"
    ;;
  export)
    python3 scripts/week03.py export
    ;;
  *) echo 'Usage: bash run_week03.sh {preflight|source|model|build-cpu|build-gpu|test|run [configs/reduced.json]|export}';;
esac
