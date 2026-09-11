# PGX52 — Week 01: Platform Baseline

A reproducible PyTorch baseline for the Lenovo ThinkStation PGX: NVIDIA GB10, Arm64, 128 GB unified memory, and DGX OS.

## Run

In your **PGX SSH terminal**, clone this GitHub repository and enter the cloned directory. Then run:

```bash
bash run_week01.sh
```

Requires Python 3 and working Docker/NVIDIA GPU access on the PGX. Run as your normal user.

The script checks the platform, locks the NVIDIA PyTorch container by digest, runs **three benchmark repetitions**, and generates the summary, chart, CSV, checksums, and archive. Everything is saved inside this repository.

## Results

The numerical results appear in the SSH terminal. To read the saved summary:

```bash
cat results/latest/summary.md
```

| Output | File |
|---|---|
| Summary | `results/latest/summary.md` |
| Chart | `results/latest/throughput.png` |
| PDF chart | `results/latest/throughput.pdf` |
| Results table | `results/latest/runs.csv` |
| Complete archive | `results/latest.tar.gz` |

Download files through your SSH client's file-transfer/SFTP interface. Rerun the same command to create another timestamped session; previous results are preserved. Generated results are ignored by Git by default.

## Method

Each repetition uses 4096 × 4096 BF16 matrices, five warm-ups, ten timed trials, and seed `5201`. Correctness uses a smaller CPU FP32 reference with a 2% relative L2 tolerance. Stability passes when throughput variability is ≤10%; a warning preserves the measurement.

See [experiment details](docs/experiment.md) for scope and limitations.
