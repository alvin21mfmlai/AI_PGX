# Week 3 package review — 24 September 2026

This revision continues the supplied Week 3 package. The source commit, model revision/checksum, three configs, synthetic prompts, generation limits and measurement protocol are unchanged.

## Corrections

- Fix the observed early GPU-build exit: remove the `--list-gpu-code`/`sm_121a` filter, print the actual NVCC version, and keep the real SM121a compilation, CUDA kernel execution and CMake target.
- Detect a missing model before hashing and provide the exact `bash run_week03.sh model` recovery command.
- Document the ordered source/model/test/build/run sequence and an update procedure for `~/Desktop/AI_PGX/WEEK03` that backs up existing source and preserves local runtime/results/configuration.

- Reject duplicate JSON keys and nonstandard NaN/Infinity literals; Python's default JSON parser previously accepted them.
- Separate strict JSON validity, schema validity and value correctness in each response and in aggregate counts. Preserve the existing combined pass field and all raw responses.
- Retain observed ratios for exploratory CPU/GPU runs, but evaluate the full speedup hypothesis only with its fixed microbenchmark settings and ten samples per group.
- Leave the ten-sample stability target untested (`null`) for reduced runs; retain measured CV values.
- Remove the unsupported `GGML_CURL=OFF` CMake flag. Document local model loading and runtime `--offline` without claiming download capability is removed from the binary.
- Add `START_HERE.md`, include guides in result exports, and clarify that the exporter prints the archive checksum.

## Validation performed

- **22 Python unittest tests passed**, including strict JSON/schema/value checks, exclusion of warm-ups from scores, full versus reduced target eligibility, invalid timing rejection, path containment, real loopback HTTP request handling, bounded export, and runner orchestration with fixtures. New regressions cover the missing-model message, reaching actual architecture compilation without querying the target list, and stopping before CMake on compiler/kernel-gate failure.
- Launcher regression tests replace external commands with temporary fixtures. They validate control flow and error-log preservation; they do not compile CUDA or run a GPU.
- `bash -n run_week03.sh` passed; Python syntax compilation passed.
- All 30 Bash command blocks in README and START_HERE passed syntax checks.
- Source package SHA-256 checksums regenerated and verified after the review.
- The README update procedure passed a temporary filesystem integration check: revised source was installed, the previous launcher was backed up, and existing model/build/run/export/manifest/venv/configuration/check-in files were preserved.
- Upstream release and official model-file page checked: llama.cpp `b11064` is a pre-release associated with `a894dae`; the pinned Qwen file's published SHA-256 matches `locks.json`. NVIDIA's Spark guide specifies `121a-real`.

## Validation still required on the PGX

Native llama.cpp compilation, capability-12.1 kernel execution, actual model-layer offload, CPU/GPU inference, model output quality, throughput, latency and local software-stack compatibility have **not** been validated here. Unit tests and synthetic fixtures are not LLM results. No benchmark figures are fabricated or included in this source package.

Inspect the CUDA/offload evidence in each GPU log before interpreting results. The automated CUDA backend field check does not establish full model offload. Telemetry contains available raw sensors; energy is not calculated. The twelve related utility prompts provide a narrow instruction-following baseline, not operational engineering validation.

Run the hardware/model/API gates and retain every measured trial before reporting performance or quality findings.
