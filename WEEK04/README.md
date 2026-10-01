# PGX-52 Week 4 — Local vLLM serving and concurrency benchmark

Experiment period: **28 September–4 October 2026**. With 7 September 2026 as Week 1, this is Week 4.

## 1. Check-in and scope decision

Before execution, record these three items in `checkin.json`:

1. What did I complete in Weeks 1–3?
2. What failed or remains blocked?
3. Do I want to **continue**, **reduce**, or **advance**?

The package does not wait for an answer. Its default is **continue**, based on the evidence currently available: Week 1 correctness passed but stability did not; Week 2 GPU/energy completion has not been confirmed; Week 3 was delivered and later updated, but a successful final GPU run has not been reported here.

- **Continue — default:** run Qwen3-4B-Instruct-2507, concurrency 1/2/4/8, 24 requests per level and three repetitions.
- **Reduce:** use `configs/reduced.env`: Qwen3-0.6B, concurrency 1/2/4, eight requests and one repetition. This proves the serving path, not the full Week 4 hypothesis.
- **Advance:** complete the unchanged full run twice on separate days and compare the two exports. Do not add a larger model, remote exposure, speculative decoding or quantization until the baseline passes.

This closes the Weeks 1–4 local-platform block: Week 1 established compute correctness, Week 2 observability, Week 3 single-user local inference, and Week 4 a reusable OpenAI-compatible serving endpoint under controlled concurrency.

## 2. Experiment card

| Item | Definition |
|---|---|
| Objective | Deploy a reproducible, localhost-only vLLM endpoint on the Lenovo ThinkStation PGX and measure throughput, tail latency, stability and strict-JSON correctness as concurrency rises. |
| Falsifiable hypothesis | At concurrency 8, median aggregate completion-token throughput is at least **1.5×** concurrency 1, while median p95 request latency is no more than **4×** concurrency 1. The full run also requires 100% HTTP success, ≥90% strict-JSON accuracy at every concurrency and throughput CV ≤10% across three repetitions. |
| Portfolio artifact | Versioned source package, exact environment and container digest, raw response/telemetry JSONL/CSV, summary JSON/CSV, concurrency-throughput SVG, risk card, failure cases and a 2–3 minute localhost demo. |
| Primary model | `Qwen/Qwen3-4B-Instruct-2507` at revision `cdbee75f17c01a7cc42f958dc650907174af0554`; 4.0B parameters, BF16, Apache-2.0. |
| Reduced model | `Qwen/Qwen3-0.6B` at revision `c1899de289a04d12100db370d81485cdf75e47ca`; Apache-2.0. |
| Data | Eight original synthetic prompts in `data/prompts.jsonl`, released as CC0-1.0. No production water data, customer data, personal data or real cyber incident content. |
| Runtime | NVIDIA NGC `nvcr.io/nvidia/vllm:26.08-py3`, pulled for `linux/arm64` and then locked by registry digest. NVIDIA documents vLLM 0.27.1, CUDA 13.4.1, Torch 2.14.0 development build, Transformers 5.14.1 and FlashInfer 0.6.17 in this release. Installed versions are captured again from the running container. |
| Estimate | Full path: 2–4 hours hands-on plus a potentially 20–40 minute image pull and model download. Reduced path: 30–60 minutes plus downloads. Reserve ≥40 GiB free disk and ≥32 GiB available unified memory. Model weights are about 8 GB for the 4B BF16 checkpoint; the container and caches need substantially more. |
| Network | API is published only at `127.0.0.1:8004`. Model/image acquisition needs outbound access. No inbound LAN or Internet exposure is configured. |

Failure is a useful result. Do not drop slow requests, malformed JSON, startup errors or repetitions that miss the target. A reduced run does not test the full hypothesis.

## 3. Compatibility decision, verified 28 September 2026

