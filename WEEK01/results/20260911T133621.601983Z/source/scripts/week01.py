#!/usr/bin/env python3
"""One command: check the PGX, benchmark, plot, summarize, and archive."""
import argparse
import csv
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
TAG = 'nvcr.io/nvidia/pytorch:25.11-py3'
DIGEST_RE = re.compile(r'nvcr\.io/nvidia/pytorch@sha256:[0-9a-f]{64}')
SOURCES = ('run_week01.sh', 'README.md', 'benchmarks/torch_baseline.py',
           'scripts/week01.py', 'scripts/plot_results.py', 'scripts/monitor_host.sh')


def stamp():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def run_logged(args, log, *, required=True):
    """Capture all container banners; show the relevant log on a failure."""
    with log.open('w') as handle:
        result = subprocess.run(args, stdout=handle, stderr=subprocess.STDOUT)
    if required and result.returncode:
        tail = '\n'.join(log.read_text(errors='replace').splitlines()[-24:])
        raise RuntimeError(f'Command failed (exit {result.returncode}). Log: {log}\n{tail}')
    return result.returncode


def inspect_image(reference):
    result = subprocess.run(['docker', 'image', 'inspect', reference], capture_output=True, text=True)
    if result.returncode:
        if 'No such image' in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip() or 'Docker image inspection failed.')
    return json.loads(result.stdout)[0]


def prepare_image(results, session, explicit=None):
    lock_file = results / 'image-lock.json'
    if lock_file.is_symlink():
        raise RuntimeError('results/image-lock.json must be a regular file.')
    digest = None
    if lock_file.exists():
        digest = json.loads(lock_file.read_text())['image_digest']
        if not DIGEST_RE.fullmatch(digest):
            raise RuntimeError('The saved image digest is invalid; preserve the lock file for troubleshooting.')
        if explicit and explicit != digest:
            raise RuntimeError('The requested digest differs from this repository\'s saved image lock.')
    elif explicit:
        digest = explicit
    reference = digest or TAG
    info = inspect_image(reference)
    if info is None:
        log = session / 'logs/image-pull.log'
        print(f'  Downloading {reference}; progress is recorded in {log}', flush=True)
        run_logged(['docker', 'pull', reference], log)
        info = inspect_image(reference)
    if info is None or info.get('Architecture') != 'arm64':
        raise RuntimeError('The selected image must be arm64.')
    if digest is None:
        candidates = {item for item in info.get('RepoDigests', []) if DIGEST_RE.fullmatch(item)}
        if len(candidates) != 1:
            raise RuntimeError('Cannot identify exactly one NVIDIA PyTorch digest for this image.')
        digest = candidates.pop()
    lock = {'image_tag': TAG, 'image_digest': digest, 'architecture': 'arm64'}
    if not lock_file.exists():
        with lock_file.open('x') as handle:
            json.dump(lock, handle, indent=2)
            handle.write('\n')
    write_json(session / 'env/image-lock.json', lock)
    write_json(session / 'env/container-inspect.json', info)
    return digest


def container_command(session, digest, name, args):
    # All container stages have the same GPU/runtime flags. Output is headless.
    return ['docker', 'run', '--rm', '--name', name, '--gpus', 'all', '--ipc=host',
            '--user', f'{os.getuid()}:{os.getgid()}', '--env', 'HOME=/tmp',
            '--env', 'MPLCONFIGDIR=/tmp/matplotlib', '--env', 'MPLBACKEND=Agg',
            '--mount', f'type=bind,src={session / "source"},dst=/src,readonly',
            '--mount', f'type=bind,src={session},dst=/work', '--workdir', '/work',
            digest, *args]


def execute_container(session, digest, stage, args, *, monitor=False):
    name = 'pgx52-w01-' + session.name + '-' + stage
    monitor_process = None
    monitor_log = None
    if monitor:
        monitor_log = (session / f'logs/monitor-{stage}.log').open('w')
        monitor_process = subprocess.Popen(
            ['bash', str(session / 'source/scripts/monitor_host.sh'),
             str(session / f'raw/host-monitor-{stage}.csv'), '1'],
            stdout=monitor_log, stderr=subprocess.STDOUT)
    try:
        run_logged(container_command(session, digest, name, args), session / f'logs/{stage}.log')
    finally:
        # Each stage has its own unique name. No other container is touched.
        try:
            subprocess.run(['docker', 'stop', '--time', '10', name],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        except (OSError, subprocess.SubprocessError) as exc:
            print(f'Cleanup could not confirm container {name}: {exc}', file=sys.stderr)
        finally:
            if monitor_process is not None and monitor_process.poll() is None:
                monitor_process.terminate()
                try:
                    monitor_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    monitor_process.kill()
                    monitor_process.wait()
            if monitor_log is not None:
                monitor_log.close()


def inventory(session):
    write_json(session / 'env/host.json', {
        'captured_utc': session.name, 'architecture': platform.machine(),
        'os': platform.platform(), 'python': sys.version,
        'free_disk_bytes': shutil.disk_usage(ROOT).free,
    })
    probes = {
        'os': ['cat', '/etc/os-release'], 'cpu': ['lscpu'],
        'memory': ['free', '-h'], 'meminfo': ['cat', '/proc/meminfo'],
        'storage': ['df', '-hT', str(ROOT)], 'gpu': ['nvidia-smi'],
        'docker': ['docker', 'version'], 'runtime': ['nvidia-container-cli', '--version'],
        'host-packages': ['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\n'],
    }
    for label, args in probes.items():
        path = session / f'env/{label}.txt'
        try:
            run_logged(args, path, required=False)
        except FileNotFoundError as exc:
            path.write_text(str(exc) + '\n')
    if shutil.which('git'):
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'],
                                capture_output=True, text=True)
        status = subprocess.run(['git', '-C', str(ROOT), 'status', '--porcelain'],
                                capture_output=True, text=True)
        write_json(session / 'env/source-git.json', {
            'commit': commit.stdout.strip() if commit.returncode == 0 else None,
            'working_tree_status': status.stdout if status.returncode == 0 else None,
        })


