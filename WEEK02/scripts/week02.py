#!/usr/bin/env python3
"""PGX-52 Week 2. Stdlib reporting/telemetry; PyTorch only for CUDA workload."""
import argparse
import csv
import hashlib
import html
import json
import math
import os
import platform
import random
import signal
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path


def dump(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 else None
    except (TypeError, ValueError):
        return None


def memory():
    data = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        if key in ('MemAvailable', 'MemTotal', 'SwapFree', 'SwapTotal'):
            data[key + '_gib'] = int(value.split()[0]) / 1048576
    return data


def energy(samples, start, end, max_gap=3.5):
    """Integrate only valid, short adjacent intervals; do not bridge missing rows."""
    total = covered = 0.0
    valid_count = sum(s.get('power_w') is not None and start <= s['mono'] <= end
                      for s in samples)
    for a, b in zip(samples, samples[1:]):
        dt = b['mono'] - a['mono']
        if a.get('power_w') is None or b.get('power_w') is None or not 0 < dt <= max_gap:
            continue
        lo, hi = max(start, a['mono']), min(end, b['mono'])
        if hi <= lo:
            continue
        slope = (b['power_w'] - a['power_w']) / dt
        plo = a['power_w'] + slope * (lo - a['mono'])
        phi = a['power_w'] + slope * (hi - a['mono'])
        total += (plo + phi) * (hi - lo) / 2
        covered += hi - lo
    coverage = covered / (end - start) if end > start else 0
    # No zero-filling and no extrapolation of unmeasured portions.
    ok = coverage >= 0.999999 and valid_count >= 10 and total > 0
    return {'energy_j': total if ok else None, 'coverage': coverage,
            'valid_power_samples': valid_count,
            'energy_status': 'sensor-domain estimate' if ok else 'unavailable: missing/short/invalid power trace'}


class Sampler:
    def __init__(self, path, interval, gpu):
        self.path, self.interval, self.gpu = path, interval, gpu
        self.rows, self.stop = [], threading.Event()
        self.thread = None

    def sample(self):
        start = time.monotonic()
        row = {'utc': time.time(), **memory(), 'power_w': None,
               'util_pct': None, 'temp_c': None, 'sm_mhz': None, 'error': None}
        if self.gpu:
            try:
                p = subprocess.run(['nvidia-smi', '-i', '0',
                    '--query-gpu=power.draw,utilization.gpu,temperature.gpu,clocks.current.sm',
                    '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3)
                values = next(csv.reader(p.stdout.splitlines()), [])
                if p.returncode == 0 and len(values) == 4:
                    for key, value in zip(('power_w', 'util_pct', 'temp_c', 'sm_mhz'), values):
                        row[key] = number(value.strip())
                else:
                    row['error'] = (p.stderr or p.stdout or 'query failed')[:500]
            except (OSError, subprocess.TimeoutExpired) as exc:
                row['error'] = str(exc)[:500]
        finish = time.monotonic()
        row.update(mono=(start + finish) / 2, query_seconds=finish - start)
        self.rows.append(row)
        with self.path.open('a') as f:
            f.write(json.dumps(row, allow_nan=False) + '\n')

    def loop(self):
        while not self.stop.wait(self.interval):
            self.sample()

    def begin(self):
        self.sample()
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def end(self):
        self.stop.set()
        self.thread.join()
        self.sample()


def validate(c):
    assert c['backend'] in ('cuda', 'cpu-stdlib')
    assert 1 <= c['pairs'] <= 6 and 0 < c['seconds'] <= 300
    assert 0 <= c['warmup_seconds'] <= 120 and 1 <= c['batch'] <= 1024
    assert 0.1 <= c['sample_seconds'] <= 10
    assert 0 < c['correctness_tolerance'] <= 0.02
    assert 0 <= c['min_available_gib'] <= 100
    assert 0 < c['max_gap_seconds'] <= 30
    assert 8 <= c['n'] <= (8192 if c['backend'] == 'cuda' else 128)


def workload(c):
    n = c['n']
    if c['backend'] == 'cpu-stdlib':
        rng = random.Random(c['seed'])
        a = [[rng.random() - 0.5 for _ in range(n)] for _ in range(n)]
        b = [[rng.random() - 0.5 for _ in range(n)] for _ in range(n)]
        bt = list(zip(*b))
        def op():
            return [[sum(x * y for x, y in zip(row, col)) for col in bt] for row in a]
        got = op()
        ref = sum(a[0][k] * b[k][0] for k in range(n))
        assert abs(got[0][0] - ref) < 1e-12
        return op, lambda: None, {'backend': 'cpu-stdlib', 'dtype': 'Python float',
            'correctness_error': 0.0, 'correctness_scope': 'CPU pipeline smoke only; not CUDA validation'}
    import torch
    assert platform.machine() == 'aarch64', 'CUDA run requires native Arm64; no x86 emulation'
    assert torch.cuda.is_available(), 'CUDA unavailable; stop rather than silently use CPU'
    assert torch.cuda.get_device_capability(0) == (12, 1), 'Expected GB10 capability 12.1'
    torch.set_num_threads(4)
    torch.manual_seed(c['seed'])
    torch.backends.cuda.matmul.allow_tf32 = False
    a_cpu, b_cpu = torch.randn(n, n), torch.randn(n, n)
    a, b = a_cpu.to('cuda', dtype=torch.bfloat16), b_cpu.to('cuda', dtype=torch.bfloat16)
    out = torch.empty((n, n), device='cuda', dtype=torch.bfloat16)
    def op():
        torch.mm(a, b, out=out)
    op()
    torch.cuda.synchronize()
    # Check 16 x 16 output entries against CPU FP32, retaining the complete K dimension.
    ref = a_cpu[:16, :] @ b_cpu[:, :16]
    err = ((out[:16, :16].float().cpu() - ref).norm() / ref.norm()).item()
    assert math.isfinite(err) and err <= c['correctness_tolerance'], f'BF16 correctness failed: {err}'
    assert torch.isfinite(out).all().item(), 'Non-finite output'
    meta = {'backend': 'cuda', 'dtype': 'BF16', 'torch': torch.__version__,
            'cuda_runtime': torch.version.cuda, 'device': torch.cuda.get_device_name(0),
            'capability': list(torch.cuda.get_device_capability(0)),
            'arch_list': torch.cuda.get_arch_list(), 'correctness_error': err,
            'correctness_scope': '16x16 output slice with full K against unquantized CPU FP32',
            'allocated_bytes': torch.cuda.memory_allocated(),
            'reserved_bytes': torch.cuda.memory_reserved()}
    del a_cpu, b_cpu
    return op, torch.cuda.synchronize, meta


def run(config, out):
    c = json.loads(config.read_text())
    validate(c)
    out.mkdir(parents=True, exist_ok=False)
    dump(out / 'config.json', c)
    dump(out / 'status.json', {'status': 'running'})
    def term(_sig, _frame):
        raise KeyboardInterrupt('requested stop')
    signal.signal(signal.SIGTERM, term)
    try:
        assert memory()['MemAvailable_gib'] >= c['min_available_gib'], 'Insufficient available unified RAM'
        op, sync, meta = workload(c)
        meta.update(python=sys.version, machine=platform.machine(), kernel=platform.release(),
                    script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    started_utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        dump(out / 'environment.json', meta)
        cases = []
        for pair in range(c['pairs']):
            # Alternate pair order to reduce, but not eliminate, warm-order confounding.
            for observed in ([False, True] if pair % 2 == 0 else [True, False]):
                case_id = f'p{pair+1}-' + ('on' if observed else 'off')
                target = time.monotonic() + c['warmup_seconds']
                while time.monotonic() < target:
                    op()
                    sync()
                sampler = Sampler(out / f'{case_id}-telemetry.jsonl', c['sample_seconds'], c['backend'] == 'cuda') if observed else None
                if sampler:
                    sampler.begin()
                blocks = []
                sync()
                start = time.monotonic()
                try:
                    with (out / f'{case_id}-blocks.jsonl').open('x') as raw:
                        while time.monotonic() - start < c['seconds']:
                            assert memory()['MemAvailable_gib'] >= c['min_available_gib'], 'Available RAM crossed safety floor'
                            bstart = time.monotonic()
                            for _ in range(c['batch']):
                                op()
                            sync()
                            bend = time.monotonic()
                            row = {'mono_start': bstart, 'mono_end': bend,
                                   'operations': c['batch'], 'seconds': bend - bstart,
                                   'tflops': 2 * c['n'] ** 3 * c['batch'] / (bend - bstart) / 1e12}
                            raw.write(json.dumps(row) + '\n')
                            raw.flush()
                            blocks.append(row)
                    end = time.monotonic()
                finally:
                    if sampler:
                        sampler.end()
                nops = sum(b['operations'] for b in blocks)
                rates = [b['tflops'] for b in blocks]
                cv = statistics.stdev(rates) / statistics.mean(rates) if len(rates) > 1 else None
                e = energy(sampler.rows if sampler else [], start, end, c['max_gap_seconds'])
                samples = sampler.rows if sampler else []
                active = [s for s in samples if start <= s['mono'] <= end]
                case = {'case': case_id, 'pair': pair+1, 'observed': observed,
                        'start': start, 'end': end, 'operations': nops,
                        'wall_seconds': end-start, 'ops_per_second': nops/(end-start),
                        'median_block_tflops': statistics.median(rates),
                        'block_cv': cv, 'blocks': len(blocks),
                        'min_available_gib': min((s['MemAvailable_gib'] for s in active), default=None),
                        'max_query_seconds': max((s['query_seconds'] for s in active), default=None),
                        **e, 'joules_per_matmul': e['energy_j']/nops if e['energy_j'] is not None else None}
                if c['backend'] == 'cuda':
                    import torch
                    case['torch_peak_allocated_bytes'] = torch.cuda.max_memory_allocated()
                    case['torch_peak_reserved_bytes'] = torch.cuda.max_memory_reserved()
                cases.append(case)
                dump(out / f'{case_id}-summary.json', case)
                dump(out / 'cases.json', cases)
                print(json.dumps(case), flush=True)
        dump(out / 'status.json', {'status': 'complete'})
    except BaseException as exc:
        dump(out / 'status.json', {'status': 'incomplete', 'error': str(exc), 'type': type(exc).__name__})
        raise


def report(out):
    cases = json.loads((out / 'cases.json').read_text())
    env = json.loads((out / 'environment.json').read_text())
    status = json.loads((out / 'status.json').read_text())
    overhead = []
    for pair in sorted({c['pair'] for c in cases}):
        off = next((c for c in cases if c['pair'] == pair and not c['observed']), None)
        on = next((c for c in cases if c['pair'] == pair and c['observed']), None)
        if off and on:
            overhead.append(100 * (1 - on['ops_per_second'] / off['ops_per_second']))
    estimate = statistics.median(overhead) if overhead else None
    summary = {'status': status['status'], 'backend': env['backend'],
               'paired_overhead_percent': overhead, 'median_overhead_percent': estimate,
               'overhead_target_met': estimate <= 5 if estimate is not None else None,
               'interpretation': 'Negative overhead is apparent speedup/noise; three pairs are descriptive, not causal proof.',
               'energy_boundary': 'nvidia-smi power.draw sensor domain; not wall energy, not idle-subtracted',
               'cases': cases}
    dump(out / 'summary.json', summary)
    with (out / 'summary.csv').open('w', newline='') as f:
        fields = ['case', 'operations', 'wall_seconds', 'ops_per_second', 'median_block_tflops',
                  'block_cv', 'energy_j', 'joules_per_matmul', 'coverage', 'energy_status']
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        w.writerows(cases)
    # One measured time-series chart: block throughput across all completed cases.
    svg = ['<svg viewBox="0 0 960 360" role="img" aria-label="Block throughput across completed cases">',
           '<rect width="960" height="360" fill="white"/>']
    all_blocks = [(c, [json.loads(x) for x in (out / (c['case']+'-blocks.jsonl')).read_text().splitlines()]) for c in cases]
    span = max(c['end'] for c in cases) - min(c['start'] for c in cases)
    t0 = min(c['start'] for c in cases)
    ymax = max(b['tflops'] for _, blocks in all_blocks for b in blocks) * 1.1
    svg.append('<path d="M70 20 V300 H940" fill="none" stroke="#444"/>')
    svg.append(f'<text x="10" y="18">TFLOP/s (wall blocks), max {ymax:.4g}</text>')
    for c, blocks in all_blocks:
        pts = ' '.join(f"{70+860*(b['mono_end']-t0)/max(span,1e-9):.2f},{300-260*b['tflops']/max(ymax,1e-12):.2f}" for b in blocks)
        color = '#c25a12' if c['observed'] else '#2167ae'
        svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"/>')
    svg.append(f'<text x="70" y="330">0 s</text><text x="800" y="330">{span:.1f} s</text></svg>')
    (out / 'throughput.svg').write_text('\n'.join(svg))
    table = ''.join('<tr>' + ''.join(f'<td>{html.escape(str(c[k]))}</td>' for k in
                    ('case', 'median_block_tflops', 'block_cv', 'joules_per_matmul', 'energy_status')) + '</tr>' for c in cases)
    page = '<!doctype html><meta charset="utf-8"><title>PGX-52 Week 2</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}svg{width:100%}</style>'
    page += '<h1>PGX-52 Week 2: Observability</h1><p>Blue: monitoring off. Orange: monitoring on. Gaps: warm-up. Missing energy is not zero.</p>'
    page += f'<p>Backend: {html.escape(env["backend"])}. Run status: {html.escape(status["status"])}. Median paired monitoring overhead: {estimate}%.</p>'
    page += ''.join(svg) + '<table><tr><th>Case</th><th>Median TFLOP/s</th><th>Block CV</th><th>J/matmul</th><th>Energy status</th></tr>' + table + '</table>'
    page += '<p>Sensor-domain energy estimate only; no claim of wall-socket energy. Block CV is not the Week 1 ten-trial variability metric.</p>'
    (out / 'dashboard.html').write_text(page)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=['run', 'report'])
    p.add_argument('--config', type=Path)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    if args.action == 'run':
        if not args.config:
            p.error('--config is required for run')
        run(args.config, args.out)
    else:
        report(args.out)
