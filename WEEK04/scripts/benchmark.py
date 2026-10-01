#!/usr/bin/env python3
"""Standard-library OpenAI-compatible concurrency benchmark for PGX-52 Week 4."""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import math
import os
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path


def percentile(values: list[float], q: float) -> float:
    if not values:
        return math.nan
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] * (hi - pos) + ordered[hi] * (pos - lo)


def load_prompts(path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not rows:
        raise ValueError("Prompt file is empty")
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Prompt IDs must be unique")
    return rows


def validate_expected(content: str, expected: dict) -> tuple[bool, str]:
    try:
        parsed = json.loads(content.strip())
    except json.JSONDecodeError as exc:
        return False, f"not_strict_json:{exc.msg}"
    if not isinstance(parsed, dict):
        return False, "not_object"
    for key, value in expected.items():
        if key.endswith("_type"):
            actual_key = key[:-5]
            expected_type = {"string": str, "boolean": bool, "number": (int, float)}.get(value)
            if expected_type is None or not isinstance(parsed.get(actual_key), expected_type):
                return False, f"type_mismatch:{actual_key}"
        elif key not in parsed or parsed[key] != value:
            return False, f"value_mismatch:{key}"
    if set(parsed) != {k[:-5] if k.endswith("_type") else k for k in expected}:
        return False, "unexpected_keys"
    return True, "ok"


def request_once(url: str, model: str, row: dict, max_tokens: int, temperature: float, timeout: int) -> dict:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Follow the requested JSON schema exactly. Output JSON only."},
            {"role": "user", "content": row["prompt"]},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "seed": 42,
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    status = None
    error = None
    response_obj = None
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            response_obj = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        error = f"{type(exc).__name__}:{exc}"
    elapsed = time.perf_counter() - started
    content = ""
    usage = {}
    if isinstance(response_obj, dict):
        usage = response_obj.get("usage") or {}
        try:
            content = response_obj["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            error = error or "missing_choice_content"
    valid, validation = validate_expected(content, row["expected"]) if not error else (False, "request_error")
    return {
        "prompt_id": row["id"],
        "http_status": status,
        "latency_s": elapsed,
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "strict_json_correct": valid,
        "validation": validation,
        "content": content,
        "error": error,
    }


def run_level(args, prompts: list[dict], concurrency: int, repetition: int) -> tuple[list[dict], dict]:
    tasks = [prompts[i % len(prompts)] for i in range(args.requests)]
    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(request_once, args.url, args.model, row, args.max_tokens, args.temperature, args.timeout)
            for row in tasks
        ]
        results = [future.result() for future in futures]
    wall = time.perf_counter() - started
    for index, result in enumerate(results):
        result.update({"concurrency": concurrency, "repetition": repetition, "request_index": index})
    successful = [row for row in results if row["http_status"] == 200 and not row["error"]]
    latencies = [row["latency_s"] for row in successful]
    completion_tokens = sum(row["completion_tokens"] for row in successful)
    summary = {
        "concurrency": concurrency,
        "repetition": repetition,
        "requests": len(results),
        "successes": len(successful),
        "errors": len(results) - len(successful),
        "wall_s": wall,
        "aggregate_completion_tokens_per_s": completion_tokens / wall if wall else math.nan,
        "request_throughput_per_s": len(successful) / wall if wall else math.nan,
        "p50_latency_s": percentile(latencies, 0.50),
        "p95_latency_s": percentile(latencies, 0.95),
        "strict_json_correct": sum(bool(row["strict_json_correct"]) for row in results),
        "strict_json_accuracy": sum(bool(row["strict_json_correct"]) for row in results) / len(results),
        "completion_tokens": completion_tokens,
    }
    return results, summary


def aggregate(summaries: list[dict]) -> list[dict]:
    output = []
    for concurrency in sorted({row["concurrency"] for row in summaries}):
        group = [row for row in summaries if row["concurrency"] == concurrency]
        rates = [row["aggregate_completion_tokens_per_s"] for row in group]
        mean_rate = statistics.mean(rates)
        cv = statistics.stdev(rates) / mean_rate if len(rates) > 1 and mean_rate else 0.0
        output.append({
            "concurrency": concurrency,
            "repetitions": len(group),
            "mean_completion_tokens_per_s": mean_rate,
            "median_completion_tokens_per_s": statistics.median(rates),
            "throughput_cv": cv,
            "median_p95_latency_s": statistics.median(row["p95_latency_s"] for row in group),
            "total_requests": sum(row["requests"] for row in group),
            "total_successes": sum(row["successes"] for row in group),
            "strict_json_accuracy": sum(row["strict_json_correct"] for row in group) / sum(row["requests"] for row in group),
        })
    base = next(row for row in output if row["concurrency"] == 1)
    for row in output:
        base_rate = base["median_completion_tokens_per_s"]
        row["throughput_speedup_vs_c1"] = row["median_completion_tokens_per_s"] / base_rate if base_rate > 0 else 0.0
    return output


def write_chart(rows: list[dict], path: Path) -> None:
    width, height, margin = 760, 430, 65
    max_rate = max(row["median_completion_tokens_per_s"] for row in rows) or 1
    bar_space = (width - 2 * margin) / len(rows)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        '<text x="380" y="28" text-anchor="middle" font-family="sans-serif" font-size="18">Week 4: median aggregate completion throughput</text>',
        f'<line x1="{margin}" y1="{height-margin}" x2="{width-margin}" y2="{height-margin}" stroke="#222"/>',
        f'<line x1="{margin}" y1="{margin}" x2="{margin}" y2="{height-margin}" stroke="#222"/>',
        f'<text x="20" y="220" transform="rotate(-90 20 220)" text-anchor="middle" font-family="sans-serif" font-size="13">completion tokens/s</text>',
    ]
    for i, row in enumerate(rows):
        bar_h = (height - 2 * margin) * row["median_completion_tokens_per_s"] / max_rate
        x = margin + i * bar_space + bar_space * 0.2
        y = height - margin - bar_h
        w = bar_space * 0.6
        parts.extend([
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{bar_h:.1f}" fill="#76b900"/>',
            f'<text x="{x+w/2:.1f}" y="{y-7:.1f}" text-anchor="middle" font-family="sans-serif" font-size="12">{row["median_completion_tokens_per_s"]:.1f}</text>',
            f'<text x="{x+w/2:.1f}" y="{height-margin+22}" text-anchor="middle" font-family="sans-serif" font-size="12">c={row["concurrency"]}</text>',
        ])
    parts.append('</svg>')
    path.write_text("\n".join(parts) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompts", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--concurrency", default="1,2,4,8")
    parser.add_argument("--requests", type=int, default=24)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    levels = [int(item) for item in args.concurrency.split(",")]
    if not levels or 1 not in levels or any(item < 1 for item in levels):
        parser.error("Concurrency must contain positive integers including 1")
    prompts = load_prompts(args.prompts)
    args.out.mkdir(parents=True, exist_ok=False)

    warmup = request_once(args.url, args.model, prompts[0], args.max_tokens, args.temperature, args.timeout)
    (args.out / "warmup.json").write_text(json.dumps(warmup, indent=2) + "\n")
    if warmup["http_status"] != 200:
        raise SystemExit("Warm-up failed; inspect warmup.json")

    raw, summaries = [], []
    for repetition in range(1, args.repetitions + 1):
        for concurrency in levels:
            level_raw, level_summary = run_level(args, prompts, concurrency, repetition)
            raw.extend(level_raw)
            summaries.append(level_summary)
            print(json.dumps(level_summary, sort_keys=True), flush=True)

    aggregated = aggregate(summaries)
    base = next(row for row in aggregated if row["concurrency"] == 1)
    target = max(aggregated, key=lambda row: row["concurrency"])
    acceptance = {
        "all_requests_http_200": all(row["total_requests"] == row["total_successes"] for row in aggregated),
        "strict_json_accuracy_ge_0_90": all(row["strict_json_accuracy"] >= 0.90 for row in aggregated),
        "throughput_speedup_max_concurrency_ge_1_50": target["throughput_speedup_vs_c1"] >= 1.50,
        "throughput_cv_le_0_10": all(row["throughput_cv"] <= 0.10 for row in aggregated),
        "p95_latency_max_concurrency_le_4x_c1": target["median_p95_latency_s"] <= 4 * base["median_p95_latency_s"],
    }
    report = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "endpoint": args.url,
        "model": args.model,
        "configuration": vars(args) | {"prompts": str(args.prompts), "out": str(args.out)},
        "per_repetition": summaries,
        "aggregate": aggregated,
        "acceptance": acceptance,
        "accepted": all(acceptance.values()),
        "interpretation": "Failure is a valid result. Do not discard slow or malformed responses.",
    }
    (args.out / "raw_responses.jsonl").write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in raw))
    (args.out / "summary.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    with (args.out / "summary.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(aggregated[0]))
        writer.writeheader()
        writer.writerows(aggregated)
    write_chart(aggregated, args.out / "throughput_by_concurrency.svg")
    print(json.dumps({"accepted": report["accepted"], "acceptance": acceptance, "output": str(args.out)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