def preflight(session, digest):
    smoke = '''import json,platform,torch
assert platform.machine()=="aarch64", "Expected Arm64 container"
assert torch.cuda.is_available(), "CUDA unavailable"
assert torch.cuda.device_count()==1, "Expected exactly one CUDA device"
assert list(torch.cuda.get_device_capability(0))==[12,1], "Expected capability 12.1"
x=torch.ones(256,256,device="cuda",dtype=torch.bfloat16)
y=x@x
torch.cuda.synchronize()
assert float(y[0,0])==256.0, "Smoke-test mismatch"
info={"architecture":platform.machine(),"torch":torch.__version__,"cuda_runtime":torch.version.cuda,"device":torch.cuda.get_device_name(0),"compute_capability":list(torch.cuda.get_device_capability(0)),"device_count":torch.cuda.device_count(),"kernel_result":float(y[0,0])}
open("env/framework.json","w").write(json.dumps(info,indent=2)+"\\n")
'''
    execute_container(session, digest, 'preflight', ['python', '-c', smoke])
    execute_container(session, digest, 'python-packages', ['python', '-m', 'pip', 'freeze', '--all'])


def benchmark(session, digest, number):
    run_id = f'{session.name}-run{number:02d}'
    (session / f'env/container-lock-{run_id}.env').write_text(
        f'IMAGE_TAG={TAG}\nIMAGE_ARCH=arm64\nIMAGE_DIGEST={digest}\n')
    execute_container(session, digest, f'run{number:02d}', [
        'python', '/src/benchmarks/torch_baseline.py',
        '--output-json', f'raw/torch-baseline-{run_id}.json',
        '--output-csv', f'raw/torch-baseline-{run_id}.csv',
        '--size', '4096', '--warmup', '5', '--trials', '10', '--seed', '5201'], monitor=True)
    data = json.loads((session / f'raw/torch-baseline-{run_id}.json').read_text())
    correct = data['correctness']
    config = data['configuration']
    passed = (data['platform']['architecture'] == 'aarch64'
              and data['platform']['compute_capability'] == [12, 1]
              and correct['finite'] is True
              and math.isfinite(correct['relative_l2_error'])
              and 0 <= correct['relative_l2_error'] <= 0.02
              and len(data['trials']) == 10
              and all(config[key] == value for key, value in
                      {'size': 4096, 'warmup': 5, 'trials': 10, 'seed': 5201}.items()))
    if not passed:
        raise RuntimeError(f'Run {number} failed the original correctness/configuration checks.')
    summary = data['summary']
    state = 'PASS' if summary['stability_pass'] else 'WARNING'
    print(f'  Run {number}: correctness PASS | median {summary["median_tflops"]:.2f} TFLOP/s'
          f' | variability {summary["coefficient_of_variation"]:.2%} | stability {state}', flush=True)
    return data


def report(session, digest, data):
    lines = ['# Week 01 results', '', f'Session: `{session.name}`', '',
             '| Run | Correctness | Relative L2 error | Median TFLOP/s | Variability | Stability |',
             '|---|---|---:|---:|---:|---|']
    for i, result in enumerate(data, 1):
        summary = result['summary']
        state = 'PASS' if summary['stability_pass'] else 'WARNING'
        lines.append(f'| {i} | PASS | {result["correctness"]["relative_l2_error"]:.3%}'
                     f' | {summary["median_tflops"]:.2f} | {summary["coefficient_of_variation"]:.2%} | {state} |')
    lines += ['', f'Image: `{digest}`', '',
              'Workload: 4096 × 4096 BF16; 5 warm-ups; 10 timed trials per run; seed 5201.', '',
              'A stability warning means throughput CV > 10%; the saved measurement remains valid.',
              'These back-to-back measurements characterize this synthetic workload, not LLM performance.',
              'The numerical reference covers a smaller 256 × 256 calculation; timed trials check one output element.', '',
              '![Throughput by trial](throughput.png)', '']
    (session / 'summary.md').write_text('\n'.join(lines))


