# PGX-52 Week 2 — GPU observability and energy-per-result

**14–20 September 2026 · General AI engineering track · Prepared 14 September 2026**

Week 1 began on 7 September; therefore this is **Week 2**, not Week 4 under the superseded August calendar. Target: a reproducible local observability dashboard, using a synthetic BF16 matrix workload to connect performance, monitoring overhead and available power telemetry.

## 1. Progress checkpoint and scope

Latest reported Week 1 evidence: three 4096×4096 BF16 runs passed the numerical check (approximately 0.288% relative error against a 2% tolerance). Reported median throughput was 84.05, 80.11 and 82.42 TFLOP/s, with 19.94–21.86% variability against a 10% target. These are your reported measurements, not new measurements taken during preparation of this package.

The later missing `scripts/week01.py` error stopped new execution. A complete Week 1 package was supplied, but successful execution after its restoration has not been confirmed here. Do not interpret a stale result displayed by `inspect` as evidence of a new run.

Record these three fields in your local lab notes before starting: **completed work; failed commands; scope choice (continue / reduce / advance)**. No reply is needed to use this playbook.

- **Default: continue Week 2**, conditional on its own native Arm64/SM121 correctness gate passing. Preserve the Week 1 stability warning. This package is independent of Week 1 and never changes `/AI_PGX/week01-platform-baseline`.
- **Reduce:** use the supplied 2048×2048, one-pair profile if time or memory is limited; use the CPU-only pipeline smoke test if the GPU runtime remains blocked. Label these reduced results, not full Week 2 completion.
- **Advance:** finish the full evidence package first, then add a measured wall-power run if you already have an appropriate meter. Do not switch to model serving or NanoChat within this experiment.

## 2. Experiment card

| Field | Specification |
|---|---|
| Objective | Build a local dashboard and test the cost of observing a controlled GPU workload; estimate energy per matrix multiply only when the power trace supports it. |
| Falsifiable primary hypothesis | With the same runtime/configuration, the median paired reduction in operations/s caused by the collector is ≤5% over three on/off pairs. A larger reduction falsifies this operational target for this configuration. |
| Secondary question | Is within-case block throughput CV ≤10% after 30 seconds of warm-up? Report failures. This does not retroactively change Week 1's stability result. |
| Controlled workload | Repeated dense `torch.mm` on two seeded 4096×4096 BF16 matrices; preallocated output; eager execution; no compilation, quantization or custom kernels. |
| Dataset and acquisition | Synthetic random numerical matrices generated in-process with seed `20260914`; no external download or personal data. Inputs are reproducible with the same code and environment; seeds do not guarantee cross-version bitwise identity. |
| Dataset licence | No third-party dataset licence applies. Suggested public release terms for your generated measurements: CC BY 4.0, subject to your approval. |
| Exact model checkpoint / licence | **Not applicable: no model, weights, tokenizer, model hub account or model download.** Adding a checkpoint would change the experiment. |
| Runtime | Official NVIDIA PyTorch `nvcr.io/nvidia/pytorch:25.11-py3`, native `linux/arm64`, locked to the actual registry digest before execution. Python standard library for collection/reporting. |
| Portfolio artifact | Source/config/tests, digest lock, environment manifests, raw blocks and telemetry, summarized CSV/JSON, one SVG chart, static HTML dashboard, short demonstration and risk card. |
| Resource estimate | Approximately 5–8 hours hands-on during the week; about 6–10 minutes for one full six-case run, excluding downloads/setup; nominal 12 GiB container host-memory limit and 16 GiB host-available floor. Actual Torch/runtime memory must be measured; unified/GPU allocations may not be completely governed by Docker's cgroup limit. |
| Disk/network estimate | Reserve ≥50 GiB free in the Docker storage filesystem and ≥5 GiB in the project filesystem before pulling; the image can require tens of GB including unpacking. Raw results should usually be under 100 MB per full run. No model/data traffic. These are planning estimates, not measured image sizes. |
| Feasibility | High for collection/reporting; conditional on the real SM121 operation passing. Power availability is a measured capability, not a promise. |

### Success criteria

