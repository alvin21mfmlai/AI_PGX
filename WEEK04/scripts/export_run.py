#!/usr/bin/env python3
"""Create a bounded, reproducible Week 4 export without caches or secrets."""

import argparse
import hashlib
import os
import time
import zipfile
from pathlib import Path


def add_tree(zf, root: Path, arc_root: str, size_state: list[int], cap: int):
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        size_state[0] += path.stat().st_size
        if size_state[0] > cap:
            raise RuntimeError(f"Export exceeds {cap} bytes")
        zf.write(path, f"{arc_root}/{path.relative_to(root)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    work = args.work.resolve()
    run_dir = (work / "results" / args.run_id).resolve()
    if run_dir.parent != (work / "results").resolve() or not run_dir.is_dir():
        raise SystemExit("Invalid or missing run directory")
    exports = work / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    output = exports / f"PGX52_Week04_{args.run_id}_{stamp}.zip"
    allowed_source = ["README.md", "LICENSING.md", "checkin.json", "configs", "data", "docs", "scripts", "tests", "SOURCE_SHA256SUMS.txt"]
    size = [0]
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in allowed_source:
            path = source / name
            if path.is_file():
                size[0] += path.stat().st_size
                zf.write(path, f"PGX52_Week04_vLLM_Serving/{name}")
            elif path.is_dir():
                add_tree(zf, path, f"PGX52_Week04_vLLM_Serving/{name}", size, 100 * 1024 * 1024)
        add_tree(zf, run_dir, f"PGX52_Week04_vLLM_Serving/run/{args.run_id}", size, 100 * 1024 * 1024)
        manifest_dir = work / "manifests"
        if manifest_dir.is_dir():
            add_tree(zf, manifest_dir, "PGX52_Week04_vLLM_Serving/manifests", size, 100 * 1024 * 1024)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + ".sha256").write_text(f"{digest}  {output.name}\n")
    print(output)
    print(digest)


if __name__ == "__main__":
    main()
