# PGX52 · Week 01: Platform Baseline

The first experiment in my 52-week programme of hands-on AI work on a **Lenovo ThinkStation PGX**. Week 01 establishes a reproducible environment for later experiments with local LLMs, NanoChat, RAG, agents, time-series models, and AI security.

**Status:** In progress. This repository provides the workflow; measured results will be added after review.

## Platform and experiment

- NVIDIA Grace Blackwell GB10; 128 GB unified memory; 4 TB SSD.
- NVIDIA DGX OS; Arm64 host and container.
- Docker with NVIDIA GPU access; `nvcr.io/nvidia/pytorch:25.11-py3`, pinned to an exact image digest.
- Synthetic matrix data; seed `5201`; no model downloads.

| Check | Configuration / target |
|---|---|
| Runtime | Arm64, CUDA available, one GPU, compute capability 12.1 |
| Correctness | 256 × 256 CPU FP32 versus GPU BF16; relative L2 error ≤ 2% |
| Performance | 4096 × 4096 BF16 matrix multiplication; 5 warm-ups, 10 timed trials |
| Stability | Standard deviation / mean of trial throughput ≤ 10% |
| Reproducibility | Image digest, environment records, raw results, chart, SHA-256 checksums |

A stability warning records excessive timing variation. Correctness and stability are separate checks; retain unsuccessful runs for diagnosis. Matrix throughput is specific to this workload and does not establish LLM performance.

## Run on the PGX

Complete first-boot setup and ensure Python 3, Docker, and NVIDIA GPU container access are available. From this repository, run as your normal user:

```bash
bash run_week01.sh all --runs 3
```

The script installs the bundled Python helpers into `/AI_PGX/week01-platform-baseline`, which holds the experiment outputs. Keep `run_week01.sh`, `scripts/`, and `benchmarks/` together in the source repository. Repeated execution preserves earlier results; it does not automatically reset the project.

Individual stages:

```bash
bash run_week01.sh setup
bash run_week01.sh run
bash run_week01.sh inspect
bash run_week01.sh export
```

The three runs in `all` execute back-to-back. To assess repeatability across days or cold starts, run again later with the same container digest, benchmark settings, and documented power/display conditions.

## Outputs and sharing

Under `/AI_PGX/week01-platform-baseline`:

- `env/`: host/container records and image lock.
- `logs/`: execution logs.
- `results/raw/`: per-run JSON, CSV, and telemetry.
- `results/summary/`: summaries and charts.

The export command prints the archive location and verifies checksums. Raw manifests, logs, and generated results are excluded through `.gitignore`; review and place selected results in [public-results/](public-results/), removing machine identifiers where needed.

See [the detailed playbook](docs/detailed-playbook.md) for the experiment rationale, acceptance criteria, troubleshooting, and limitations.

The source package has been checked locally with mocked orchestration; actual CUDA execution and throughput must be verified on the PGX.