1. Native `aarch64`, capability `(12,1)`, CUDA execution and finite BF16 output pass. A 16×16 output slice using the full inner dimension has relative L2 error ≤0.02 against CPU FP32. This is a sampled correctness check, not an exhaustive proof of all kernels.
2. Full configuration produces six completed cases (three pairs), each with ≥30 seconds of measurement after a separate ≥30-second warm-up. Order: off/on, on/off, off/on. Work is counted only after GPU synchronization.
3. Raw block timing, monitoring errors, configuration, versions and run status are retained. All seven supplied unit tests pass; the CPU smoke test creates a usable dashboard.
4. Report all three paired overhead values and their median. The ≤5% criterion is an experiment outcome, not a reason to discard a run. Negative apparent overhead means noise/apparent speedup, not proof that monitoring accelerates the GPU. Three pairs are descriptive, not a formal causal study.
5. Telemetry-on cases contain host-available RAM measurements. Aim for ≥10 valid power samples and 100% bracketed interval coverage with no adjacent gap over 3.5 seconds before publishing sensor-derived J/matmul. Otherwise energy stays `null`/unavailable. Do not manufacture zero energy.
6. Export a reproducible artifact even if the hypothesis fails or energy is unavailable; explicitly distinguish **observability complete**, **overhead target met/not met**, **energy available/unavailable** and **reduced/full scope**.

## 3. Compatibility decision — official sources checked 14 September 2026

