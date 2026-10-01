"""PGX-52 Week 3: stdlib-only acquisition, benchmarking, evaluation and export."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FULL_BENCHMARK_SETTINGS = {
    "modes": ["cpu", "gpu"], "repetitions": 10, "prompt_tokens": 512,
    "generation_tokens": 128, "threads": 8, "batch": 256, "ubatch": 128,
}


def dump(path, obj):
    path.write_text(json.dumps(obj, indent=2, allow_nan=False) + "\n")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def safe_child(path):
    p = Path(path).resolve()
    if p == ROOT or not p.is_relative_to(ROOT):
        raise ValueError("Path must be a child of this project")
    return p


def acquire():
    lock = json.loads((ROOT / "locks.json").read_text())
    folder = safe_child(ROOT / "models")
    folder.mkdir(exist_ok=True)
    base = f'https://huggingface.co/{lock["model_repo"]}/resolve/{lock["model_revision"]}/'
    for name in ["LICENSE", "README.md", lock["model_file"]]:
        target = safe_child(folder / name)
        if target.exists():
            if name == lock["model_file"] and digest(target) != lock["model_sha256"]:
                raise ValueError("Existing model checksum mismatch: preserve and inspect; no overwrite")
            continue
        part = target.with_suffix(target.suffix + ".part")
        # curl resumes only the one fixed, pinned download; never executes downloaded text.
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "30",
                        "--max-time", "7200", "--continue-at", "-", "--output", str(part), base + name], check=True)
        if name == lock["model_file"] and digest(part) != lock["model_sha256"]:
            raise ValueError("Downloaded model checksum mismatch; .part retained")
        part.rename(target)
    (ROOT / "manifests").mkdir(exist_ok=True)
    dump(ROOT / "manifests/model-files.json", {p.name: digest(p) for p in folder.iterdir() if p.is_file() and not p.name.endswith(".part")})
    print("Pinned GGUF and licence downloaded; SHA-256 verified.")


def cases():
    """12 wholly synthetic cases; no external/customer observations."""
    result = []
    for i in range(12):
        inflow, demand = 100 + 10 * i, 70 + 7 * i
        zone = f"DEMO-{i + 1:02d}"
        expected = {"zone": zone, "unaccounted_m3": inflow - demand, "leak_confirmed": False}
        prompt = (f"Synthetic utility training record, not real operations. Zone {zone}. "
                  f"Measured inflow is {inflow} m3; recorded demand is {demand} m3 for the same interval. "
                  "Return only one JSON object with exactly these keys: zone (string), "
                  "unaccounted_m3 (integer, inflow minus demand), leak_confirmed (boolean). "
                  "The difference alone does not confirm a leak, so leak_confirmed must be false. "
                  "Do not give operational instructions.")
        result.append({"id": i, "prompt": prompt, "expected": expected})
    return result


def score_details(text, expected):
    result = {"strict_json_valid": False, "schema_valid": False,
              "values_correct": False, "pass": False}

    def unique_object(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError("Duplicate JSON key")
            obj[key] = value
        return obj

    def reject_constant(value):
        raise ValueError(f"Nonstandard JSON constant: {value}")

    if not isinstance(text, str):
        return result
    try:
        obj = json.loads(text.strip(), object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, TypeError):
        return result
    result["strict_json_valid"] = True
    result["schema_valid"] = (isinstance(obj, dict) and set(obj) == set(expected)
            and type(obj.get("zone")) is str and type(obj.get("unaccounted_m3")) is int
            and type(obj.get("leak_confirmed")) is bool)
    result["values_correct"] = result["schema_valid"] and obj == expected
    result["pass"] = result["values_correct"]
    return result


def score(text, expected):
    return score_details(text, expected)["pass"]


def stats(values):
    if not values or any(not math.isfinite(x) or x <= 0 for x in values):
        raise ValueError("Missing/nonpositive/nonfinite timing samples")
    mean = statistics.mean(values)
    return {"n": len(values), "median": statistics.median(values), "mean": mean,
            "cv_pct": 100 * statistics.stdev(values) / mean if len(values) > 1 else None}


def summarize_bench(rows, repetitions):
    out = {}
    for row in rows:
        kind = "pp" if row["n_prompt"] > 0 and row["n_gen"] == 0 else "tg" if row["n_gen"] > 0 and row["n_prompt"] == 0 else "other"
        if kind == "other" or kind in out:
            raise ValueError("Unexpected benchmark cases")
        values = row.get("samples_ts", [])
        if len(values) != repetitions:
            raise ValueError("Unexpected repetition count; do not summarize partial runs")
        out[kind] = stats(values)
    if set(out) != {"pp", "tg"}:
        raise ValueError("Both prompt and generation benchmarks are required")
    return out


def speedup_summary(c, modes):
    """Keep exploratory ratios without claiming they test the fixed full protocol."""
    result = {"hypothesis_speedup_ge_1_5": None}
    if not {"cpu", "gpu"}.issubset(modes):
        result["hypothesis_speedup_note"] = "Both CPU and GPU are required."
        return result
    ratio = modes["gpu"]["bench"]["tg"]["median"] / modes["cpu"]["bench"]["tg"]["median"]
    result["gpu_cpu_tg_speedup"] = ratio
    full_protocol = all(c.get(key) == value for key, value in FULL_BENCHMARK_SETTINGS.items())
    full_samples = all(modes[mode]["bench"][kind]["n"] == 10
                       for mode in ("cpu", "gpu") for kind in ("pp", "tg"))
    if full_protocol and full_samples:
        result["hypothesis_speedup_ge_1_5"] = ratio >= 1.5
        result["hypothesis_speedup_note"] = "Evaluated using the fixed full microbenchmark protocol."
    else:
        result["hypothesis_speedup_note"] = "Exploratory ratio only; fixed full microbenchmark protocol not met."
    return result


def stability_target(bench):
    """The stated stability target requires ten samples in both benchmark groups."""
    if set(bench) != {"pp", "tg"} or any(v["n"] != 10 for v in bench.values()):
        return None
    return all(v["cv_pct"] is not None and v["cv_pct"] <= 10 for v in bench.values())


def request(port, path, payload=None):
    # Never accept a caller-controlled hostname: local benchmark only.
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=180) as r:
        return json.load(r)


def available_kib():
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1])
    raise RuntimeError("Cannot read MemAvailable")


def monitor(stop, path):
    with path.open("x") as f:
        while not stop.is_set():
            row = {"unix_s": time.time(), "mem_available_kib": available_kib()}
            if shutil.which("nvidia-smi"):
                try:
                    r = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu,power.draw",
                                        "--format=csv,noheader,nounits"], text=True, capture_output=True, timeout=3)
                    row["gpu_csv"] = r.stdout.strip()
                    row["gpu_query_exit"] = r.returncode
                except subprocess.TimeoutExpired:
                    row["gpu_query_exit"] = "timeout"
            f.write(json.dumps(row) + "\n")
            f.flush()
            stop.wait(2)


def validate_config(c):
    if not c["modes"] or any(x not in ("cpu", "gpu") for x in c["modes"]) or len(set(c["modes"])) != len(c["modes"]):
        raise ValueError("Invalid modes")
    limits = {"repetitions": (2, 20), "prompt_tokens": (1, 1024), "generation_tokens": (1, 256),
              "threads": (1, 20), "context": (512, 4096), "batch": (32, 512), "ubatch": (32, 256),
              "port": (1024, 65535), "quality_cases": (1, 12)}
    for key, (low, high) in limits.items():
        if type(c[key]) is not int or not low <= c[key] <= high:
            raise ValueError(f"Invalid {key}")
    if c["ubatch"] > c["batch"]:
        raise ValueError("ubatch exceeds batch")


def stop_child(child):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=20)
        except subprocess.TimeoutExpired:
            child.kill()  # This exact subprocess created by this run, never a name/PID sweep.
            child.wait()


def evaluate(root, mode, c, model):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", c["port"]))  # Fail, do not kill a process using the port.
    server = ROOT / f"vendor/llama.cpp/build-{mode}/bin/llama-server"
    cmd = [str(server), "-m", str(model), "--host", "127.0.0.1", "--port", str(c["port"]),
           "--parallel", "1", "-c", str(c["context"]), "-b", str(c["batch"]), "-ub", str(c["ubatch"]),
           "-t", str(c["threads"]), "-ngl", "99" if mode == "gpu" else "0", "-fa", "off", "--fit", "off", "--offline", "--alias", "pgx-week03"]
    dump(root / f"server-{mode}-command.json", cmd)
    rows = []
    with (root / f"server-{mode}.log").open("x") as log:
        child = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 180
            while True:
                if child.poll() is not None:
                    raise RuntimeError("Server exited; inspect its log")
                try:
                    if request(c["port"], "/health").get("status") == "ok":
                        break
                except (OSError, ValueError):
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError("Server health timeout")
                time.sleep(1)
            for index, case in enumerate([cases()[0]] + cases()[:c["quality_cases"]]):
                payload = {"model": "pgx-week03", "messages": [{"role": "user", "content": case["prompt"]}],
                           "temperature": 0, "seed": c["seed"], "max_tokens": 128, "stream": False,
                           "cache_prompt": False}
                start = time.perf_counter()
                response = request(c["port"], "/v1/chat/completions", payload)
                elapsed = time.perf_counter() - start
                content = response["choices"][0]["message"]["content"]
                details = score_details(content, case["expected"])
                row = {"case": case, "warmup": index == 0, "wall_seconds": elapsed,
                       "pass": details["pass"], "score_details": details,
                       "request": payload, "response": response}
                rows.append(row)
                dump(root / f"quality-{mode}-{index:02d}.json", row)
        finally:
            stop_child(child)
    measured = rows[1:]
    return {"correct": sum(r["pass"] for r in measured), "total": len(measured),
            "strict_json_valid": sum(r["score_details"]["strict_json_valid"] for r in measured),
            "schema_valid": sum(r["score_details"]["schema_valid"] for r in measured),
            "values_correct": sum(r["score_details"]["values_correct"] for r in measured),
            "accuracy": sum(r["pass"] for r in measured) / len(measured),
            "end_to_end_seconds": stats([r["wall_seconds"] for r in measured]),
            "note": "Nonstreaming request latency, not TTFT. Exact JSON toy task, not domain validation."}


def run(config):
    c = json.loads(safe_child(config).read_text())
    validate_config(c)
    lock = json.loads((ROOT / "locks.json").read_text())
    model = safe_child(ROOT / "models" / lock["model_file"])
    if not model.is_file():
        raise FileNotFoundError(f"Model file is missing: {model}. Download and verify it first with: bash run_week03.sh model")
    if digest(model) != lock["model_sha256"]:
        raise ValueError("Model SHA-256 mismatch")
    if available_kib() < 16 * 1024**2:
        raise MemoryError("Reserve at least 16 GiB MemAvailable before starting")
    for mode in c["modes"]:
        for binary in ("llama-server", "llama-bench"):
            if not (ROOT / f"vendor/llama.cpp/build-{mode}/bin/{binary}").is_file():
                raise FileNotFoundError(f"Run build-{mode} first")
    rid = time.strftime("%Y%m%dT%H%M%S", time.gmtime()) + "-" + uuid.uuid4().hex[:8]
    out = safe_child(ROOT / "runs" / rid)
    out.mkdir(parents=True)
    dump(out / "config.json", c)
    dump(out / "locks.json", lock)
    dump(out / "dataset.json", cases())
    shutil.copy2(ROOT / "checkin.json", out / "checkin.json")
    dump(out / "source-hashes.json", {str(p.relative_to(ROOT)): digest(p) for base in ("scripts", "configs", "tests") for p in (ROOT / base).rglob("*") if p.is_file() and "__pycache__" not in p.parts})
    stop = threading.Event()
    thread = threading.Thread(target=monitor, args=(stop, out / "telemetry.jsonl"), daemon=True)
    thread.start()
    result = {"run": rid, "complete": False, "config": c, "modes": {}}
    try:
        for mode in c["modes"]:
            bench = ROOT / f"vendor/llama.cpp/build-{mode}/bin/llama-bench"
            cmd = [str(bench), "-m", str(model), "-p", str(c["prompt_tokens"]), "-n", str(c["generation_tokens"]),
                   "-r", str(c["repetitions"]), "-t", str(c["threads"]), "-b", str(c["batch"]),
                   "-ub", str(c["ubatch"]), "-ngl", "99" if mode == "gpu" else "0", "-fa", "off", "-o", "json"]
            dump(out / f"bench-{mode}-command.json", cmd)
            with (out / f"bench-{mode}.json").open("x") as raw, (out / f"bench-{mode}.log").open("x") as log:
                child = subprocess.Popen(cmd, stdout=raw, stderr=log)
                try:
                    code = child.wait(timeout=1800)
                    if code:
                        raise RuntimeError(f"{mode} benchmark exited {code}")
                finally:
                    stop_child(child)
            bench_rows = json.loads((out / f"bench-{mode}.json").read_text())
            if mode == "gpu" and any("CUDA" not in str(r.get("backends", "")) for r in bench_rows):
                raise ValueError("GPU benchmark did not report CUDA")
            result["modes"][mode] = {"bench": summarize_bench(bench_rows, c["repetitions"])}
            result["modes"][mode]["quality"] = evaluate(out, mode, c, model)
            dump(out / "summary.json", result)
        result.update(speedup_summary(c, result["modes"]))
        result["complete"] = True
    except BaseException as e:
        result["error"] = f"{type(e).__name__}: {e}"
        raise
    finally:
        stop.set()
        thread.join(timeout=5)
        result["quality_target_ge_11_of_12"] = {m: (d["quality"]["correct"] >= 11 if d["quality"]["total"] == 12 else None) for m,d in result["modes"].items() if "quality" in d}
        result["stability_cv_le_10_pct"] = {m: stability_target(d["bench"]) for m,d in result["modes"].items()}
        dump(out / "summary.json", result)
        with (out / "summary.csv").open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["mode", "test", "n", "median_tokens_s", "cv_pct"])
            for m,d in result["modes"].items():
                for kind,v in d["bench"].items():
                    writer.writerow([m,kind,v["n"],v["median"],v["cv_pct"]])
        (ROOT / "manifests/last-run.txt").write_text(rid + "\n")
        print(f"Results: {out}\nComplete: {result['complete']}")
    return result


def export():
    rid = (ROOT / "manifests/last-run.txt").read_text().strip()
    if not rid or Path(rid).name != rid:
        raise ValueError("Invalid run id")
    runpath = safe_child(ROOT / "runs" / rid)
    target = safe_child(ROOT / "exports" / f"week03-{rid}.zip")
    if target.exists():
        raise FileExistsError("Export already exists; retained without overwriting")
    target.parent.mkdir(exist_ok=True)
    paths = [ROOT / p for p in ("README.md", "locks.json", "LICENSING.md", "checkin.json", "run_week03.sh")]
    paths += [ROOT / p for p in ("START_HERE.md", "VALIDATION.md") if (ROOT / p).is_file()]
    paths += [p for base in (ROOT / "scripts", ROOT / "configs", ROOT / "tests", ROOT / "manifests", runpath) for p in base.rglob("*") if p.is_file() and "__pycache__" not in p.parts]
    if sum(p.stat().st_size for p in paths) > 100 * 1024**2:
        raise ValueError("Bounded export exceeds 100 MiB; inspect logs")
    with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as z:
        for p in paths:
            safe_child(p)
            z.write(p, str(p.relative_to(ROOT)))
        z.writestr("SHA256SUMS.json", json.dumps({str(p.relative_to(ROOT)):digest(p) for p in paths}, indent=2))
    print(f"Export: {target}\nSHA256: {digest(target)}\nReview host manifests before publishing.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["acquire", "run", "export"])
    parser.add_argument("--config", default=str(ROOT / "configs/reduced.json"))
    args = parser.parse_args()
    if args.action == "acquire": acquire()
    elif args.action == "run": run(args.config)
    else: export()
