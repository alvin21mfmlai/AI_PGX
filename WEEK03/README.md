# PGX-52 Week 3 — Local LLM inference and structured-response baseline

Experiment period: **21–27 September 2026**. Week 1 began on 7 September; this is `(21 Sep − 7 Sep)/7 + 1 = Week 3`.

**Start with [START_HERE.md](START_HERE.md)** for the ordered Linux commands and first checkpoint. This reviewed package preserves the original model, source pin, prompts and configurations. Scoring/reporting corrections are recorded in `VALIDATION.md`.

**Package revision: 24 September 2026.** The final archive is `WEEK03.zip`, containing one `WEEK03/` folder. It fixes the premature GPU-build exit and adds an actionable missing-model message. If you already work in `~/Desktop/AI_PGX/WEEK03`, use the update procedure below; new installations start at Section 4.1.

## 0. Update your existing WEEK03 folder and resume

The observed failure had two causes: `build-gpu` stopped after printing the NVCC path because the old launcher searched its architecture list for `sm_121a`; the subsequent benchmark found no downloaded GGUF file. NVIDIA documents that `--list-gpu-code` lists non-architecture-specific targets, so absence of `sm_121a` there is not a compatibility test. The corrected launcher prints the compiler version and requires actual `-arch=sm_121a` compilation and capability-12.1 execution. [NVCC option documentation](https://docs.nvidia.com/cuda/cuda-compiler-driver-nvcc/index.html#list-gpu-code-code-ls)

Download this revision as `~/Downloads/WEEK03.zip`. The archive contains source and instructions; the model is downloaded separately by the `model` command. If your browser changes the filename, adjust the archive path below. Stop any active Week 3 benchmark or demo before updating.

HOST — your normal user; this stages the update, verifies it, backs up the existing source, and copies only the revised launcher, Python code, tests and documentation:

```bash
(
  set -euo pipefail
  PGX_UPDATE="$(mktemp -d "$HOME/PGX52-Week03-update.XXXXXX")"
  python3 -m zipfile -e "$HOME/Downloads/WEEK03.zip" "$PGX_UPDATE"
  cd "$PGX_UPDATE/WEEK03"
  sha256sum -c SOURCE_SHA256SUMS.txt

  PGX_CURRENT="$HOME/Desktop/AI_PGX/WEEK03"
  test -f "$PGX_CURRENT/run_week03.sh"
  # Keep the same pinned model and upstream runtime.
  cmp locks.json "$PGX_CURRENT/locks.json"
  PGX_BACKUP="$(mktemp -d "$PGX_CURRENT/source-backup-20260924.XXXXXX")"
  cp -a "$PGX_CURRENT/run_week03.sh" "$PGX_CURRENT/scripts" \
    "$PGX_CURRENT/tests" "$PGX_CURRENT/README.md" "$PGX_BACKUP/"
  for PGX_DOC in START_HERE.md VALIDATION.md SOURCE_SHA256SUMS.txt; do
    if test -f "$PGX_CURRENT/$PGX_DOC"; then
      cp -p "$PGX_CURRENT/$PGX_DOC" "$PGX_BACKUP/"
    fi
  done

  cp -p run_week03.sh README.md START_HERE.md VALIDATION.md \
    SOURCE_SHA256SUMS.txt "$PGX_CURRENT/"
  cp -p scripts/week03.py "$PGX_CURRENT/scripts/"
  cp -p tests/*.py "$PGX_CURRENT/tests/"
  printf 'Updated: %s\nSource backup: %s\n' "$PGX_CURRENT" "$PGX_BACKUP"
)
```

This procedure preserves `models/`, `vendor/`, `runs/`, `exports/`, `manifests/`, `.venv/`, `locks.json`, `configs/` and `checkin.json`. It requires the existing source tree from the previous package. If any command fails, stop and share the output. Package checksums are verified in the clean staging directory; after your own check-in/configuration edits, those entries will legitimately differ in the working directory.

HOST — after the update succeeds, resume in the existing directory:

```bash
cd "$HOME/Desktop/AI_PGX/WEEK03" &&
source .venv/bin/activate &&
bash run_week03.sh source &&
bash run_week03.sh model &&
bash run_week03.sh test &&
bash run_week03.sh build-gpu &&
bash run_week03.sh run configs/reduced.json
```

The `&&` chain stops on the first failure. Expect the model SHA-256 confirmation, passing harness tests, `capability=12.1`, `SM121 CUDA smoke PASS`, `gpu build complete`, and finally a new run directory with `Complete: True`. The model command verifies an existing completed checkpoint or resumes its partial download; it does not download another copy when the correct file is already present. After a successful reduced run, continue at Section 4.7 for the full comparison.

## 1. Check-in and scope

Before execution, record: **What did I complete? What failed? Do I want to continue, reduce, or advance?** These are self-check prompts; you do not need to wait for a reply to use the package. Edit `checkin.json` with your answers.

Known evidence: Week 1 numerical correctness passed, while BF16 throughput variability was about 20%, above its 10% target. Week 2 observability results are documented separately; this package does not use them to infer Week 3 performance or energy.

The roadmap reserves Weeks 1–4 for the local AI platform. This chat continues the selected Week 3 experiment: local LLM inference and structured-response benchmarking.

- **Reduce — default:** use `configs/reduced.json`: one small model, GPU smoke benchmark, 3 repetitions, 4 quality cases. If CUDA is blocked, use the explicit CPU fallback. This is not enough evidence to accept the full hypothesis.
- **Continue:** once the native GPU gate passes and time permits, use `configs/full.json`: CPU versus GPU, 10 repetitions per microbenchmark, 12 quality cases per backend.
- **Advance:** finish the full baseline, then repeat the exact full configuration on a second day to assess between-run variability. Do not add bigger models, quantization comparisons, agents or new servers this week.

If Week 2 remains unfinished, budget 30–60 minutes to record its blocker before starting. Preserve its original files, container and result directories. Week 3's runtime is intentionally native llama.cpp for inference; this does not replace or modify Week 2's PyTorch environment.

## 2. Experiment specification

| Item | Definition |
|---|---|
| Objective | Establish a small, reproducible local LLM endpoint and quantify CPU/GPU inference throughput, stability and strict JSON output correctness. |
| Primary falsifiable hypothesis | At the pinned Q4_K_M checkpoint, fixed 8 threads and full config, GPU median synthetic generation throughput is at least 1.5× the CPU median. A smaller ratio falsifies the hypothesis for this configuration; a reduced/CPU-only run leaves it untested. |
| Secondary quality target | At least 11 of 12 correct strict JSON responses on each backend; arithmetic, exact keys/types and `leak_confirmed=false` are checked. No grammar constraint is used to hide formatting failures. |
| Stability target | Sample coefficient of variation `100 × sample SD / mean` ≤10% for each 10-sample prompt-processing and generation group. Keep failures; do not remove slow trials. This is not necessarily the same variability formula used in Week 1. |
| Infrastructure success | Pinned source/model checks pass; capability 12.1 CUDA gate executes; CUDA model offload appears in logs; all trials finish with finite positive metrics; localhost endpoint works; export is reproducible. GPU build success alone is insufficient. |
| Artifact | Complete source/config package plus a private run archive containing raw timings, raw requests/responses, summaries, telemetry, manifests and failure evidence. Publish a redacted result subset and a short demo. |
| Model | Official `Qwen/Qwen2.5-1.5B-Instruct-GGUF`, `qwen2.5-1.5b-instruct-q4_k_m.gguf`, revision and SHA-256 in `locks.json`; Apache-2.0. Small by design, not a claim that this is the newest/best model. |
| Data | 12 generated synthetic utility-accounting prompts (CC0-1.0; see LICENSING.md) plus llama-bench synthetic token sequences. No customer data or external dataset. |
| Runtime | Native Arm64 llama.cpp, pinned source, CUDA SM121a build; separate CPU-only build. Standard-library Python harness in an isolated venv; no PyTorch, Transformers, FlashAttention, vLLM or binary Python wheels. |
| Estimate | 4–6 hours hands-on for full week; reduced path 45–90 minutes plus compilation/downloads. Allow 10–30 minutes build time per backend, potentially longer on a changed compiler. Typical expected working set under 8 GiB for this small model/config; estimate, not a measured ceiling. Reserve ≥16 GiB available system memory and ≥20 GiB disk. Model download is about 1.12 GB; allow several additional GB for source/builds. |

This week balances general local-AI engineering with your signature tracks through synthetic utility prompts. It prepares an inference component for future RAG, time-series and defensive-agent work. It is not FHE, confidential RAG, a calibrated leak detector, or a validated operational decision system.

## 3. Compatibility decision and source verification — 21 September 2026

NVIDIA's current Spark llama.cpp guide explicitly builds for `121a-real`. We follow that native-source approach, disable RPC, bind to loopback, and use a much smaller official checkpoint. Generic “Blackwell-compatible” binaries are not accepted as proof of SM121 support. [Official NVIDIA Spark instructions](https://build.nvidia.com/spark/llama-cpp/instructions)

Runtime pin: `llama.cpp b11064`, commit `a894dae939d426954ce54bb604824f1ae918a0c5`, shown by upstream as a **pre-release on 20 September 2026**. It is an immutable experiment candidate, not a vendor-certified combination or a stability guarantee. Its build, server and benchmark interfaces were checked; actual PGX compilation and execution must pass locally. [Upstream release](https://github.com/ggml-org/llama.cpp/releases/tag/b11064), [pinned build guide](https://github.com/ggml-org/llama.cpp/blob/b11064/docs/build.md)

The model revision is `91cad51170dc346986eccefdc2dd33a9da36ead9`. The specific Q4_K_M file is about 1.12 GB, with SHA-256 `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`. Both are locked before execution. [Official model card](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF), [file checksum](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/main/qwen2.5-1.5b-instruct-q4_k_m.gguf)

NVIDIA's release notes, updated 10 September 2026, list Founders Edition DGX OS 7.5.0, driver 580.159.03 and CUDA 13.0.2, but explicitly warn that partner GB10 updates may differ. **Do not force that OS/driver stack onto the Lenovo.** Record its installed stack and require successful compilation and execution of the SM121a gate on the actual machine. [DGX Spark release notes](https://docs.nvidia.com/dgx/dgx-spark/release-notes.html)

The NVIDIA compiler documentation distinguishes architecture-specific targets; an architecture-specific binary cannot be assumed portable to every Blackwell GPU. The gate compiles and runs an actual SM121a kernel, followed by real quantized-model inference. The first gate does not establish correctness of every model kernel. [NVCC architecture options](https://docs.nvidia.com/cuda/cuda-compiler-driver-nvcc/index.html)

For continuity, NVIDIA documents `nvcr.io/nvidia/pytorch:25.11-py3` as CUDA 13.0.2 with its PyTorch 2.10 development build. That image is **not required or modified** this week. It does not prove compatibility of arbitrary extensions. No new exact PyTorch/Transformers/vLLM version is recommended. [NVIDIA PyTorch 25.11 notes](https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-25-11.html)

All commands below are **HOST commands**, run on the PGX as your normal user. There is no container shell in the selected official-native workflow; do not run them inside the Week 2 container. The venv isolates the Python harness, while C++ binaries remain under this project's pinned source directory. Avoid introducing a second container path until a specific blocker justifies it.

## 4. Ordered execution playbook

### 4.1 Extract the whole package into a fresh directory

Download `WEEK03.zip` into your PGX `~/Downloads`. The filename and destination below are literal, not placeholders. Keep the source folder and companion files together. No existing Week 1/2 directory is touched. For your already-extracted installation, use Section 0 instead.

HOST — new terminal:

```bash
test -f "$HOME/Downloads/WEEK03.zip" &&
PGX_EXTRACT="$(mktemp -d "$HOME/PGX52-Week03.XXXXXX")" &&
python3 -m zipfile -e "$HOME/Downloads/WEEK03.zip" "$PGX_EXTRACT" &&
cd "$PGX_EXTRACT/WEEK03" &&
export PGX3_ROOT="$PWD" &&
printf '%s\n' "$PGX3_ROOT" &&
sha256sum -c SOURCE_SHA256SUMS.txt
```

Expected: checksums report `OK`. Save the printed absolute directory for resume. If anything fails, stop at that step. Do not copy only `run_week03.sh`.

### 4.2 Check installed software, install ordinary build tools, isolate the harness

HOST — same terminal, project root:

```bash
uname -m
cat /etc/os-release
nvidia-smi
command -v nvcc
nvcc --version
free -h
df -h .
```

Expected: `aarch64`, DGX OS/Ubuntu, GB10, a working driver and an available CUDA compiler. `nvidia-smi`'s CUDA heading is a driver capability indication, not proof of the installed `nvcc` version. If `nvcc` is absent, skip GPU build and use CPU fallback until the Lenovo-supported toolkit path is resolved; do not install a random Ubuntu CUDA metapackage.

HOST — install only build/userland dependencies; these commands require sudo locally, not root execution of the experiment:

```bash
sudo apt-get update &&
sudo apt-get install -y --no-install-recommends \
  build-essential git cmake curl ca-certificates libcurl4-openssl-dev \
  libssl-dev python3 python3-venv
```

Expected: signed Ubuntu/DGX repositories provide native Arm64 tools. This does not request a full OS upgrade or install/change GPU drivers. If apt proposes removing the NVIDIA stack, cancel and inspect before proceeding. Package versions depend on the installed Lenovo distribution; the next step captures them exactly rather than guessing a cross-distribution version pin.

HOST — new isolated standard-library environment; no pip installation or network packages:

```bash
test ! -e .venv && python3 -m venv --without-pip .venv
source .venv/bin/activate
export LC_ALL=C.UTF-8
export OMP_NUM_THREADS=8
export CUDA_VISIBLE_DEVICES=0
export HF_HUB_OFFLINE=1
export HF_HUB_DISABLE_TELEMETRY=1
unset GGML_CUDA_ENABLE_UNIFIED_MEMORY
bash run_week03.sh preflight
python3 -c 'import sys,platform; print(sys.executable); print(sys.version); print(platform.machine())'
```

Expected: host manifest in `manifests/`, ≥20 GiB free disk, Python in `.venv`. On resume, only activate the existing `.venv`; do not recreate it. The harness has zero third-party Python dependencies. Host packages/interpreter are captured, not bit-for-bit frozen; a future host update requires a newly labelled baseline and manifest.

### 4.3 Record your check-in and inspect configurations

HOST — same root:

```bash
python3 -m json.tool checkin.json
python3 -m json.tool configs/reduced.json
python3 -m json.tool configs/full.json
python3 -m json.tool locks.json
```

Edit `checkin.json` in your preferred text editor to record completed work, failed commands, and scope. Keep `reduce` if uncertain. The full configuration explicitly fixes CPU/GPU order, threads, prompt/generation tokens, batch sizes and repetition count. Quality responses always have a 128-token upper limit, even in reduced mode, to avoid measuring truncation as a smaller-model fallback. All measurement runs create new uniquely named directories.

Expected: valid JSON. Do not tune values after seeing results without preserving the original and labelling a separate comparison.

### 4.4 Acquire exact upstream source and model

HOST — root; internet needed only for these downloads/build dependencies:

```bash
bash run_week03.sh source &&
bash run_week03.sh model &&
bash run_week03.sh test
```

Expected: exact 40-character source commit check succeeds; official model checksum matches; licence and model card retained; unit tests pass. Model download uses pinned HTTPS URLs, not `latest`, auto-updating `-hf`, or a third-party reupload. There is no login requirement for this public checkpoint and no token should be entered into logs. Incomplete downloads remain `.part` files and can resume. A checksum mismatch fails closed without overwriting an existing final model.

### 4.5 Build native GPU binaries and prove capability 12.1

HOST — root:

```bash
bash run_week03.sh build-gpu
```

The launcher runs these operations in order: verifies pinned clean source; locates NVCC and prints its version; compiles `scripts/gpu_gate.cu` using `-arch=sm_121a`; executes its exact-result CUDA kernel; configures CMake with `GGML_CUDA=ON`, `CMAKE_CUDA_ARCHITECTURES=121a-real`, `GGML_NATIVE=ON`, RPC off; builds server and benchmark using four compile jobs; records compiler settings and binary help/version output. It does not search `--list-gpu-code` for an architecture-specific target. The server uses an explicit local model path and `--offline` at runtime. Download capability is not claimed to be removed from the binary; the earlier `GGML_CURL=OFF` flag was not a supported control in the pinned build.

Expected: `capability=12.1`, `SM121 CUDA smoke PASS`, successful GPU build. Compiler version is retained in `manifests/nvcc-version.txt`; CUDA-gate compiler output is in `manifests/gpu-gate-build.log`, and gate execution output is in `manifests/gpu-gate.txt`. A failed gate prints a stage-specific error and stops before CMake. For the main build, check `manifests/configure-gpu.log`, `build-gpu.log`, and `CMakeCache-gpu.txt`. CMake warnings about unused manually specified variables are evidence to inspect, not something to hide. If any gate fails, do not retarget to SM120 or pull an arbitrary Blackwell wheel. Use the CPU fallback and retain the failure.

This is a source pin with hardware execution gates, not a claim that this package was GPU-tested remotely. First compilation may expose upstream pre-release regressions; do not silently update its commit.

### 4.6 Reduced run — recommended first

HOST — root:

```bash
bash run_week03.sh run configs/reduced.json
```

Expected: `Complete: True` and a new `runs/<run-id>` path. Three prompt-processing and generation timing samples, four quality responses plus one unscored warm-up response, telemetry and summaries are saved. The server is started for evaluation on `127.0.0.1:8083` and stopped afterward. An existing listener on this port produces a failure; it is not killed or reused. There is no persistent service to accidentally leave running after normal completion.

The microbenchmark warms up via llama-bench defaults. It excludes tokenization/sampling, and its separate pp/tg numbers are not end-to-end request throughput. API response wall time is measured separately and includes request/serialization work; it is **not TTFT** because the client is nonstreaming. Output length varies for quality cases. [Pinned benchmark definitions](https://github.com/ggml-org/llama.cpp/blob/b11064/tools/llama-bench/README.md)

Expected GPU log evidence: CUDA backend and model layers offloaded to GPU. The script verifies the benchmark's CUDA backend field, but manually inspect the offload count in `bench-gpu.log`/`server-gpu.log`; a CUDA-capable build alone does not establish full offload. Prompt-cache reuse is disabled in API requests; inspect raw response timing/cache fields before interpreting repeated request timings. [Pinned server API](https://github.com/ggml-org/llama.cpp/blob/b11064/tools/server/README.md)

### 4.7 Full CPU/GPU comparison

Only after reduced execution succeeds, select **continue** in the check-in and build the separate CPU binary.

HOST — root:

```bash
bash run_week03.sh build-cpu &&
bash run_week03.sh run configs/full.json
```

Expected: ten samples each for CPU pp, CPU tg, GPU pp and GPU tg; 12 scored cases per backend; ratio and hypotheses in `summary.json`. One unscored API warm-up precedes each backend's quality tests. GPU and CPU binaries share the exact source/checkpoint but use their respective backends. Flash attention is off, GPU layers fixed to 99 (all available layers), auto-fit off, single request slot, f16 KV defaults captured in binary help. The test has no model training and no optimizer state.

CPU is measured first for simplicity, so order/thermal state is a limitation. Record idle time, ambient temperature and competing workload state; repeat the unchanged full run on another day before claiming a stable speedup. Do not compare Week 1 synthetic GEMM TFLOP/s directly with LLM tokens/s.

### 4.8 Monitoring and interpreting results

The harness samples `MemAvailable` and optional NVIDIA temperature/utilization/power readings roughly every two seconds, throughout both CPU and GPU work. Failed/unsupported power fields stay raw or missing; the program does **not** manufacture energy values or report wall-socket energy. Week 2 can provide an independently validated energy pipeline later. Host monitoring adds overhead to both modes and is not a monitor-on/off experiment here.

HOST — second terminal, read-only during a run:

```bash
free -h
vmstat 2 5
nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,power.draw --format=csv
ss -ltnp 'sport = :8083'
```

Expected: localhost-only port while evaluation runs; ample system memory; no sustained swap thrashing. Unified CPU/GPU memory is shared, so do not add reported CPU and GPU allocations as if they were disjoint. The initial 16 GiB available-memory gate is not a runtime hard cap; if memory collapses, stop with Ctrl+C. Do not change swap policy, drop global caches, overclock, lock clocks, kill other users' processes, or run full benchmarking while another training job is active.

HOST — original terminal after completion:

```bash
RUN_ID="$(<manifests/last-run.txt)"
test "$(basename -- "$RUN_ID")" = "$RUN_ID" &&
python3 -m json.tool "runs/$RUN_ID/summary.json"
```

Expected: `complete=true` only means the workflow finished. Read `hypothesis_speedup_ge_1_5`, quality and stability separately. A `null` target result means the selected scope did not test it. Reduced runs retain measured CV values but do not receive a ten-sample stability pass. Custom CPU/GPU settings retain the observed speedup but do not satisfy the fixed full-protocol hypothesis. A failed quality case may be a genuine model limitation. Examine the raw response before changing prompts. Do not use only the best run or silently discard outliers.

Each raw quality record includes `score_details`: `strict_json_valid`, `schema_valid`, `values_correct`, and `pass`. The quality summary counts the first three across scored responses, excluding the warm-up, alongside `correct`, `total`, and `accuracy`. Duplicate keys and nonstandard NaN/Infinity literals fail strict parsing. Valid JSON can still fail schema or value checks; the combined target remains at least 11 fully correct responses out of 12. Since the prompts explicitly prescribe `leak_confirmed=false`, this evaluates instruction following, arithmetic and formatting, not independent leak diagnosis.

### 4.9 Export and capture reproducibility

HOST — root:

```bash
bash run_week03.sh export
```

Expected: a ZIP under `exports/` and its SHA-256 printed in the terminal. Export includes source/configs/tests, guides, check-in, raw current-run responses/timings, summary JSON/CSV, host/compiler manifests and per-file checksums. It excludes model weights, cloned upstream code, build products, `.venv`, credentials and unrelated run folders. Export is capped at 100 MiB and never overwrites an existing archive. Partial failed runs can be exported; `complete=false` is preserved.

The build command automatically captures exact binary hashes and linkage in `manifests/binary-<mode>-sha256.txt` and `manifests/linkage-<mode>.txt`. To inspect them manually after both builds:

HOST — root:

```bash
sha256sum vendor/llama.cpp/build-cpu/bin/llama-server \
  vendor/llama.cpp/build-cpu/bin/llama-bench \
  vendor/llama.cpp/build-gpu/bin/llama-server \
  vendor/llama.cpp/build-gpu/bin/llama-bench
ldd vendor/llama.cpp/build-gpu/bin/llama-server
```

If you only built one mode, run the commands on that mode's existing binaries only. The source revision/model hash and installed package manifest enable reconstruction; exact binary reproducibility is not promised across host updates or compilers. Keep the raw archive privately, and review/redact local paths and device metadata before publishing. GitHub upload is not performed by this playbook.

## 5. Explicit CPU fallback

If the CUDA compiler, driver or model kernels fail, preserve the error and select `configs/cpu.json`; **do not claim GPU success**. This uses the same already-small 1.5B quantized model to isolate runtime failures rather than changing checkpoint, licence and task simultaneously.

HOST — root, no GPU toolkit needed for these build/run commands:

```bash
bash run_week03.sh source &&
bash run_week03.sh model &&
bash run_week03.sh build-cpu &&
bash run_week03.sh run configs/cpu.json &&
bash run_week03.sh export
```

Expected: CPU-only source build and 3-repetition smoke run with 4 quality cases. The GPU speedup hypothesis remains untested. Reduced context/batch settings limit resource demands. If the model cannot download at all, run unit tests and document the acquisition blocker; synthetic test fixtures are not inference results.

## 6. Troubleshooting — one observed failure at a time

| Symptom | Diagnostic commands (HOST, project root) | Likely cause | Safe fix |
|---|---|---|---|
| `Model file is missing` / old `FileNotFoundError` for the GGUF | `ls -lh models`; `python3 -m json.tool locks.json` | The pinned model was not downloaded successfully in this project | Run `bash run_week03.sh model`; wait for the checksum confirmation, then build and run using `&&`. A ZIP containing source code does not contain model weights. |
| Old `build-gpu` prints only the NVCC path and returns | inspect the launcher for `grep -Fx sm_121a`; `nvcc --version` | The earlier launcher used an invalid architecture-list check | Apply this package's Section 0 update. The fixed launcher tests actual SM121a compilation and execution. Absence of `sm_121a` from `--list-gpu-code` is not proof of incompatibility. |
| Arm64 wheel or `Exec format error` | `uname -m`; `file vendor/llama.cpp/build-gpu/bin/llama-server`; `python3 -c 'import platform; print(platform.machine())'` | x86 binary/wheel or execution inside the wrong environment | This workflow needs no wheels. Exit any Week 2 container and build natively. Do not emulate x86 for a PGX benchmark. |
| `nvcc` absent / driver mismatch | `command -v nvcc`; `nvcc --version`; `nvidia-smi`; `readlink -f /usr/local/cuda` | Toolkit not on PATH, or unsupported Lenovo stack | Use the installed Lenovo-supported toolkit if present; otherwise CPU fallback. Do not independently upgrade drivers/CUDA mid-experiment. |
| Container sees no GPU during separate Week 2 work | `docker version`; `docker info`; `nvidia-container-cli --version`; `nvidia-smi` | Runtime registration, stale image or driver integration | Keep this Week 3 native run separate. Diagnose Week 2 with its exact pinned image and command; do not replace it automatically or change Docker permissions broadly. |
| `Unsupported gpu architecture compute_121a`, CMake architecture rejection | `nvcc --version`; `cmake --version`; inspect the actual gate compiler error and `manifests/configure-gpu.log` | Compiler/CMake does not support the exact target, or a different toolkit is selected | Stop GPU path. Use CPU fallback; consult Lenovo-supported updates separately. Do not relabel SM120 as SM121 or diagnose support from `--list-gpu-code` alone. |
| `no kernel image`, illegal instruction, CUDA assert | inspect `manifests/gpu-gate.txt`, `runs/<RUN_ID>/bench-gpu.log`, and `server-gpu.log`; `ldd vendor/llama.cpp/build-gpu/bin/llama-server` | Wrong binary/backend, incompatible linked toolkit, or upstream quantized kernel bug | Preserve failed logs, verify source and model hashes, use CPU fallback. `<RUN_ID>` is the literal run folder printed by the launcher; substitute it before using this diagnostic path. Do not silently change source/quantization/flash-attention flags. |
| OOM, killed process, system unresponsive | `free -h`; `vmstat 2 5`; `journalctl -k -n 100 --no-pager` (if permitted) | Unified-memory pressure from workload or other processes | Ctrl+C this run. Close your own unnecessary applications, wait for memory to recover, use reduced/CPU config in a new run. Keep at least 16 GiB available before starting. No blanket `killall`, swap changes or global cache clearing. |
| Disk/cache exhausted | `df -h .`; `df -i .`; `du -sh models vendor runs exports` | Model partials/build output/log growth | Keep bounded outputs; archive first. Remove only a separately validated disposable file, as below. No `docker system prune` or deletion of shared HF caches. |
| Permission denied | `id`; `ls -ld . models vendor manifests`; `namei -l "$PWD"` | Extracted elsewhere/as root; read-only folder | Re-extract the complete package into a fresh user-owned directory. Do not `chmod -R 777` or `chown` broad directories. |
| Port 8083 busy | `ss -ltnp 'sport = :8083'` | Another local service or unfinished manual demo | Stop only your known foreground demo with Ctrl+C. Otherwise record the conflict; choose a new explicit port in a copied config and label the changed run. Do not kill unknown listeners. |
| Download 401/403/404, TLS error, checksum mismatch | `curl -I https://huggingface.co`; `date -u`; `python3 -m json.tool locks.json`; inspect exact curl output | Proxy/network, clock, service issue, incomplete/wrong checkpoint | Public checkpoint should not need auth. Retry the same pinned acquisition; keep TLS verification on. Never paste tokens. Do not substitute a random mirror or pass `curl -k`. Preserve checksum-mismatched files for diagnosis. |
| Poor GPU throughput / high CV | `free -h`; `vmstat 2 5`; `nvidia-smi`; inspect actual offload count, raw `samples_ts`, config and CPU/GPU logs | CPU fallback, partial offload, competing activity, small workload overhead, thermal effects | Verify actual backend first, then rerun unchanged after an idle interval. Keep all trials and failed stability checks. No expected vendor TOPS-to-tokens/s conversion. |
| JSON scores fail, text is fenced/truncated | inspect `quality-<mode>-NN.json`, especially content/finish reason | Small-model limitations, exact-format failure or generation cap | Preserve the failure. Strict raw JSON is intentional. Don't strip fences only for some runs or silently raise the token cap. A revised task must be separately labelled. |
| `Missing companion file` | `ls scripts configs tests`; `sha256sum -c SOURCE_SHA256SUMS.txt` | Only launcher copied or partial extraction | Extract the whole ZIP beside its folders; same lesson as Week 1's missing script. |

## 7. One-week work breakdown

- **Mon 21 Sep:** record Week 2 status; choose scope; preflight, licences, source/model lock and tests (45–60 min).
- **Tue 22 Sep:** native CUDA gate/build; reduced smoke run or explicitly labelled CPU fallback (45–60 min plus build time).
- **Wed 23 Sep:** full CPU/GPU comparison if gates pass; inspect raw timing and offload evidence (45–60 min).
- **Thu 24 Sep:** inspect every quality failure, shared-memory telemetry and timing definitions; do not expand scope (30–45 min).
- **Fri 25 Sep:** repeat the unchanged full configuration, compare variability across runs, record environmental differences (30–45 min).
- **Sat 26 Sep:** prepare one chart, risk card, README and 2–3 minute demo (45–60 min).
- **Sun 27 Sep:** export and audit reproducibility/licensing; publish only reviewed results; record next week's scope (30 min).

If time is limited, finishing the reduced path with honest failure evidence is a worthwhile Week 3 artifact. The calendar week advances even if the experiment is carried forward.

## 8. Publication checklist

Suggested repository subtree (copy reviewed content into your existing GitHub workflow; this package does not push anything):

```text
week03-local-llm/
  README.md
  LICENSING.md
  locks.json
  checkin.json
  run_week03.sh
  scripts/             # runner + GPU gate
  configs/             # full, reduced, CPU fallback
  tests/
  public-results/      # only reviewed/redacted copies
    environment.txt
    config.json
    bench-cpu.json
    bench-gpu.json
    summary.csv
    summary.json
    throughput.png
    failure-cases.md
    risk-card.md
```

- **README outline:** question/hypothesis; hardware and versions; exact checkpoint/licence; scope; commands; measurements/definitions; results; failures; interpretation; limitations; reproduction; privacy/licensing.
- **Exact environment manifest:** OS/kernel/architecture, driver, real NVCC version, CMake/compiler/Python and dpkg versions, llama tag+full SHA, CMake cache and flags, binary hashes/linkage, model SHA/revision, source/config hashes, seeds, threads, timing/warm-up protocol, monitoring interval, UTC run dates. No dump of the entire environment or credentials.
- **Raw plus summarized evidence:** keep individual `samples_ts`, benchmark metadata, requests/responses, unmodified logs, telemetry, summary JSON/CSV and complete/failure state. Publish a redacted copy; retain private originals and document redactions.
- **One recommended chart:** two panels, prompt processing and generation. X-axis CPU/GPU, Y-axis tokens/s, all raw trial dots plus a median line and min/max whiskers. Label model, Q4_K_M, token counts, repetitions and monitoring state. Do not combine pp and tg as the same metric or display reduced-only data as CPU/GPU speedup.
- **2–3 minute demo:** 0:00–0:30 show PGX/specs and source/model locks; 0:30–1:00 show one localhost synthetic query; 1:00–1:45 show raw trials and summary; 1:45–2:15 show one failure/stability caveat; 2:15–2:45 explain privacy limits and relevance to future RAG/utility tools. Use recorded results for long runs; clearly label replayed output.
- **Failure cases:** include formatting errors, incorrect differences, unwarranted leak confirmation, slow trials, any GPU/compiler blocker and CPU fallback. Negative results are portfolio evidence.
- **Risk card:** use LICENSING.md; emphasize no customer data, no control actions, no agent privileges, no formal confidentiality guarantee and a narrow toy evaluation.
- **Concise blog outline:** why move from GEMM to an actual local LLM; choosing a small licensable checkpoint; proving SM121 compatibility; CPU/GPU measurements; strict JSON utility examples; what failed; reproducibility and next step.
- **Roadmap balance:** keep Weeks 1–4 focused on platform evidence; Weeks 5–12 cover training/NanoChat/quantization/serving; 13–20 RAG/MCP/agents; 21–28 vision/voice/video; 29–36 privacy; 37–44 cyber-defence; 45–50 time-series/digital twins; 51–52 integration. This one local LLM task supports these tracks without claiming to complete them.

## 9. Optional foreground localhost demo

After a successful GPU run, no benchmark should be active. This service is for one local user; it is not a secure multi-user deployment.

HOST — project root, terminal A:

```bash
vendor/llama.cpp/build-gpu/bin/llama-server \
  -m models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 --port 8083 --parallel 1 \
  -c 2048 -b 256 -ub 128 -t 8 -ngl 99 -fa off --fit off \
  --offline --alias pgx-week03
```

Expected: model loaded and localhost listening. Keep terminal A open; Ctrl+C stops this exact foreground service.

HOST — terminal B:

```bash
curl --fail --max-time 10 http://127.0.0.1:8083/health &&
curl --fail --max-time 180 http://127.0.0.1:8083/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"pgx-week03","messages":[{"role":"user","content":"Synthetic example: inflow 100 m3 and demand 70 m3. What is the difference, and does that alone confirm a leak?"}],"temperature":0,"seed":42,"max_tokens":128,"cache_prompt":false}'
```

Expected: health `ok` and JSON response envelope. A plausible answer is not proof of a confirmed leak. Stop the demo before benchmarking.

## 10. Safe stop, resume, checkpoint, rollback and cleanup

**Stop:** press Ctrl+C in the running benchmark terminal. The Python harness terminates only the child benchmark/server it created, waits, and saves a partial summary when possible. If the machine crashes or the process is externally killed, the newest run can lack a summary; retained raw files are incomplete evidence, never a pass. Do not use `pkill`, `killall`, or broad cleanup commands.

**Resume:** there is no model training checkpoint to restore. Builds can resume incrementally and model `.part` downloads can resume. Interrupted timed trials are not stitched into a successful run; restart the same selected config into a fresh run directory.

HOST — new terminal; the one placeholder below must be replaced with the absolute root printed in Step 4.1:

```bash
PGX3_ROOT='/REPLACE_WITH_THE_PRINTED_ABSOLUTE_WEEK03_ROOT'
test "$PGX3_ROOT" != '/REPLACE_WITH_THE_PRINTED_ABSOLUTE_WEEK03_ROOT' &&
test -f "$PGX3_ROOT/locks.json" &&
test -f "$PGX3_ROOT/scripts/week03.py" &&
cd "$PGX3_ROOT" &&
source .venv/bin/activate &&
bash run_week03.sh run configs/reduced.json
```

Expected: a newly named run using the preserved source/model. Choose `configs/full.json` or `configs/cpu.json` explicitly only if that was your selected scope.

**Checkpoint:** after a run or captured failure, run `bash run_week03.sh export`. The run config, source/model locks, raw outputs and summary are the experiment checkpoint. Keep the package ZIP and private result export separately from disposable build products.

**Rollback:** the experiment changes no GPU driver, firmware, global Python environment or Week 2 container. Stop its foreground services and run `deactivate` to leave the venv. Userland apt-installed packages remain; do not indiscriminately uninstall shared tools. To test a different runtime later, create a separate source/build directory and label the new baseline—never `git reset --hard` this one.

**Cleanup:** first export, inspect the ZIP and keep a copy. There is no automatic recursive deletion. To reclaim only an incomplete model download, use this exact validated path from the project root after confirming no acquisition is running:

HOST — project root:

```bash
python3 - <<'PY'
from pathlib import Path
import json
root = Path.cwd().resolve()
assert (root / 'scripts/week03.py').is_file()
lock = json.loads((root / 'locks.json').read_text())
assert lock['model_file'] == 'qwen2.5-1.5b-instruct-q4_k_m.gguf'
p = root / 'models/qwen2.5-1.5b-instruct-q4_k_m.gguf.part'
assert not p.is_symlink()
assert p.resolve().parent == root / 'models'
if p.is_file():
    print('Deleting only incomplete download:', p)
    p.unlink()
else:
    print('No incomplete model download to remove.')
PY
```

Expected: only the exact `.part` file is removed; the completed model, source, builds, results and previous weeks remain. To reclaim large completed artifacts, inspect specific paths and archive first; this playbook deliberately supplies no broad destructive command.

For live troubleshooting, paste the **section number, complete terminal command, and complete output** (redact credentials/private information). We will diagnose one observed step at a time without silently changing the experiment, checkpoint, runtime commit, precision or success criteria.
