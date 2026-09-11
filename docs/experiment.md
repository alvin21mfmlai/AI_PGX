# Week 01 experiment details

## Purpose

Establish a reproducible platform baseline for the PGX52 programme before progressing to local LLMs, NanoChat, RAG, agents, time-series models, and AI security experiments. The target is a Lenovo ThinkStation PGX with NVIDIA GB10, Arm64 userspace, and compute capability 12.1.

## Execution

Clone the complete repository on the PGX, enter its directory, and run `bash run_week01.sh` over SSH. The script runs the complete sequence automatically. It uses the directory containing the repository's scripts, so the clone may live anywhere writable by your user. There is no installation into a second project directory, no fresh-start step, and no GUI requirement.

The default is three back-to-back benchmark repetitions. To request a single repetition, use `bash run_week01.sh --runs 1`. For repeatability across days or cold starts, rerun the same command later under comparable power, display, and background-workload conditions. Each invocation receives a new result directory.

The script uses the existing Docker/NVIDIA runtime and host Python standard library. It checks for at least 40 GiB free on the repository filesystem. Docker image storage may be on a separate filesystem. The first image download may be substantial; its log path is printed while the pull runs. No host AI framework is installed.

## Environment and provenance

The baseline tag is `nvcr.io/nvidia/pytorch:25.11-py3`. The first run reuses a local image for this tag or pulls it if absent, then stores the exact digest in `results/image-lock.json`. Subsequent runs reuse that digest and fetch it by digest if needed. The image must be Arm64.

For reproducing a specific previously recorded image in a new clone, `--image-digest` accepts a complete NVIDIA PyTorch digest reference. It cannot replace a different existing lock silently. Each session retains its own image lock, container metadata, host/package inventories, optional Git commit/status, and a copy of the source used to run it. A new clone has its own image lock; compare digests before comparing results across clones.

All container stages use the configured NVIDIA GPU access. Matplotlib generates charts using its headless backend. Container banners are captured in stage logs; failed commands print a log excerpt and its full path.

## Tests and thresholds

| Check | Requirement |
|---|---|
| Host/container | Arm64 (`aarch64`) |
| GPU preflight | CUDA available, one CUDA device, compute capability `[12, 1]` |
| Smoke test | BF16 matrix operation with expected sampled result `256.0` |
| Numerical comparison | 256 × 256 FP32 CPU reference versus BF16 GPU calculation |
| Correctness tolerance | Relative L2 error ≤ 0.02 |
| Performance workload | 4096 × 4096 BF16 matrix multiplication |
| Protocol per repetition | Five warm-ups, ten timed trials, seed 5201 |
| Stability | Sample standard deviation of TFLOP/s divided by mean TFLOP/s ≤ 0.10 |

The benchmark source is unchanged from the preceding Week 01 package. It checks the entire small correctness output for finite values, but only one sampled output element during each large timed trial. Its host-clock timings include dispatch and synchronization overhead. A stability warning does not establish a hardware fault and is retained in the summary. A correctness or execution failure stops the workflow and preserves its partial evidence.

## Output layout

All output is under the repository's `results/` directory. Each timestamped session contains `raw/`, `env/`, `logs/`, `source/`, `summary.md`, `runs.csv`, `throughput.png`, `throughput.pdf`, and `SHA256SUMS`. A neighbouring archive and archive checksum retain the full session. `results/latest/` and `results/latest.tar.gz` point to the latest completed session. A failed attempt does not replace those links.

The script prints per-run correctness, median throughput, variability, and stability directly in the SSH terminal. Use `cat results/latest/summary.md` to read them again. Download the chart or archive via SFTP when desired. Prior output outside this clone is left in its existing location.

Ctrl+C, SIGTERM, and an SSH hangup request cleanup of the current stage's uniquely named container and its monitor process. Another execution in the same clone is blocked while one is active. If the machine loses power, retained files can be inspected and the same command rerun; there is no mid-matrix checkpoint.

## Interpretation and sharing

These are synthetic matrix measurements on one machine and one environment, not peak hardware throughput, LLM generation speed, or a guarantee of compatibility with every GPU extension. One-second telemetry may miss the short timed computation interval. Record environmental differences when comparing sessions.

Generated output is ignored by Git to avoid accidentally committing host inventories or logs. Review machine identifiers before publishing a result archive. No service ports, customer data, model checkpoint, or model token are involved. Choose code/data licences separately before describing a public repository as open source; NVIDIA container layers are not redistributed.

The workflow is checked locally with simulated Docker outputs; actual CUDA execution and performance are measured on the PGX.

References: [NVIDIA PyTorch playbook](https://github.com/NVIDIA/dgx-spark-playbooks/tree/main/nvidia/pytorch-fine-tune), [PyTorch benchmarking guide](https://docs.pytorch.org/tutorials/recipes/recipes/benchmark.html).