def package(session):
    files = sorted(path for path in session.rglob('*') if path.is_file())
    if any(path.is_symlink() for path in files):
        raise RuntimeError('Unexpected symlink in this result session.')
    checksums = ''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' +
                        path.relative_to(session).as_posix() + '\n' for path in files)
    (session / 'SHA256SUMS').write_text(checksums)
    for line in checksums.splitlines():
        expected, relative = line.split('  ', 1)
        if hashlib.sha256((session / relative).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Checksum verification failed: ' + relative)
    archive = session.parent / f'week01-{session.name}.tar.gz'
    with tarfile.open(archive, 'x:gz') as handle:
        handle.add(session, arcname=session.name)
    archive.with_name(archive.name + '.sha256').write_text(
        hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
    return archive


def update_link(link, target, session_id):
    temporary = link.with_name(link.name + '-' + session_id + '.tmp')
    temporary.symlink_to(target)
    temporary.replace(link)


def workflow(results, count, explicit=None):
    session = results / stamp()
    session.mkdir(mode=0o700)
    for name in ('raw', 'env', 'logs', 'source'):
        (session / name).mkdir()
    # Archive exactly the source files used by this session. No source installation.
    for relative in SOURCES:
        target = session / 'source' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
    print('Week 01 — results:', session, flush=True)
    try:
        print('[1/4] Checking platform and the pinned NVIDIA image...', flush=True)
        inventory(session)
        digest = prepare_image(results, session, explicit)
        preflight(session, digest)
        print(f'[2/4] Running {count} benchmark repetition(s)...', flush=True)
        observations = [benchmark(session, digest, index) for index in range(1, count + 1)]
        print('[3/4] Generating the chart, CSV, and summary...', flush=True)
        execute_container(session, digest, 'plot', ['python', '/src/scripts/plot_results.py',
                                                 '--project-root', '/work'])
        report(session, digest, observations)
        print('[4/4] Verifying checksums and creating the archive...', flush=True)
        archive = package(session)
        update_link(results / 'latest', session.name, session.name)
        update_link(results / 'latest.tar.gz', archive.name, session.name)
        warnings = sum(not result['summary']['stability_pass'] for result in observations)
        print(f'\nCOMPLETE — {count} run(s); {warnings} stability warning(s).')
        print('Summary: ' + str(results / 'latest/summary.md'))
        print('Chart:   ' + str(results / 'latest/throughput.png'))
        print('CSV:     ' + str(results / 'latest/runs.csv'))
        print('Archive: ' + str(results / 'latest.tar.gz'))
        print('\nView in this SSH terminal: cat results/latest/summary.md')
        print('Download the chart or archive using your SSH client\'s file transfer/SFTP.')
    except BaseException:
        print(f'\nThis attempt did not complete. Its logs and partial results are retained at {session}', file=sys.stderr)
        raise


def interrupt(signum, frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=3, help='benchmark repetitions (default: 3)')
    parser.add_argument('--image-digest', help='optional exact digest for a new repository image lock')
    args = parser.parse_args()
    if not 1 <= args.runs <= 100:
        parser.error('--runs must be between 1 and 100')
    if args.image_digest and not DIGEST_RE.fullmatch(args.image_digest):
        parser.error('--image-digest must be a full NVIDIA PyTorch SHA-256 reference')
    if platform.machine() != 'aarch64':
        raise RuntimeError('Run this on the PGX Linux host (aarch64).')
    if os.geteuid() == 0:
        raise RuntimeError('Run as your normal PGX user, without sudo.')
    if not shutil.which('docker'):
        raise RuntimeError('Docker is required on the PGX.')
    subprocess.run(['docker', 'info'], stdout=subprocess.DEVNULL, check=True)
    for relative in SOURCES:
        if not (ROOT / relative).is_file():
            raise RuntimeError('Clone the complete repository. Missing: ' + relative)
    if shutil.disk_usage(ROOT).free < 40 * 1024**3:
        raise RuntimeError('At least 40 GiB free on the repository filesystem is required.')
    results = ROOT / 'results'
    if results.is_symlink():
        raise RuntimeError('The repository results directory must not be a symlink.')
    results.mkdir(exist_ok=True)
    for name in ('latest', 'latest.tar.gz'):
        path = results / name
        if path.exists() and not path.is_symlink():
            raise RuntimeError(f'{path} must be absent or a generated symlink; existing content was preserved.')
    lock = results / '.operation-lock'
    if lock.is_symlink():
        raise RuntimeError('The operation lock must be a regular file.')
    os.chdir(ROOT)
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGHUP, interrupt)
    with lock.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another Week 01 run is active in this repository.')
        workflow(results, args.runs, args.image_digest)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('STOP: interrupted; previous results were preserved.', file=sys.stderr)
        sys.exit(130)
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print('STOP:', exc, file=sys.stderr)
        sys.exit(1)
