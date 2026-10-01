# PGX-52 Week 03: start here

**21–27 September 2026 · Alvin Chew · Lenovo ThinkStation PGX / GB10**

**Revision: 24 September 2026.** `WEEK03.zip` contains the corrected launcher. If you already use `~/Desktop/AI_PGX/WEEK03`, follow **README Section 0** to back up and update its source without replacing models, builds, results or local configuration. Then run the ordered recovery chain there. The steps below are for a fresh extraction.

This is the next hands-on step after the Week 1 platform baseline and Week 2 observability work: run a local language model, measure CPU/GPU inference, and test whether its responses obey a precise JSON contract. Use the attached full README for explanations and troubleshooting; this guide gives the execution order.

The supplied package has been reviewed and its Python harness tested with fixtures. Compilation and model inference still need to run on your PGX. No throughput, quality or energy result has been measured for this Week 3 experiment yet.

## The fixed experiment

| Setting | Choice |
|---|---|
| Model | Official Qwen2.5-1.5B-Instruct, Q4_K_M GGUF; about 1.12 GB |
| Runtime | Native Arm64 llama.cpp `b11064`, exact commit in `locks.json` |
| GPU build | CUDA target `121a-real`; require a successful capability-12.1 kernel |
| First run | GPU only; 3 timing repetitions; 4 scored responses |
| Full run | CPU then GPU; 10 repetitions for each pp/tg group; 12 scored responses per backend |
| Input/output lengths | Full synthetic throughput tests: pp512 and tg128; quality output cap: 128 tokens |
| CPU threads | 8 |
| Endpoint | `http://127.0.0.1:8083`, active during evaluation only |
| Python | Standard library in a local venv; no Python ML packages |

Run every command below **in a Bash terminal on the PGX host, as your normal user**. If you are still inside a Week 2 Docker shell, exit that shell first. A successful Week 2 energy result is not assumed or required by this runner.

## 1. Extract and inspect

Save the reviewed ZIP as `~/Downloads/WEEK03.zip`. If your browser adds a suffix, adjust the filename in the first command to match your downloaded file.

```bash
test -f "$HOME/Downloads/WEEK03.zip" &&
PGX_EXTRACT="$(mktemp -d "$HOME/PGX52-Week03.XXXXXX")" &&
python3 -m zipfile -e "$HOME/Downloads/WEEK03.zip" "$PGX_EXTRACT" &&
cd "$PGX_EXTRACT/WEEK03" &&
export PGX3_ROOT="$PWD" &&
printf '%s\n' "$PGX3_ROOT" &&
sha256sum -c SOURCE_SHA256SUMS.txt
```

All checksums should say `OK`. Keep the printed project path for later terminals. Check the original package before editing `checkin.json`; your intentional edits will change its checksum.

Run these read-only checks individually:

```bash
uname -m
cat /etc/os-release
nvidia-smi
command -v nvcc
nvcc --version
free -h
df -h .
```

**First checkpoint:** architecture is `aarch64`, the GPU is visible, and the host has at least 20 GiB free disk and 16 GiB `MemAvailable`. `nvcc --version` establishes the installed CUDA compiler; the CUDA heading in `nvidia-smi` does not do so.

If `nvcc` is missing, retain the output and use the CPU fallback in Step 7 or resolve the installed toolkit path with live troubleshooting. Do not infer a working native toolkit from a previous successful container run.

## 2. Install build tools and activate the harness

From the extracted project root:

```bash
sudo apt-get update &&
sudo apt-get install -y --no-install-recommends \
  build-essential git cmake curl ca-certificates libcurl4-openssl-dev \
  libssl-dev python3 python3-venv
```

Create the venv once, then activate it:

```bash
test ! -e .venv && python3 -m venv --without-pip .venv
source .venv/bin/activate
bash run_week03.sh preflight
python3 -m json.tool checkin.json
python3 -m json.tool configs/reduced.json
```

Edit `checkin.json` with what you completed, any failed command, and your chosen scope. Keep the initial `reduce` scope. On a later visit, activate the existing `.venv` instead of recreating it.

## 3. Acquire the pinned files and test the harness

```bash
bash run_week03.sh source &&
bash run_week03.sh model &&
bash run_week03.sh test
```

Expect the exact llama.cpp commit and model SHA-256 to match, and the Python tests to pass. This step needs internet access for GitHub and Hugging Face. The public model does not require a token. The tests use synthetic fixtures and do not run an LLM.

**Do not skip `model`.** The ZIP contains no model weights. If the GGUF is missing, the benchmark now names the missing path and tells you to run `bash run_week03.sh model`. Wait for its checksum confirmation before continuing. `HF_HUB_OFFLINE=1` does not block this explicit download command, which uses curl.

## 4. Build and run the reduced GPU experiment

```bash
bash run_week03.sh build-gpu &&
bash run_week03.sh run configs/reduced.json
```

The build must report `capability=12.1` and `SM121 CUDA smoke PASS`. The runner then performs real model inference, captures logs and prints a new result directory. Do not continue automatically past a failed build or run.