The official Spark PyTorch instructions still specify `25.11-py3`. This is a verified conservative baseline, **not a claim that 25.11 is the newest release**. We borrow the official image choice, not its fine-tuning dependencies or model downloads. [NVIDIA Spark PyTorch instructions](https://build.nvidia.com/spark/pytorch-fine-tune/instructions)

NVIDIA documents Ubuntu 24.04, CUDA 13.0.2.006 and PyTorch `2.10.0a0+b558c986e8` for that image. The runtime's exact version string may include an NVIDIA suffix; capture it, along with package inventory and digest. Its release notes include a `torch.compile`/max-pooling numerical issue; this workload uses neither. `NVIDIA_IMEX_CHANNELS=0` is included as the documented container workaround for a separate NVSHMEM issue. No pip packages are added or upgraded. [PyTorch 25.11 release notes, updated 8 September 2026](https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-25-11.html)

NVIDIA lists GB10 as compute capability **12.1**, distinct from the 12.0 products. Architecture strings alone are insufficient: the script requires an actual BF16 allocation, matrix multiply, synchronization and reference check on 12.1. This validates these operations only; it does not certify Triton, FlashAttention, bitsandbytes, arbitrary wheels or all Blackwell kernels. [NVIDIA CUDA GPU capability table](https://developer.nvidia.com/cuda/gpus)

CUDA 13.x requires driver branch ≥580 for minor-version compatibility, with restrictions for newer features and PTX. That is a necessary screening gate here, not sufficient evidence of Lenovo support. Keep your installed Lenovo-supported DGX OS stack unless the real test identifies a mismatch. Do not copy a Founders Edition driver/kernel version or install a new CUDA toolkit merely to match the container. The CUDA label in `nvidia-smi` is driver support information, not a host toolkit inventory. [CUDA compatibility, updated 9 September 2026](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html), [DGX Spark release notes and partner-update caveats](https://docs.nvidia.com/dgx/dgx-spark/release-notes.html)

GB10 shares memory between CPU and GPU; unsupported framebuffer-memory reporting is expected on iGPU systems. Read `/proc/meminfo` and record PyTorch allocation counters without adding them together as independent memory pools. [NVIDIA known issues, updated 10 September 2026](https://docs.nvidia.com/dgx/dgx-spark/known-issues.html)

Power field support and measurement domains vary. The package labels its integration **`nvidia-smi power.draw sensor-domain estimate`**, never wall-socket energy. A GB10/OEM-specific physical boundary has not been established here. Sensor averaging, query latency and transitions limit accuracy even when numerical coverage is complete. [NVIDIA SMI power-reading documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html)

**Verification limit:** the package's shell syntax, unit tests, CPU fallback and report/export paths were tested in the preparation environment. There is no access to your PGX here: no GPU execution, registry pull/digest, Lenovo driver state or power-sensor accuracy has been certified on your machine. The following gates establish that evidence locally.

## 4. Ordered Linux execution playbook

Run host commands as your normal Linux user on the PGX, not as root and not in a container. Use a new Bash terminal. A step that exits nonzero is a stop checkpoint: do not continue until its observed failure is understood.

**Placeholders:** primary commands have no values to replace if the ZIP is downloaded under its exact filename to `~/Downloads`. `PGX_EXTRACT`, `PGX_PROJECT`, `IMAGE` and `RUN_ID` are populated by commands. The only manual placeholder is `RUN_ID_FROM_EARLIER_OUTPUT`, clearly marked in the resume section.

### Step 1 — Host: inspect hardware and existing runtime

```bash
uname -m
cat /etc/os-release
lscpu
free -h
df -h "$HOME"
command -v python3 bash tar sha256sum docker nvidia-smi
python3 --version
nvidia-smi
docker version
docker info --format 'Architecture={{.Architecture}} DockerRootDir={{.DockerRootDir}}'
```

Expected: `aarch64`; DGX OS/Ubuntu identification; roughly 128 GB physical unified RAM (displayed capacity/available RAM will differ); GB10; a working Docker daemon and NVIDIA driver. `nvidia-smi` memory `N/A` alone is not a failure. If a Docker command needs permission, follow the permissions row below, then repeat this step. No upgrades are done by these commands.

Inspect free space on the filesystem shown as `DockerRootDir`; for a default installation:

```bash
df -h /var/lib/docker
```

If that path does not exist, use the actual path printed by `docker info` and inspect it locally. Reserve the disk budgets in the experiment card before a pull.

Only if standard host utilities are missing, and your apt repositories are the already-configured trusted DGX OS/Ubuntu repositories:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends python3 procps coreutils tar
```

This is an optional host package change, not a driver/container-toolkit installation. If Docker or NVIDIA Container Toolkit is absent, stop GPU setup and use Lenovo's supported provisioning route; the CPU fallback remains usable. Avoid generic x86 PyTorch wheels entirely.

### Step 2 — Host: create a fresh project and retain all companion files

Download `PGX52_Week02_Observability.zip` into **Downloads on the PGX**. The exact basename matters; do not move only `run_week02.sh` out of its package.

```bash
set -euo pipefail
umask 077
test -f "$HOME/Downloads/PGX52_Week02_Observability.zip"
test ! -L "$HOME/AI_PGX"
mkdir -p -- "$HOME/AI_PGX"
PGX_EXTRACT="$(mktemp -d "$HOME/AI_PGX/week02-observability.XXXXXX")"
export PGX_EXTRACT
python3 -m zipfile -e "$HOME/Downloads/PGX52_Week02_Observability.zip" "$PGX_EXTRACT"
export PGX_PROJECT="$PGX_EXTRACT/PGX52_Week02_Observability"
cd -- "$PGX_PROJECT"
test -f scripts/week02.py
test -f configs/full.json
test -f tests/test_week02.py
sha256sum -c SOURCE_SHA256SUMS.txt
printf 'Project path: %s\n' "$PGX_PROJECT"
```

Expected: a unique, user-owned project beneath `~/AI_PGX`, all source hashes `OK`. Save the printed absolute path for a later terminal. This path is deliberately separate from the root-owned `/AI_PGX` Week 1 location and does not migrate it.

### Step 3 — Host: inspect configurations and validate the pipeline without CUDA

```bash
cd -- "$PGX_PROJECT"
python3 -m json.tool configs/full.json
bash -n run_week02.sh
python3 -m unittest discover -s tests -v
bash run_week02.sh cpu
bash run_week02.sh report
```

Expected: seven tests pass; a fresh `results/<timestamp>-cpu` directory contains `status.json` with `complete`, CSV/JSON, `throughput.svg` and `dashboard.html`. CPU energy is intentionally unavailable. This ~5-second standard-library run is a pipeline test, not a PGX GPU performance result. It does not download Python wheels.

The configuration files are complete and supplied, not placeholders. Full: 4096 square, three pairs, 30-second measurement and warm-up per case, blocks of 256 multiplies, one-second sampling. Reduced: 2048 square, one pair, 15-second measurement, 10-second warm-up. CPU: 32 square, two-second cases. Do not silently edit the precision, seed, matrix size or success criteria during debugging.

### Step 4 — Host: acquire and immutably lock the official container

Read the container terms linked in `LICENSING.md`, then:

```bash
cd -- "$PGX_PROJECT"
bash run_week02.sh lock
cat manifests/image.lock
```

Expected: the wrapper checks `aarch64`, driver branch ≥580 and Docker access, pulls `--platform linux/arm64`, verifies the local image architecture, then records an actual `nvcr.io/nvidia/pytorch@sha256:...` registry digest. It refuses to overwrite an existing lock. The digest cannot responsibly be pre-invented in this document.

If the pull fails, no lock should be created. Do not run an unpulled image ID, use `latest`, substitute an amd64 image or install host torch to get past this checkpoint. A tag changing in the future does not change a successful existing lock.

### Step 5 — Host: capture exact runtime manifests

```bash
cd -- "$PGX_PROJECT"
bash run_week02.sh manifest
```

Expected: a timestamped `manifests/` folder containing OS/kernel/CPU, host package versions and architecture, driver details, container Python package freeze, container OS package inventory, CUDA compiler and Torch configuration, architecture list and source hashes. Preserve any actual runtime-version difference rather than editing the record to resemble documentation.

The following is an **optional container diagnostic**, not needed after a successful manifest. Run the first block on the **host**:

```bash
cd -- "$PGX_PROJECT"
IMAGE="$(< manifests/image.lock)"
docker run --rm -it --platform linux/arm64 --gpus all --network none \
  --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp:rw,nosuid,size=1g --env HOME=/tmp \
  --env NVIDIA_IMEX_CHANNELS=0 --entrypoint bash "$IMAGE"
```

Now run this block **inside that container shell**:

```bash
python - <<'PY'
import platform, torch
print('machine:', platform.machine())
print('torch:', torch.__version__, 'CUDA runtime:', torch.version.cuda)
print('architectures:', torch.cuda.get_arch_list())
assert platform.machine() == 'aarch64'
assert torch.cuda.is_available()
assert torch.cuda.get_device_capability(0) == (12, 1)
x = torch.randn(256, 256, device='cuda', dtype=torch.bfloat16)
y = x @ x
torch.cuda.synchronize()
assert torch.isfinite(y).all().item()
print('SM121 BF16 execution smoke: PASS')
PY
exit
```

Expected: capability 12.1 operation succeeds. This smoke is weaker than the full script's reference check; the benchmark still repeats that stronger gate. `exit` returns to the host. Never put host package-install commands inside this container.

### Step 6 — Host: run the selected experiment

For the default full scope:

```bash
cd -- "$PGX_PROJECT"
bash run_week02.sh run full
```

If deliberately reducing scope, use this **instead**:

```bash
cd -- "$PGX_PROJECT"
bash run_week02.sh run reduced
```

Expected: correctness passes before benchmarking; case summaries appear after each warm-up/measurement window; a new unique result directory is created; `status.json` ends as `complete`. The full run writes six case summaries. Prior results are never reused as a new result or overwritten. Memory-floor, architecture or correctness failure stops the run rather than falling back silently.

The wrapper executes the workload **inside the pinned container automatically**. It sets four CPU math threads, `HOME=/tmp`, a container-local CUDA cache and `NVIDIA_IMEX_CHANNELS=0`; disables network access; mounts only this project; drops capabilities; requests no privilege escalation; sets a read-only container root; and limits ordinary container RAM to 12 GiB without additional cgroup swap allowance. No port is published and no host Docker socket is mounted. The shared-memory allocation is capped at 1 GiB. GPU memory accounting is not fully guaranteed by these host-memory limits: the workload is deliberately small and checks host `MemAvailable` before allocation and between blocks.

This is not Week 1's ten single-multiply trial protocol. It intentionally uses long wall-clock blocks and independent on/off pairs to study observability. TFLOP/s here uses `2*N^3*completed_operations / wall_seconds`; synchronization and Python dispatch overhead are included in each block. End-to-end operations/s additionally includes guard checks and logging. Do not claim an improvement over Week 1 from this changed protocol.

### Step 7 — Host: monitoring and measurement interpretation

The on-condition logs each query's timestamp, duration, power, utilization, temperature, SM clock and host RAM/swap. Unavailable values stay `null`; unsupported fields or failed queries are preserved in `error`. No background collector runs during off cases. RAM guard checks and block logging run in both conditions.

For **diagnosis outside the paired benchmark**, use a second host terminal:

```bash
nvidia-smi -i 0 --query-gpu=power.draw,utilization.gpu,temperature.gpu,clocks.current.sm --format=csv
free -h
vmstat 1 10
nvidia-smi -q -d PERFORMANCE,POWER,TEMPERATURE,CLOCK
```

Expected: supported fields or explicit unsupported messages. Do not run `watch nvidia-smi`, external GPU monitoring or another GPU workload during the off/on comparison unless you deliberately define and record a new condition. Other monitoring would contaminate the off baseline. Keep normal cooling, original supplied power adapter and ventilation; never override clocks, power or thermal limits for this study.

Energy uses trapezoidal integration of adjacent valid samples, clipped/interpolated to the measured interval; no extrapolation across missing data. It requires ≥10 valid in-window samples and complete interval coverage, with no gap above 3.5 seconds. J/matmul divides this sensor-domain integral by the number of completed matrix multiplies. No idle subtraction is performed. The stop-boundary reading can reflect a transition to idle and the device may average power internally: publish the sampling cadence and these limitations, not an unsupported accuracy guarantee.

If a wall meter is already available, an optional separate extension measures total AC Wh over a long, synchronized workload window (ideally several minutes, excluding setup/download), logs start/end readings and completed operations, then computes `wall_J_per_matmul = 3600 * delta_Wh / completed_operations`. Account for meter resolution and other loads. Do not divide a long meter window by operations counted over only the script's short cases. If windows do not match, publish only the observed total AC Wh, not per-result energy. No meter purchase is required to complete observability.

### Step 8 — Host: evaluate, display and export

```bash
cd -- "$PGX_PROJECT"
bash run_week02.sh report
RUN_ID="$(< manifests/last-run.txt)"
export RUN_ID
python3 -m json.tool "results/$RUN_ID/summary.json"
python3 -m json.tool "results/$RUN_ID/status.json"
bash run_week02.sh export
```

Expected: all paired overhead values, their median and the ≤5% target result; raw block CV; separate energy availability/coverage; a `.tar.gz` export and SHA-256 printed. A partial run can be reported if at least one case completed; its status remains incomplete. If it failed before the first case, read `status.json` and the console log instead.

Open `results/<run-id>/dashboard.html` as a local file in your browser. Optional **host-only localhost service**, from the same terminal:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$PGX_PROJECT/results/$RUN_ID"
```

Expected: `http://127.0.0.1:8765/dashboard.html` on the PGX shows the dashboard. Only that run directory is served. Stop with Ctrl+C in that terminal. No `0.0.0.0`, public share, firewall opening, reverse proxy or external model endpoint is authorized here.

## 5. One-week work breakdown

| Date | Work and exit checkpoint |
|---|---|
| Mon 14 Sep | Record Week 1 completion/failures/scope; extract the whole package; preflight, CPU tests, image lock and SM121 gate. Keep the existing Week 1 results unchanged. |
| Tue 15 Sep | Inspect available telemetry fields and measurement boundaries outside formal timing. Confirm how missing power will be reported. |
| Wed 16 Sep | Run the full three-pair study with no competing workloads; retain every raw case and failure. |
| Thu 17 Sep | Review paired overhead and block CV. If noisy, repeat the same full configuration as a new run; change only one documented variable in any subsequent diagnostic study. |
| Fri 18 Sep | Complete manifests, tests and dashboard; review source/data/output/container licences and redact public copies of identifiers. |
| Sat 19 Sep | Record the 2–3-minute demo; show both a successful case and an unavailable/failed measurement honestly. |
| Sun 20 Sep | Freeze a source/results release candidate and write the concise post. Next target, 21–27 Sep: **Week 3, Arm64/SM121 framework compatibility atlas**. |

This remains a general-AI week in the agreed 26-general/26-signature programme. Its measurement contract will later support NanoChat, serving, quantization, vision/voice/video and agents, as well as confidential RAG, FHE, cyber-defence, time-series and digital twins. It does not replace the roadmap with only your research topics.

## 6. Troubleshooting — one observed step at a time

All commands in this table run on the **host**, unless marked container. Diagnostic commands are read-only; choose the fix only after matching the symptom.

| Symptom | Diagnostic commands | Likely cause | Safe fix / checkpoint |
|---|---|---|---|
| Missing `scripts/week02.py` | `pwd`; `ls -l run_week02.sh scripts/week02.py configs/full.json`; `sha256sum -c SOURCE_SHA256SUMS.txt` | Only launcher copied or wrong working directory | Extract the complete ZIP into a new unique directory; do not create an empty placeholder script. |
| Arm64 wheel fails / `Exec format error` | `uname -m`; `docker image inspect --format '{{.Architecture}}' nvcr.io/nvidia/pytorch:25.11-py3` | amd64 image or incompatible wheel | Return to native Arm64 official container; no pip install is required. Do not force x86 emulation or rename wheel tags. |
| `No such image` / no digest | `docker image ls --digests`; `cat manifests/image.lock` | Pull never completed, stale image ID, deleted cached image | Repeat the failed pull via `lock` if no lock exists. If locked but missing locally, validate and pull the exact lock as shown below; never substitute a new tag silently. |
| Driver/CUDA error / `could not select device driver` | `nvidia-smi`; `docker info`; `dpkg-query -W 'nvidia-container*'`; inspect container manifest error | Host driver/runtime integration missing or incompatible | Preserve logs, check Lenovo-supported stack and NVIDIA runtime configuration. Do not install toolkit/driver packages inside the compute container. Use CPU smoke until repaired. |
| `no kernel image`, invalid device function, unsupported PTX | Run the Step 5 container smoke and inspect capability/runtime/arch list | That binary/kernel path does not work on SM121, or PTX/driver mismatch | Stop at that operation. Retain the official digest and failure record. No `torch.compile`, FlashAttention, Triton or third-party extension is needed; do not switch to an arbitrary SM120 binary. CPU fallback is explicit. |
| BF16 reference check fails | Inspect `status.json`, console and container version manifest | Numerical/runtime issue, changed code/config or unexpected hardware | Do not raise the 2% tolerance. Preserve evidence and diagnose the exact multiply. Use CPU only to verify reporting, not to declare GPU correctness. |
| OOM / process killed / host memory pressure | `free -h`; `vmstat 1 10`; `docker stats --no-stream`; `journalctl -k -n 100 --no-pager` (may need admin read permission) | Competing unified-memory allocations, runtime memory use or cgroup limit | Stop only this named experiment. Close your own known competing jobs gracefully; use `reduced` as a separately labeled run. Do not globally drop caches, disable swap, or assume `nvidia-smi` N/A means free memory. |
| Disk/cache exhaustion | `df -h "$PGX_PROJECT"`; `docker system df`; `du -sh "$PGX_PROJECT/results" "$PGX_PROJECT/cache"` | Unpacked layers, accumulated runs or full filesystem | Export completed work, inspect exact paths, and remove only approved specific files. Do not run `docker system prune -a`, recursive cache wipes or broad `rm -rf`. |
| Docker permission denied | `id`; `ls -l /var/run/docker.sock`; `docker context show` | User lacks daemon access or wrong context | Follow your existing admin policy. Docker-group access is root-equivalent; do not silently add membership or chmod the socket. An authorized administrator may run only the necessary Docker operation with sudo, retaining the normal user's UID/GID for mounted files. |
| Output permission denied | `ls -ld "$PGX_PROJECT" "$PGX_PROJECT/results"`; `id` | Root-owned extraction, read-only bind or wrong UID | Fresh normal-user extraction is safest. Do not recursively chown `/AI_PGX`, `$HOME` or unrelated results. The wrapper already maps your UID/GID. |
| Local dashboard port busy | `ss -ltnp 'sport = :8765'` | Existing server on that port | Stop your own identified server or use port 8766 bound to `127.0.0.1`; never kill every Python process or open an external interface. |
| Model download or HF auth request | `python3 -m json.tool configs/full.json`; inspect the exact command | Wrong experiment/script; Week 2 has no model downloads | Stop that command. Do not supply model tokens. For registry 401/403, inspect NGC terms/access through the official registry workflow; do not paste credentials into logs or bypass access controls. |
| Registry timeout / DNS / rate limit | Retry the same failed pull later; inspect `docker info` locally | Network/registry issue | Keep existing images and results. Use the CPU fallback while waiting; do not select an unverified mirror. |
| Power/clock field unsupported | `nvidia-smi --help-query-gpu`; query each field separately | Field/API unsupported on that OEM/driver | Retain query errors and null energy. The supplied combined query deliberately fails closed; narrowing it is a versioned diagnostic change, not an invisible fallback. Host RAM/reporting still works. |
| Low throughput / high CV / overhead >5% | `nvidia-smi -q -d PERFORMANCE,POWER,TEMPERATURE,CLOCK`; `vmstat 1 10`; inspect per-block timeline and query duration | Thermal/power limits, concurrent work, memory pressure, dispatch overhead or collector cost | Record evidence first. Repeat unchanged after normal idle/cooling, then isolate one variable. Do not infer thermal throttling from variability alone or tune safety limits. If sampling is slow, a separate 2-second-cadence study is possible with a new config/hash and appropriately declared coverage rule. |

To restore an already-locked but locally missing image, **host**:

```bash
cd -- "$PGX_PROJECT"
IMAGE="$(< manifests/image.lock)"
if [[ "$IMAGE" =~ ^nvcr.io/nvidia/pytorch@sha256:[a-f0-9]{64}$ ]]; then
  docker pull --platform linux/arm64 "$IMAGE"
else
  printf 'Invalid image lock; stop.\n' >&2
fi
```

## 7. Publication checklist

### Repository structure

```text
week02-observability/
  README.md                 objective, hypothesis, protocol, commands, caveats
  LICENSING.md              dataset/model/output/container boundaries
  SOURCE_SHA256SUMS.txt      immutable delivered source checks
  run_week02.sh              host orchestration and named stop/export
  configs/{full,reduced,cpu}.json
  scripts/week02.py          workload, sampler, evaluator and dashboard generator
  tests/test_week02.py       integration-math and safety tests
  manifests/                exact environments; private originals, reviewed public copies
  results/<run-id>/          raw JSONL, status, config, per-case summary, CSV, SVG, HTML
  exports/                  bounded, hashed per-run archives
```

- **README outline:** problem; prior Week 1 evidence; hypothesis; hardware/runtime boundary; setup and reproduction; timing/energy definitions; results; failures; limitations; licences; next experiment.
- **Exact environment manifest:** actual image digest plus local architecture/image metadata; full Torch string and CUDA runtime/compiler; Python, OS/kernel, driver and NVIDIA runtime package versions; complete host/container package inventories; CPU thread settings; config/seed; source SHA-256; measurement date and status. Treat the lock, not a tag, as the reproducibility identifier. The host package snapshot supports audit, not automatic OS downgrade.
- **Raw and summarized results:** include every on/off case and failed attempt in private evidence. Publicly release reviewed JSONL blocks/telemetry, config, status, per-case summaries, `summary.csv`/JSON and sanitized environment records. The export excludes the private host manifest by default; add only a reviewed public copy separately. The ZIP itself contains no PGX result claims.
- **One recommended chart:** measured wall-block TFLOP/s versus elapsed time, blue for monitoring off and orange for on; gaps show warm-up. Supplied as SVG and embedded in the dashboard. It reveals instability hidden by a single median. Use the adjacent table for energy, rather than inventing an energy chart when readings are unavailable.
- **2–3-minute demo:** 0:00–0:30 state Week 1 correctness/stability distinction; 0:30–1:00 show Arm64/digest/SM121 gate; 1:00–1:45 show a completed paired timeline and overhead; 1:45–2:20 show missing-power behavior or a real failure; 2:20–2:45 reproduce the report and identify the next open question.
- **Failure cases:** unavailable power; incomplete/killed run; high collector overhead; high block CV; unsupported kernel; memory-floor refusal; invalid image lock; missing companion file. Use synthetic unit-test fixtures to demonstrate missing-power behavior, clearly labeled as fixtures, not fabricated hardware readings.
- **Risk card:** no customer/personal data; no model output risk this week; host/GPU identifiers and package inventories are sensitive operational metadata; source/telemetry publication requires review; no public ports; no production security targets; shared-memory accounting is imperfect; sampled power is not wall power; numerical check covers a slice and one operator path; thermal limits unchanged; software/package supply-chain licences retained.
- **Concise blog outline:** “Week 2: What does observing my PGX cost?” → Week 1 observation → fixed workload and measurement boundary → paired on/off result → energy availability and limitations → one failure → source/reproduction link → Week 3 compatibility atlas. Fill numerical claims only from actual completed PGX runs.

Do not upload container layers, tokens, private paths/hostnames/GPU UUIDs or unreviewed customer material to `alvin21mfmlai`. This package neither creates a GitHub repository nor pushes to one. Choose the publication licence and visibility explicitly before an eventual public release.

## 8. Safe stop, resume, checkpoint, rollback and cleanup

**Stop:** Ctrl+C in the foreground benchmark terminal. If it does not stop cleanly, open another host terminal, `cd` to the exact project path printed in Step 2, and run:

```bash
bash run_week02.sh stop
```

The wrapper validates the recorded timestamped container name and `pgx52.week=02` label, then stops only that container with a 30-second grace period. Do not use `killall`, `pkill python`, GPU reset or a global Docker stop. A container already removed is harmless; do not substitute another name. Ctrl+C stops the CPU fallback and localhost report server in their respective terminals.

**Checkpoint:** each completed block is flushed as JSONL, each completed case gets an atomic summary and `cases.json`, and run status is updated. A normal interrupt writes `incomplete`. A hard kill/power loss may leave `running`; absence of `complete` is never a successful completion. Export completed cases using the same run ID; no model checkpoint exists because there is no training.

**Resume analysis of an earlier run — host.** `RUN_ID_FROM_EARLIER_OUTPUT` below is a **manual placeholder**: replace the entire value with the exact previously printed run ID, not a path.

```bash
RUN_ID='RUN_ID_FROM_EARLIER_OUTPUT'
bash run_week02.sh report "$RUN_ID"
bash run_week02.sh export "$RUN_ID"
```

Expected: the wrapper validates the run-ID format and reads only the matching result folder. A partial run with no completed cases cannot be summarized; its raw logs and `status.json` remain inspectable.

**Resume measurement:** timing windows cannot be scientifically resumed in the middle. Re-run `bash run_week02.sh run full` (or the same deliberately selected reduced profile) to create a new ID with a fresh warm-up. Preserve and label the interrupted run. Compare like-for-like configs and immutable digests only.

**Rollback:** no host driver, clock, power or system configuration is changed by the core workflow. Exit the ephemeral container; return to the previous recorded digest/project. To trial a different image or edit configuration later, extract another fresh package directory and document the change. Never overwrite the original lock/results to make a new experiment look like the old one. Optional apt utility installation is not automatically reversed; inspect dependency impact before any later uninstall.

**Cleanup:** exports and result folders are kept by default. Container processes use `--rm`; `/tmp` and CUDA cache inside them disappear automatically at exit. There is no model cache to purge. To remove only an unused, empty project cache folder, run on the host from the project directory:

```bash
PROJECT_REAL="$(pwd -P)"
if [[ "$PROJECT_REAL" == "$HOME"/AI_PGX/week02-observability.*/PGX52_Week02_Observability ]] \
   && [[ -f "$PROJECT_REAL/scripts/week02.py" ]] \
   && [[ -d "$PROJECT_REAL/cache" && ! -L "$PROJECT_REAL/cache" ]]; then
  rmdir -- "$PROJECT_REAL/cache"
else
  printf 'Path validation failed; nothing removed.\n' >&2
fi
```

`rmdir` refuses a nonempty directory. Do not remove the shared NGC image: Week 1 or other projects may need it. No broad destructive cleanup commands are necessary. Before deleting a specific export or result in a file manager, validate the displayed absolute project path, verify an independent archive/hash and confirm it is not the only copy.

For live troubleshooting, paste the **section number, complete terminal command and complete output** (redact secrets and machine identifiers). We will diagnose one observed step at a time without silently changing the experiment, runtime, precision, seed or criteria.
