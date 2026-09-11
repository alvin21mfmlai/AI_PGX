#!/usr/bin/env python3
import argparse
import csv
import json
import math
import os
import platform
import statistics
import time
from pathlib import Path

import torch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-csv", required=True)
    parser.add_argument("--size", type=int, default=4096)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--trials", type=int, default=10)
    parser.add_argument("--seed", type=int, default=5201)
    args = parser.parse_args()

    if platform.machine() != "aarch64":
        raise RuntimeError(f"Expected aarch64 container, got {platform.machine()}")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available")

    capability = list(torch.cuda.get_device_capability(0))
    if capability != [12, 1]:
        raise RuntimeError(f"Expected SM121 capability [12, 1], got {capability}")

    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)

    # Small correctness test: FP32 CPU reference versus BF16 GPU result.
    check_n = 256
    a_cpu = torch.randn(check_n, check_n, dtype=torch.float32)
    b_cpu = torch.randn(check_n, check_n, dtype=torch.float32)
    reference = a_cpu @ b_cpu
    candidate = (a_cpu.to("cuda", torch.bfloat16) @ b_cpu.to("cuda", torch.bfloat16)).float().cpu()
    difference = reference - candidate
    max_abs_error = float(difference.abs().max())
    relative_l2_error = float(torch.linalg.vector_norm(difference) / torch.linalg.vector_norm(reference))
    finite = bool(torch.isfinite(candidate).all())
    if not finite or relative_l2_error > 0.02:
        raise RuntimeError(
            f"Correctness failed: finite={finite}, relative_l2_error={relative_l2_error}, "
            f"max_abs_error={max_abs_error}"
        )

    n = args.size
    a = torch.randn(n, n, device="cuda", dtype=torch.bfloat16)
    b = torch.randn(n, n, device="cuda", dtype=torch.bfloat16)

    for _ in range(args.warmup):
        _ = a @ b
    torch.cuda.synchronize()

    rows = []
    for trial in range(1, args.trials + 1):
        start = time.perf_counter()
        c = a @ b
        torch.cuda.synchronize()
        seconds = time.perf_counter() - start
        tflops = (2.0 * n ** 3) / seconds / 1e12
        checksum = float(c[0, 0])
        if not math.isfinite(checksum):
            raise RuntimeError(f"Non-finite output in trial {trial}")
        rows.append({"trial": trial, "seconds": seconds, "tflops": tflops, "sample": checksum})

    tflops_values = [r["tflops"] for r in rows]
    median_tflops = statistics.median(tflops_values)
    cv = statistics.stdev(tflops_values) / statistics.mean(tflops_values) if len(rows) > 1 else 0.0

    result = {
        "schema_version": 1,
        "captured_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platform": {
            "architecture": platform.machine(),
            "torch": torch.__version__,
            "cuda_runtime": torch.version.cuda,
            "cudnn": torch.backends.cudnn.version(),
            "device_name": torch.cuda.get_device_name(0),
            "compute_capability": capability,
        },
        "configuration": vars(args),
        "correctness": {
            "finite": finite,
            "relative_l2_error": relative_l2_error,
            "relative_l2_tolerance": 0.02,
            "max_abs_error_diagnostic": max_abs_error,
        },
        "summary": {
            "median_tflops": median_tflops,
            "min_tflops": min(tflops_values),
            "max_tflops": max(tflops_values),
            "coefficient_of_variation": cv,
            "stability_pass": cv <= 0.10,
        },
        "trials": rows,
    }

    json_path = Path(args.output_json)
    csv_path = Path(args.output_csv)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(result, indent=2) + "\n")
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["trial", "seconds", "tflops", "sample"])
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