NVIDIA's current DGX Spark vLLM playbook prescribes a containerized workflow, GPU runtime flags, an OpenAI-compatible endpoint and reduced `--gpu-memory-utilization` on unified-memory systems. It warns that Spark's CPU, GPU, operating system, model weights and KV cache share one 128 GB pool. This package starts at 0.70, caps context at 8,192 tokens and caps active sequences at eight. It does not use the generic vLLM default near 1.0. See [NVIDIA: Serve LLMs with vLLM](https://build.nvidia.com/spark/vllm/instructions) and [NVIDIA troubleshooting](https://build.nvidia.com/spark/vllm/troubleshooting).

NVIDIA's 26.08 release notes list vLLM 0.27.1 and CUDA 13.4.1 and repeat the unified-memory OOM warning. The package therefore pulls `nvcr.io/nvidia/vllm:26.08-py3`, verifies that Docker selected `linux/arm64`, records the immutable digest, and uses that digest for every later run. A mutable tag is never treated as the final environment identity. See [NVIDIA vLLM 26.08 release notes](https://docs.nvidia.com/deeplearning/frameworks/vllm-release-notes/rel-26-08.html).

The Qwen model card identifies the primary checkpoint as Apache-2.0, non-thinking, 4B parameters, and directly documents vLLM serving. The package pins the latest verified model revision shown on 28 September rather than `main`. See [Qwen3-4B-Instruct-2507 model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) and [pinned revision](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/tree/cdbee75f17c01a7cc42f958dc650907174af0554).

Arm64 alone is insufficient. Before downloading the model, `gate` runs an actual BF16 matrix multiplication inside the exact digest and requires `torch.cuda.get_device_capability() == (12, 1)`. It fails closed on a generic Blackwell image, CPU fallback, SM120 report or missing kernel. This confirms one real SM121 CUDA path; it does not prove every vLLM kernel correct. Model loading and API inference are separate gates.

Do **not** force NVIDIA Founders Edition driver, DGX OS or CUDA versions onto the Lenovo partner system. `nvidia-smi` reports the driver's supported CUDA level, not necessarily an installed toolkit. This playbook records the Lenovo stack and validates container compatibility empirically. It never runs a driver upgrade.

## 4. Package contents

```text
PGX52_Week04_vLLM_Serving/
├── README.md
├── LICENSING.md
├── checkin.json
├── configs/
│   ├── week04.env
│   └── reduced.env
├── data/prompts.jsonl
├── scripts/
│   ├── benchmark.py
│   ├── export_run.py
│   └── monitor.sh
├── tests/test_benchmark.py
├── run_week04.sh
└── SOURCE_SHA256SUMS.txt
```

The execution workspace defaults to `/AI_PGX/week04-vllm-serving`. The source package remains separate and immutable. If `/AI_PGX` is unavailable, the launcher accepts only `$HOME/AI_PGX/week04-vllm-serving` via `PGX4_WORK_DIR`; it rejects other paths to keep cleanup bounded.

## 5. Ordered Linux execution playbook

Every command in Sections 5.1–5.9 is a **HOST command** run in a PGX terminal as your normal user. Container commands are shown separately in Section 6 for inspection; normally use the launcher.

### 5.1 Extract the whole package and verify it

Assumption: the downloaded archive is exactly `PGX52_Week04_vLLM_Serving.zip` in `~/Downloads`.

HOST — new terminal:

```bash
PGX4_SOURCE_PARENT="$(mktemp -d "$HOME/PGX52-Week04.XXXXXX")" &&
python3 -m zipfile -e \
  "$HOME/Downloads/PGX52_Week04_vLLM_Serving.zip" "$PGX4_SOURCE_PARENT" &&
cd "$PGX4_SOURCE_PARENT/PGX52_Week04_vLLM_Serving" &&
sha256sum -c SOURCE_SHA256SUMS.txt
```

Expected checkpoint: every listed file reports `OK`. Keep the launcher and companion folders together. If extraction produces a different top-level directory, inspect the ZIP rather than moving only `run_week04.sh`.

### 5.2 Record scope and run local tests

HOST — package root:

```bash
python3 -m json.tool checkin.json
python3 -m unittest discover -s tests -v
```

Expected checkpoint: valid check-in JSON and six passing tests. Edit the three answer fields in `checkin.json` with your preferred editor. Do not put credentials or customer details in it.

For **reduce**, export the packaged config selector before every launcher command in the current terminal:

```bash
export PGX4_CONFIG_FILE=configs/reduced.env
```

For **continue** or **advance**, leave `PGX4_CONFIG_FILE` unset; `configs/week04.env` is used.

### 5.3 Create the safe workspace and capture preflight evidence

HOST — package root:

```bash
bash run_week04.sh setup
bash run_week04.sh preflight
```

Expected checkpoint: `Ready: /AI_PGX/week04-vllm-serving`, followed by a preflight PASS. The launcher may ask for sudo only to create `/AI_PGX`; the experiment and Docker processes run as your normal user. Preflight requires native `aarch64`, Docker access, `nvidia-smi`, ≥40 GiB free disk and ≥32 GiB available memory. It captures OS, CPU, driver, Docker, optional `nvcc`, package, disk and memory details under `manifests/`.

If `docker info` says permission denied, apply the NVIDIA playbook's standard group setup, then start a fresh login session:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker ps
```

Expected: `docker ps` shows a header without a permission error. Docker group membership is root-equivalent; use it only on your trusted personal machine.

### 5.4 Pull, architecture-check and digest-lock the runtime

HOST — package root:

```bash
bash run_week04.sh pull
cat /AI_PGX/week04-vllm-serving/manifests/image-ref.txt
```

Expected checkpoint: Docker pulls `linux/arm64`, image inspection reports `arm64`, and the second command prints `nvcr.io/nvidia/vllm@sha256:<64 hex characters>`. All later commands use this digest.

If NGC requests authentication, use interactive login. Placeholder: `YOUR_NGC_API_KEY` is your own NGC key; enter it only at the password prompt, never in a script or screenshot.

```bash
docker login nvcr.io
```

Use username `$oauthtoken` and paste `YOUR_NGC_API_KEY` as the password. Do not use `--password` on the command line.

### 5.5 Prove real Arm64 and SM121 execution

HOST — package root:

```bash
bash run_week04.sh gate
```

Expected checkpoint: one JSON line containing `"machine":"aarch64"`, `"capability":[12,1]` and `"bf16_matmul":"PASS"`. The test runs inside the exact digest and synchronizes a real 2048×2048 BF16 CUDA matrix multiplication. If capability is anything other than 12.1, stop; do not substitute SM120 or remove the assertion.

### 5.6 Acquire the immutable model snapshot

HOST — package root:

```bash
bash run_week04.sh download
du -sh /AI_PGX/week04-vllm-serving/cache/huggingface
```

Expected checkpoint: the output path contains `snapshots/cdbee75...` for the full config or `snapshots/c1899de...` for reduced, followed by cache size. Both models are public; no Hugging Face token is required. Offline mode is enforced when serving so a changed `main` cannot be fetched later.

### 5.7 Start and smoke-test the localhost endpoint

HOST — package root:

```bash
bash run_week04.sh serve
bash run_week04.sh status
bash run_week04.sh smoke
```

Expected checkpoints:

- Health succeeds within 20 minutes and the launcher prints `http://127.0.0.1:8004`.
- `status` shows container `pgx52-week04-vllm` and a listener on `127.0.0.1:8004`, not `0.0.0.0:8004` or `[::]:8004`.
- Smoke output is a valid OpenAI-compatible response. Inspect the assistant text; API JSON validity alone is not strict output correctness.
- `manifests/runtime-versions.json` records vLLM, Torch, CUDA, Transformers and capability from the live container.

The launcher uses BF16, an 8,192-token cap, 0.70 memory utilization, eight active sequences and vLLM's neutral generation defaults. These values are fixed before measurement.

### 5.8 Run, monitor and evaluate

HOST — package root:

```bash
bash run_week04.sh benchmark
bash run_week04.sh inspect
```

Expected checkpoint: a unique UTC result directory and a printed acceptance object. The benchmark performs one unscored warm-up, then runs concurrency 1/2/4/8 with 24 requests per level and three repetitions. It retains every response. `accepted=true` only when all five criteria pass:

1. All requests return HTTP 200.
2. Strict-JSON accuracy is at least 90% at every concurrency.
3. Maximum-concurrency median aggregate completion throughput is at least 1.5× concurrency 1.
4. Completion-throughput CV is at most 10% at every concurrency.
5. Maximum-concurrency median p95 latency is at most 4× concurrency 1.

The client is non-streaming: its latency is end-to-end request latency, not time to first token. Aggregate throughput uses the API's reported completion-token count divided by wall time. Prompts have different natural output lengths, but the same ordered prompt cycle is used at every level. This is a controlled local service benchmark, not MLPerf and not a general model-quality claim.

HOST — optional read-only monitoring in a second terminal:

```bash
free -h
vmstat 2 5
nvidia-smi
docker stats --no-stream pgx52-week04-vllm
curl -fsS http://127.0.0.1:8004/metrics | sed -n '1,40p'
```

Expected: no sustained swap thrashing, a responsive localhost endpoint and vLLM metrics if exposed by this build. On unified memory, some per-GPU memory fields may be `N/A`; use `free`, `/proc/meminfo`, plain `nvidia-smi` and container telemetry together. The two-second `telemetry.csv` is observational and does not claim wall-socket energy.

### 5.9 Export, stop and resume

HOST — package root:

```bash
bash run_week04.sh export
bash run_week04.sh stop
```

Expected checkpoint: a bounded ZIP plus `.sha256` under `/AI_PGX/week04-vllm-serving/exports`, then confirmation that only the named container was stopped and removed. Model cache, manifests, logs, results and exports remain.

Resume after a reboot:

```bash
cd "<EXTRACTED_PACKAGE_DIRECTORY>"
bash run_week04.sh preflight
bash run_week04.sh serve
bash run_week04.sh status
```

Placeholder: `<EXTRACTED_PACKAGE_DIRECTORY>` is the exact directory printed/used in Section 5.1. The digest and model cache are reused. Run `smoke` before a new benchmark.

## 6. Container command anatomy

These are **CONTAINER operations initiated from the HOST**. Do not paste them into an interactive container shell. The launcher supplies the exact values and digest.

The hardware gate is conceptually:

```bash
docker run --rm --platform linux/arm64 --gpus all \
  --entrypoint python3 "<PINNED_IMAGE_DIGEST>" -c \
  'import torch; assert torch.cuda.get_device_capability()==(12,1); a=torch.randn((2048,2048),device="cuda",dtype=torch.bfloat16); b=a@a; torch.cuda.synchronize(); print(torch.isfinite(b).all())'
```

Placeholder: `<PINNED_IMAGE_DIGEST>` is the exact single line in `manifests/image-ref.txt`. Never type a guessed digest.

The server is conceptually:

```bash
docker run -d --name pgx52-week04-vllm --platform linux/arm64 \
  --gpus all --ipc host --ulimit memlock=-1 --ulimit stack=67108864 \
  -p 127.0.0.1:8004:8000 \
  -e HF_HOME=/cache -e HF_HUB_OFFLINE=1 -e HF_HUB_DISABLE_TELEMETRY=1 \
  -v /AI_PGX/week04-vllm-serving/cache/huggingface:/cache \
  --entrypoint '' "<PINNED_IMAGE_DIGEST>" \
  vllm serve Qwen/Qwen3-4B-Instruct-2507 \
    --revision cdbee75f17c01a7cc42f958dc650907174af0554 \
    --served-model-name pgx-week04-qwen3-4b --host 0.0.0.0 --port 8000 \
    --dtype bfloat16 --max-model-len 8192 \
    --gpu-memory-utilization 0.70 --max-num-seqs 8 --generation-config vllm
```

The inner server listens on all interfaces **inside** the isolated container, while Docker publishes it only to host loopback. Do not replace `127.0.0.1:8004:8000` with `8004:8000`.

## 7. Troubleshooting by symptom

| Symptom | Diagnostic commands (HOST) | Likely cause | Safe fix |
|---|---|---|---|
| `exec format error` or x86 image | `uname -m`; `docker image inspect "$VLLM_IMAGE" --format '{{.Architecture}}'` | Image/manifest resolved to amd64 | Re-run `pull`; require `arm64`. Do not use emulation for GPU results. If 26.08 has no Arm64 manifest on your registry path, retain evidence and stop rather than changing tags silently. |
| Python wheel says unsupported platform | `uname -m`; `python3 -m pip debug --verbose` only in the affected environment | Arbitrary x86 wheel or unsupported Arm64 build | Do not pip-install over the NGC container. Restore the immutable image digest. Use the packaged smaller model; wheel changes require a new labelled experiment. |
| Docker GPU error | `nvidia-smi`; `docker info | sed -n '/Runtimes/,+3p'`; `journalctl -u docker -n 100 --no-pager` | NVIDIA Container Toolkit not configured or driver/runtime mismatch | Use Lenovo/NVIDIA-supported toolkit configuration. NVIDIA documents `sudo nvidia-ctk runtime configure --runtime=docker` followed by Docker restart, but record current state first; do not upgrade the driver ad hoc. |
| Gate reports capability other than 12.1 | `bash run_week04.sh gate`; inspect `manifests/sm121-runtime-gate.json` | Wrong GPU, wrong runtime or a generic Blackwell path | Stop. Confirm Lenovo GB10 and container GPU assignment. Never retarget to SM120 or delete the assertion. |
| `no kernel image`, invalid device function, unsupported kernel | `docker logs pgx52-week04-vllm`; `cat manifests/runtime-versions.json`; `cat manifests/image-ref.txt` | Bundled extension lacks SM121 support despite generic CUDA availability | Preserve digest/log. Do not install a nightly wheel inside the container. Use the reduced checkpoint only if the same gate and model load pass; otherwise report runtime incompatibility. |
| CUDA OOM or host freeze risk | `free -h`; `vmstat 1 10`; `docker stats --no-stream pgx52-week04-vllm`; `docker logs ... | tail -100` | UMA pressure, context/KV cache too large, competing workload or file cache | Stop the named container. Close competing jobs. First use `configs/reduced.env`; otherwise lower utilization to 0.60 and max sequences to 4 in a **copied, newly labelled config**. Do not hide the original failure. NVIDIA documents cache flushing for UMA, but use it only after stopping workloads and record that intervention. |
| Disk/cache exhaustion | `df -h /AI_PGX`; `df -i /AI_PGX`; `du -sh /AI_PGX/week04-vllm-serving/*` | Large image layers, model cache, logs or inodes | Stop; export results; remove only the named container. Use the exact cleanup steps in Section 10. Do not delete Week 1–3 directories. |
| Docker permission denied | `id`; `getent group docker`; `docker ps` | User not in Docker group or session not refreshed | Add only your user to the group, then start a new session. Do not run the whole experiment as root. |
| Port 8004 occupied | `ss -ltnp 'sport = :8004'`; `docker ps --format '{{.Names}} {{.Ports}}'` | Existing service or stale container | Identify the owner. Stop only `pgx52-week04-vllm` if it is yours. Otherwise choose a new recorded host port before measurement; never kill an unknown process. |
| Model download 401/403 | `docker logs pgx52-week04-vllm`; inspect exact handle/revision | Mistyped repo/revision, proxy issue or unexpected auth policy | Both selected models are public. Verify the config and outbound connectivity. Do not paste tokens into logs. A token should not be required for these checkpoints. |
| Download stalls | `du -sh .../cache/huggingface`; `docker ps`; `df -h /AI_PGX` | Large files, restricted network, full disk or interrupted blob | Re-run `download`; Hugging Face cache resumes content-addressed blobs. Keep the revision unchanged. |
| Health timeout | `docker logs pgx52-week04-vllm | tail -200`; `free -h`; `bash run_week04.sh status` | Download missing, model load failure, OOM or incompatible kernel | Save logs, run `stop`, then use reduced config from a clean named container. Do not extend the timeout repeatedly without reading the error. |
| Low throughput or high CV | `nvidia-smi`; `free -h`; `vmstat 2 10`; inspect telemetry and server log | Thermal/load interference, short outputs, cache pressure, background jobs, first-run compilation or too little concurrency | Keep raw run. Stop other workloads, cool to idle, warm once, then repeat the unchanged full config on another day. Do not cherry-pick the best repetition or change precision after seeing the result. |
| Strict JSON below 90% | Inspect `raw_responses.jsonl` and `validation` fields | Model formatting/instruction-following limitation | Report as a model-quality failure. Do not add constrained decoding after the fact; that is a separate future experiment. |

When troubleshooting, paste the section number, the complete command and complete terminal output with secrets redacted. Diagnose one observed step at a time; do not silently change the image, digest, model, revision, dtype, context, concurrency or success criteria.

## 8. Smaller-model and CPU fallback

The supported Week 4 fallback is the smaller public Qwen3-0.6B checkpoint, not an unverified Arm64 wheel:

```bash
export PGX4_CONFIG_FILE=configs/reduced.env
bash run_week04.sh setup
bash run_week04.sh preflight
bash run_week04.sh pull
bash run_week04.sh gate
bash run_week04.sh download
bash run_week04.sh serve
bash run_week04.sh smoke
bash run_week04.sh benchmark
bash run_week04.sh inspect
```

Expected: the same Arm64/SM121/container gates pass with a smaller checkpoint and workload. Record the scope as `reduce`; do not claim the full 4B hypothesis passed.

If the GPU runtime itself fails, use Week 3's native llama.cpp CPU fallback with its pinned 1.5B GGUF checkpoint to verify only client/prompt logic. Do not present that as a Week 4 vLLM or GPU result. This package intentionally avoids pretending that a CUDA NGC image is a validated CPU-serving stack.

## 9. One-week work breakdown

| Day | Work | Exit evidence |
|---|---|---|
| Monday | Check-in, source checksums, unit tests, host preflight | Updated `checkin.json`, test log and host manifest |
| Tuesday | Pull Arm64 image, record digest, execute SM121 BF16 gate | `image-ref.txt`, image inspection and gate JSON |
| Wednesday | Download pinned model, launch localhost API, smoke test | Exact snapshot path, runtime versions and smoke response |
| Thursday | Run full concurrency sweep with telemetry | Raw responses, telemetry, per-repetition summaries |
| Friday | Repeat unchanged run if CV/thermal state is questionable; analyze failures | Second labelled run or documented blocker |
| Saturday | Prepare chart, README findings, risk card and demo | SVG chart, concise interpretation, demo recording plan |
| Sunday | Export, verify checksum, redact public subset and stop service | ZIP + SHA-256, stopped container, publication-ready folder |

## 10. Safe stop, checkpoint, rollback and cleanup

Stop without deleting results or caches:

```bash
bash run_week04.sh stop
```

Checkpoint after any successful run:

```bash
bash run_week04.sh export
sha256sum -c /AI_PGX/week04-vllm-serving/exports/<EXACT_EXPORT_FILENAME>.zip.sha256
```

Placeholder: `<EXACT_EXPORT_FILENAME>` is the basename printed by `export`. Run the checksum command from the exports directory if the sidecar contains a basename rather than an absolute path.

Rollback means restarting from the already-recorded digest and immutable model revision. Do not pull the tag again:

```bash
cat /AI_PGX/week04-vllm-serving/manifests/image-ref.txt
bash run_week04.sh stop
bash run_week04.sh serve
bash run_week04.sh smoke
```

To recover the source, extract a fresh copy of the original ZIP and verify `SOURCE_SHA256SUMS.txt`; the work directory remains separate.

Remove one specific failed result recoverably:

```bash
RUN_ID="<EXACT_RUN_ID>"
RESULTS_ROOT="/AI_PGX/week04-vllm-serving/results"
TARGET="$(readlink -m -- "$RESULTS_ROOT/$RUN_ID")"
test "$(basename -- "$RUN_ID")" = "$RUN_ID" &&
test "$(dirname -- "$TARGET")" = "$RESULTS_ROOT" &&
test -d "$TARGET" &&
gio trash "$TARGET"
```

Placeholder: `<EXACT_RUN_ID>` is one directory name printed by `benchmark`, such as `20260928T010203Z-week04`. This never targets the result root.

Remove only the Week 4 Hugging Face cache after stopping and exporting:

```bash
CACHE="$(readlink -m -- /AI_PGX/week04-vllm-serving/cache/huggingface)"
test "$CACHE" = /AI_PGX/week04-vllm-serving/cache/huggingface &&
test -d "$CACHE" &&
gio trash "$CACHE"
```

Remove only the pinned container image after confirming no other container uses it:

```bash
IMAGE_REF="$(cat /AI_PGX/week04-vllm-serving/manifests/image-ref.txt)"
docker ps -a --filter "ancestor=$IMAGE_REF"
docker image rm "$IMAGE_REF"
```

Do not use recursive deletion on `/AI_PGX`, `$HOME`, the source parent, Docker's data root or the Hugging Face global cache.

## 11. Publication checklist

### Repository structure

```text
WEEK04/
├── README.md
├── LICENSES/
├── configs/
├── data/synthetic-prompts.jsonl
├── scripts/
├── tests/
├── manifests/redacted/
├── results/raw/
├── results/summary/
├── figures/throughput_by_concurrency.svg
├── risk-card.md
└── demo-script.md
```

Do not commit model weights, container layers, Hugging Face tokens, Docker credentials, unredacted host identifiers, raw private paths or unrelated telemetry.

### README outline

1. Hardware and research question
2. Why Arm64/SM121 validation matters
3. Exact image digest, software versions and model revision
4. Synthetic prompt set and licences
5. Reproduction commands
6. Results table and concurrency chart
7. Acceptance outcomes and falsified criteria
8. Failure cases and troubleshooting
9. Limitations: short prompts, non-streaming client, single device, UMA and no wall-power measurement
10. Next step toward RAG/agents without claiming Week 4 performed them

### Exact environment manifest

- OS/kernel and `uname -m`
- Lenovo/GB10 `nvidia-smi` output
- Docker engine/runtime versions
- NGC tag **and immutable digest**
- vLLM/Torch/CUDA/Transformers versions from `runtime-versions.json`
- Compute capability 12.1 gate output
- Model repository, full revision and model licence
- Full config, prompt checksum and source-package checksum
- Host free memory/disk at start and UTC timestamps

### Results to retain

- Raw request/response JSONL, including failures
- Per-repetition and aggregated JSON/CSV
- Telemetry CSV and server log
- Warm-up response, smoke response and startup log
- Summary acceptance booleans
- Export ZIP and SHA-256

Recommended chart: the generated `throughput_by_concurrency.svg`, showing median aggregate completion tokens/s at c=1/2/4/8. Add p95 latency as a table beside it rather than crowding a second axis.

### Two-to-three-minute demo

1. **0:00–0:25:** show the Lenovo PGX, `uname -m`, image digest and SM121 gate.
2. **0:25–0:55:** show `ss` proving the endpoint is localhost-only, then the smoke call.
3. **0:55–1:45:** launch the benchmark and explain concurrency, fixed prompts and telemetry.
4. **1:45–2:20:** show the summary JSON, chart and any failed criterion.
5. **2:20–2:45:** state limitations, licence/data safety and the next platform step.

### Failure cases and risk card

Record at minimum: malformed JSON, timeout/HTTP failure, high concurrency tail latency, OOM/UMA pressure, unsupported SM121 kernel, image/model download failure and non-reproducible CV. The risk card should cover local API exposure, Docker group privilege, model hallucination, synthetic-to-real domain gap, untrusted generated text, licence obligations, supply-chain pinning, unified-memory exhaustion and invalid use for autonomous cyber or water-operation decisions.

### Concise blog-post outline

1. Why Week 4 moved from single-user inference to serving
2. The Arm64/SM121 compatibility trap
3. Reproducible stack: digest, revision and localhost API
4. What concurrency changed in throughput and p95 latency
5. What strict-JSON failures revealed
6. UMA and stability lessons
7. Next: using the endpoint as a controlled component for RAG and agents

## 12. Interpretation boundaries

- The benchmark uses synthetic prompts and is safe for publication, but it does not validate production water-loss decisions or autonomous cyber response.
- Strict JSON is scored without grammar-constrained decoding so formatting failures remain visible.
- `nvidia-smi` power values, when present, are not wall-socket energy. Week 2's validated energy pipeline should be used for energy-per-result claims.
- A real SM121 BF16 gate plus successful model inference is stronger evidence than a generic Blackwell label, but it does not certify every CUDA kernel or future image.
- A passing 4B service baseline enables later RAG/agent work; it is not itself confidential RAG, FHE, an agent or a digital twin.

For live troubleshooting, paste the complete command and full output, with credentials redacted. We will diagnose one observed step at a time and preserve the selected experiment settings.