The earlier launcher could exit after printing only the NVCC path. This revision removes that faulty architecture-list check and prints `nvcc --version`; it still compiles with `-arch=sm_121a` and runs the real CUDA gate. Do not use absence of `sm_121a` from `nvcc --list-gpu-code` as evidence that your compiler is incompatible.

Read the result:

```bash
PGX_RUN_ID="$(<manifests/last-run.txt)"
python3 -m json.tool "runs/$PGX_RUN_ID/summary.json"
rg 'CUDA|offload' "runs/$PGX_RUN_ID/bench-gpu.log" "runs/$PGX_RUN_ID/server-gpu.log"
```

If `rg` is unavailable, use `grep -E 'CUDA|offload'` with the same two paths, or open the logs in your editor. Check that model layers were actually offloaded. A compiled CUDA backend alone is insufficient proof.

The reduced run should contain three pp samples, three tg samples, four scored JSON responses and one unscored warm-up. `complete=true` means execution finished; the three-sample run does not test the full CPU/GPU or ten-sample stability targets. Formatting or arithmetic failures remain valid observations.

## 5. Run the full comparison

After successful GPU execution and offload inspection, set your check-in scope to `continue` and run:

```bash
bash run_week03.sh build-cpu &&
bash run_week03.sh run configs/full.json
```

Inspect `summary.json` as in Step 4, and then export:

```bash
bash run_week03.sh export
```

The command prints a ZIP under `exports/` and its checksum. Repeat the unchanged full run on a second day, then export that new run too. Each run gets a unique directory. Keep the original results when performance or accuracy is disappointing.

## 6. What the numbers mean

| Measurement | Interpretation / target |
|---|---|
| Prompt processing (pp) | Tokens processed per second for the synthetic input; separate from generation |
| Token generation (tg) | Tokens generated per second in llama-bench; excludes tokenization and sampling |
| GPU/CPU speedup | GPU median tg divided by CPU median tg; full-protocol hypothesis: at least 1.5× |
| Variability | Sample standard deviation divided by mean, expressed as a percentage; target: at most 10% for each ten-sample pp/tg group |
| Strict JSON validity | Parseable JSON response, rejecting duplicate keys and nonstandard constants; object shape is checked by the schema stage |
| Schema validity | Exactly the required keys and types; no extra keys or stringified numbers |
| Answer correctness | Exact zone and arithmetic result; boolean `leak_confirmed` must be `false` |
| Overall response target | At least 11 of 12 completely correct responses per backend |
| API latency | Nonstreaming request wall time, including request handling; not time to first token |
| Telemetry | Shared system memory and available GPU sensor readings; no energy figure is calculated |

Example task: zone `DEMO-01` has 100 m³ inflow and 70 m³ recorded demand for the same interval. Its exact expected answer is:

```json
{"zone":"DEMO-01","unaccounted_m3":30,"leak_confirmed":false}
```

The task explicitly tells the model that the difference does not confirm a leak. This tests arithmetic, instruction following and structured output. It does not test leak detection or independent engineering reasoning. No grammar or JSON-schema constrained decoding is applied in this baseline; the observed formatting failures are part of the measurement.

Do not compare LLM tokens/s directly with Week 1 GEMM TFLOP/s. The earlier approximately 20% GEMM variability is a reason to retain repeated measurements, not a prediction of Week 3 variance.

## 7. CPU fallback and troubleshooting

If GPU compilation or model kernels fail, preserve the exact failed command and output. After source/model acquisition, the explicit fallback is:

```bash
bash run_week03.sh build-cpu &&
bash run_week03.sh run configs/cpu.json &&
bash run_week03.sh export
```

This is a CPU result and leaves the GPU hypothesis untested. If download failed, finish the unit tests and record the acquisition blocker instead of treating fixtures as model results.

For live troubleshooting, send the step number, complete command and terminal output. For a completed run, upload its `exports/week03-<run-id>.zip` after reviewing local paths and machine identifiers. There is no need to upload model weights or build products. Detailed failure-specific commands and resume instructions are in the full README.

## This week's sequence

| Date | Work |
|---|---|
| Mon 21 Sep | Check-in, host preflight, source/model acquisition, harness tests |
| Tue 22 Sep | Native CUDA build and reduced GPU run |
| Wed 23 Sep | Full CPU/GPU comparison |
| Thu 24 Sep | Inspect structured-response failures and telemetry |
| Fri 25 Sep | Repeat the unchanged full run |
| Sat 26 Sep | Prepare throughput chart and a short demonstration from actual results |
| Sun 27 Sep | Export results, document findings, prepare reviewed portfolio material |

## Verified references

- [NVIDIA: llama.cpp on DGX Spark](https://build.nvidia.com/spark/llama-cpp/instructions) — native CUDA build using `121a-real`.
- [NVIDIA NVCC option documentation](https://docs.nvidia.com/cuda/cuda-compiler-driver-nvcc/index.html#list-gpu-code-code-ls) — `--list-gpu-code` lists non-architecture-specific targets.
- [llama.cpp b11064 release](https://github.com/ggml-org/llama.cpp/releases/tag/b11064) — pinned pre-release candidate.
- [Official Qwen checkpoint and checksum at the pinned revision](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf).

These sources confirm the recipe and file identity. Your local build and inference runs establish whether this particular PGX software stack executes them successfully.
