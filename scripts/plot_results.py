#!/usr/bin/env python3
"""Plot saved Week 01 baseline observations; never generate benchmark results."""
import argparse
import csv
import hashlib
import json
import math
import re
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

CONFIG = {"size": 4096, "warmup": 5, "trials": 10, "seed": 5201}
DIGEST_PATTERN = re.compile(
    r"^IMAGE_DIGEST=[\"']?(nvcr\.io/nvidia/pytorch@sha256:[0-9a-f]{64})[\"']?$",
    re.MULTILINE,
)


def number(value, name, minimum=0.0):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    if not math.isfinite(value) or value < minimum:
        raise ValueError(f"{name} must be finite and >= {minimum}")
    return float(value)


def load_run(path, root):
    data = json.loads(path.read_text())
    if data["schema_version"] != 1:
        raise ValueError("expected schema_version 1")
    config = data["configuration"]
    if any(key not in config for key in CONFIG):
        raise ValueError("configuration is missing a required field")
    if any(config[key] != value for key, value in CONFIG.items()):
        print(f"Skipped different configuration: {path.name}")
        return None
    run_id = path.stem.removeprefix("torch-baseline-")
    if not run_id:
        raise ValueError("empty run ID")
    matches = DIGEST_PATTERN.findall(
        (root / "env" / f"container-lock-{run_id}.env").read_text()
    )
    if len(matches) != 1:
        raise ValueError("run lock must contain exactly one valid IMAGE_DIGEST")
    trials = data["trials"]
    if len(trials) != 10 or [row["trial"] for row in trials] != list(range(1, 11)):
        raise ValueError("expected exactly trials 1 through 10")
    values = [number(row["tflops"], "trial throughput", 1e-12) for row in trials]
    for row in trials:
        number(row["seconds"], "trial seconds", 1e-12)
        if not math.isfinite(float(row["sample"])):
            raise ValueError("non-finite trial sample")
    summary = data["summary"]
    expected = {
        "median_tflops": statistics.median(values),
        "min_tflops": min(values),
        "max_tflops": max(values),
        "coefficient_of_variation": statistics.stdev(values) / statistics.mean(values),
    }
    for key, value in expected.items():
        actual = number(summary[key], key)
        if not math.isclose(actual, value, rel_tol=1e-6, abs_tol=1e-10):
            raise ValueError(f"{key} does not agree with saved trials")
    stability = summary["stability_pass"]
    if type(stability) is not bool or stability != (expected["coefficient_of_variation"] <= 0.10):
        raise ValueError("stability_pass does not agree with the 0.10 CV threshold")
    check = data["correctness"]
    error = number(check["relative_l2_error"], "relative_l2_error")
    tolerance = number(check["relative_l2_tolerance"], "relative_l2_tolerance")
    if type(check["finite"]) is not bool or tolerance != 0.02:
        raise ValueError("invalid correctness fields or tolerance")
    platform = data["platform"]
    correct = (check["finite"] and error <= tolerance
               and platform["architecture"] == "aarch64"
               and platform["compute_capability"] == [12, 1])
    return {"run_id": run_id, "image_digest": matches[0], "correctness_pass": correct,
            **expected, "stability_pass": stability, "values": values}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    runs, errors = [], []
    for path in sorted((root / "raw").glob("torch-baseline-*.json")):
        try:
            result = load_run(path, root)
            if result is not None:
                runs.append(result)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            errors.append(f"{path.name}: {exc}")
    if errors:
        parser.exit(2, "Invalid or incomplete evidence; no outputs written:\n" + "\n".join(errors) + "\n")
    if not runs:
        parser.exit(2, "No matching Week 01 results found; no outputs written.\n")
    output = root
    output.mkdir(parents=True, exist_ok=True)
    columns = min(2, len(runs))
    rows = math.ceil(len(runs) / columns)
    fig, axes = plt.subplots(rows, columns, figsize=(7.2 * columns, 4.5 * rows), squeeze=False)
    try:
        for ax, run in zip(axes.flat, runs):
            color = plt.get_cmap("tab10")(int(hashlib.sha256(run["run_id"].encode()).hexdigest()[:8], 16) % 10)
            ax.plot(range(1, 11), run["values"], "o-", color=color, label="Recorded trial")
            ax.axhline(run["median_tflops"], color="0.35", linestyle="--", label="Run median")
            status = "PASS" if run["stability_pass"] else "WARNING"
            correctness = "PASS" if run["correctness_pass"] else "FAIL"
            digest = run["image_digest"].split("sha256:")[1][:12]
            ax.set_title(f"{run['run_id']}\nCV {run['coefficient_of_variation']:.2%} | Stability {status}"
                         f" | Correctness {correctness}\nImage sha256:{digest}…", fontsize=10)
            ax.set(xlabel="Trial", ylabel="Throughput (TFLOP/s)", xticks=range(1, 11))
            ax.set_ylim(0, max(run["values"]) * 1.15)
            ax.grid(axis="y", alpha=0.25)
            ax.legend(fontsize=8)
        for ax in list(axes.flat)[len(runs):]:
            ax.set_visible(False)
        fig.suptitle("PGX52 Week 01 — saved BF16 baseline trials\n4096 × 4096 | 5 warm-ups | 10 trials | seed 5201", fontsize=13)
        fig.tight_layout(rect=(0, 0, 1, 0.94))
        fig.savefig(output / "throughput.png", dpi=170)
        fig.savefig(output / "throughput.pdf")
    finally:
        plt.close(fig)
    fields = [key for key in runs[0] if key != "values"]
    with (output / "runs.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: run[key] for key in fields} for run in runs)
    print(f"Plotted {len(runs)} run(s). Outputs: {output}/throughput.png, throughput.pdf, runs.csv")


if __name__ == "__main__":
    main()
