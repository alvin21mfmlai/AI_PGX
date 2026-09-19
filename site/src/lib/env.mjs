// Turn a results session's env/ inventory into a provenance panel. Every parser
// is optional: whatever files exist contribute rows; unknown files are listed
// as links so nothing captured is hidden.
import { formatBytes, readJSON, readText } from './util.mjs';
import path from 'node:path';

function grab(text, re) { const m = re.exec(text || ''); return m ? m[1].trim() : ''; }

export function parseEnv(envDir, envFiles, { repoFileUrl } = {}) {
  const items = [];
  const add = (group, label, value, extra = {}) => { if (value) items.push({ group, label, value: String(value), ...extra }); };
  const byName = new Map(envFiles.map((f) => [path.basename(f.rel), f]));
  const text = (name) => { const f = byName.get(name); return f ? readText(f.full) : null; };
  const json = (name) => { const f = byName.get(name); return f ? readJSON(f.full) : null; };

  const fw = json('framework.json');
  const gpu = text('gpu.txt');
  if (fw) {
    add('GPU', 'Device', fw.device || fw.device_name);
    if (Array.isArray(fw.compute_capability)) add('GPU', 'Compute capability', fw.compute_capability.join('.'), { mono: true });
    if (fw.device_count != null) add('GPU', 'Devices', fw.device_count);
  }
  if (gpu) {
    if (!fw) add('GPU', 'Device', grab(gpu, /\|\s+\d+\s+(NVIDIA [^|]+?)\s{2,}/));
    add('GPU', 'Driver', grab(gpu, /Driver Version:\s*([\d.]+)/), { mono: true });
    add('GPU', 'CUDA (driver)', grab(gpu, /CUDA Version:\s*([\d.]+)/), { mono: true });
    add('GPU', 'nvidia-smi', grab(gpu, /NVIDIA-SMI\s+([\d.]+)/), { mono: true });
  }
  if (fw) {
    add('Framework', 'PyTorch', fw.torch, { mono: true });
    add('Framework', 'CUDA runtime', fw.cuda_runtime, { mono: true });
    if (fw.cudnn) add('Framework', 'cuDNN', formatCudnn(fw.cudnn), { mono: true });
  }
  const lock = json('image-lock.json');
  if (lock) {
    add('Container', 'Image', lock.image_tag, { mono: true });
    if (lock.image_digest) add('Container', 'Digest', String(lock.image_digest).replace(/^.*@/, ''), { mono: true, truncate: true });
    add('Container', 'Architecture', lock.architecture, { mono: true });
  }
  const docker = text('docker.txt');
  if (docker) add('Container', 'Docker Engine', grab(docker, /Server:[\s\S]*?Version:\s*([\d.]+)/) || grab(docker, /Version:\s*([\d.]+)/), { mono: true });
  const runtime = text('runtime.txt');
  if (runtime) add('Container', 'NVIDIA Container Toolkit', grab(runtime, /cli-version:\s*([\d.]+)/), { mono: true });

  const os = text('os.txt');
  if (os) add('Host', 'OS', grab(os, /PRETTY_NAME="?([^"\n]+)"?/));
  const host = json('host.json');
  if (host) {
    add('Host', 'Kernel', host.os);
    add('Host', 'Architecture', host.architecture, { mono: true });
    add('Host', 'Python (host)', grab(String(host.python || ''), /^([\d.]+)/), { mono: true });
    if (host.free_disk_bytes) add('Host', 'Free disk', formatBytes(host.free_disk_bytes));
  }
  const cpu = text('cpu.txt');
  if (cpu) {
    const models = [...cpu.matchAll(/Model name:\s*(.+)/g)].map((m) => m[1].trim());
    const cores = [...cpu.matchAll(/Core\(s\) per socket:\s*(\d+)/g)].map((m) => Number(m[1]));
    const total = grab(cpu, /^CPU\(s\):\s*(\d+)/m);
    const desc = models.length ? models.map((m, i) => (cores[i] ? `${cores[i]}× ${m}` : m)).join(' + ') : '';
    add('Host', 'CPU', desc ? `${total ? total + ' cores: ' : ''}${desc}` : total ? `${total} cores` : '');
  }
  const mem = text('memory.txt');
  const spaced = (v) => String(v).replace(/^([\d.]+)([A-Za-z]+)$/, '$1 $2');
  if (mem) {
    const total = grab(mem, /Mem:\s+(\S+)/);
    add('Host', 'Memory', total ? `${spaced(total)}B total` : '');
    const swap = grab(mem, /Swap:\s+(\S+)/);
    if (swap && swap !== '0B') add('Host', 'Swap', `${spaced(swap)}B`);
  } else {
    const meminfo = text('meminfo.txt');
    const kb = Number(grab(meminfo, /MemTotal:\s*(\d+)/));
    if (kb) add('Host', 'Memory', formatBytes(kb * 1024));
  }
  const storage = text('storage.txt');
  if (storage) {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/m.exec(storage.split('\n').slice(1).join('\n'));
    if (m) add('Host', 'Storage', `${spaced(m[3])}B ${m[2]}, ${spaced(m[5])}B free (${m[1]})`);
  }
  const git = json('source-git.json');
  if (git && git.commit) {
    add('Source', 'Commit', String(git.commit).slice(0, 12), { mono: true, href: repoFileUrl ? repoFileUrl(`commit/${git.commit}`) : '' });
    if (git.working_tree_status && String(git.working_tree_status).trim()) add('Source', 'Working tree', 'had local changes at run time (recorded)');
  }
  const pkgs = byName.get('host-packages.txt');
  if (pkgs) add('Host', 'Package inventory', 'captured', { href: repoFileUrl ? repoFileUrl(`blob/${pkgs.rel}`) : '', hrefLabel: 'host-packages.txt' });

  return { items, files: envFiles.map((f) => f.rel) };
}

function formatCudnn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 10000) { const major = Math.floor(n / 10000); const minor = Math.floor((n % 10000) / 100); const patch = n % 100; return `${major}.${minor}.${patch}`; }
  return String(v);
}
