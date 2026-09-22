// Turn whatever environment inventory a week recorded into a provenance panel.
// Sources are matched by file name, so both the Week 01 layout (results/<s>/env/*.txt
// + framework.json) and the Week 02 layout (results/<s>/environment.json +
// manifests/<stamp>/{host,container,nvidia-smi*}.txt + image.lock) work, and
// unknown layouts degrade to a link list. Machine identifiers (GPU UUIDs, serial
// numbers, hostnames) are deliberately never copied onto the page.
import path from 'node:path';
import { formatBytes, readJSON, readText, parseStamp } from './util.mjs';
import { formatValue } from './jsondata.mjs';
import { labelFor } from './csv.mjs';

function grab(text, re) { const m = re.exec(text || ''); return m ? m[1].trim() : ''; }
const spaced = (v) => String(v).replace(/^([\d.]+)([A-Za-z]+)$/, '$1 $2');

const JSON_KEYS = {
  torch: ['Framework', 'PyTorch', { mono: true }], torch_version: ['Framework', 'PyTorch', { mono: true }],
  cuda_runtime: ['Framework', 'CUDA runtime', { mono: true }], cuda: ['Framework', 'CUDA runtime', { mono: true }], cudnn: ['Framework', 'cuDNN', { mono: true }],
  backend: ['Framework', 'Backend', { mono: true }], dtype: ['Framework', 'Precision', { mono: true }], arch_list: ['Framework', 'Compiled arch list', { mono: true }],
  device: ['GPU', 'Device'], device_name: ['GPU', 'Device'], capability: ['GPU', 'Compute capability', { mono: true }], compute_capability: ['GPU', 'Compute capability', { mono: true }],
  device_count: ['GPU', 'Devices'], driver: ['GPU', 'Driver', { mono: true }], driver_version: ['GPU', 'Driver', { mono: true }],
  python: ['Host', 'Python', { mono: true }], machine: ['Host', 'Architecture', { mono: true }], architecture: ['Host', 'Architecture', { mono: true }],
  kernel: ['Host', 'Kernel', { mono: true }], os: ['Host', 'Platform', { mono: true }], platform: ['Host', 'Platform', { mono: true }],
  hostname: null, host: null, user: null, uuid: null, gpu_uuid: null, serial: null, kernel_result: null, schema_version: null, output_json: null, output_csv: null,
  started_utc: ['Run', 'Started'], captured_utc: ['Run', 'Captured'], correctness_error: ['Run', 'Correctness error'], correctness_scope: ['Run', 'Correctness scope'],
  script_sha256: ['Source', 'Script SHA-256', { mono: true, truncate: true }], allocated_bytes: ['Run', 'Torch allocated'], reserved_bytes: ['Run', 'Torch reserved'],
  free_disk_bytes: ['Host', 'Free disk'], image_digest: ['Container', 'Digest', { mono: true, truncate: true }], image_tag: ['Container', 'Image', { mono: true }],
};

/**
 * @param {{rel:string, full:string}[]} files  candidate inventory files (any mix of layouts)
 * @param {{repoFileUrl?: (p:string)=>string}} opts  repoFileUrl(rel) → GitHub blob URL for a file
 */
export function parseEnv(files, { repoFileUrl } = {}) {
  const items = [];
  const seen = new Set();
  const add = (group, label, value, extra = {}) => {
    if (!value || seen.has(`${group}|${label}`)) return;
    seen.add(`${group}|${label}`);
    items.push({ group, label, value: String(value), ...extra });
  };
  const byName = (re) => files.filter((f) => re.test(path.basename(f.rel)));
  const text = (f) => (f ? readText(f.full) : null);
  const link = (f) => (repoFileUrl && f ? repoFileUrl(f.rel) : '');

  // --- JSON inventories (framework.json, environment.json, host.json, image-lock.json, source-git.json)
  for (const f of byName(/^(framework|environment|env|host|image-lock|image_lock|runtime|source-git)\.json$/i)) {
    const obj = readJSON(f.full);
    if (!obj || typeof obj !== 'object') continue;
    if (f.rel.endsWith('source-git.json') && obj.commit) {
      add('Source', 'Commit', String(obj.commit).slice(0, 12), { mono: true, href: repoFileUrl ? repoFileUrl(`commit:${obj.commit}`) : '' });
      if (obj.working_tree_status && String(obj.working_tree_status).trim()) add('Source', 'Working tree', 'had local changes at run time (recorded)');
      continue;
    }
    const isLock = /image[-_]lock/i.test(path.basename(f.rel));
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (JSON_KEYS[key] === null) continue; // identifiers stay off the page
      const map = isLock && key === 'architecture' ? ['Container', 'Architecture', { mono: true }] : JSON_KEYS[key];
      let val;
      if (Array.isArray(v) && key.includes('capab')) val = v.join('.');
      else if (Array.isArray(v)) val = v.length <= 12 && v.every((x) => x == null || typeof x !== 'object') ? v.join(', ') : `${v.length} entries`;
      else if (typeof v === 'object' && v) continue;
      else if (/bytes$/i.test(key)) val = formatBytes(Number(v));
      else if (key === 'correctness_error' && typeof v === 'number') val = `${(v * 100).toFixed(3)} % relative`;
      else if (key === 'python') val = grab(String(v), /^([\d.]+)/) || String(v);
      else if (key === 'cudnn') val = formatCudnn(v);
      else if (key === 'image_digest') val = String(v).replace(/^.*@/, '');
      else if (typeof v === 'string' && parseStamp(v)) val = parseStamp(v).iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
      else val = formatValue(k, v).text;
      if (map) add(map[0], map[1], val, map[2] || {});
      else if (typeof v !== 'object') add('Other', labelFor(k), val);
    }
  }

  // --- image locks (single-line digest files) and Week 01 image-lock.json
  for (const f of byName(/^image\.lock$|^image-lock\.txt$/i)) {
    const t = (text(f) || '').trim().split('\n')[0];
    if (/@sha256:/.test(t)) { add('Container', 'Image', t.replace(/@.*/, ''), { mono: true }); add('Container', 'Digest', t.replace(/^.*@/, ''), { mono: true, truncate: true }); }
    else if (t) add('Container', 'Image', t, { mono: true });
  }

  // --- nvidia-smi captures: table form (gpu.txt) or `nvidia-smi -q` log form (nvidia-smi*.txt)
  for (const f of byName(/^(gpu|nvidia-smi[^/]*)\.txt$/i)) {
    const t = text(f) || '';
    add('GPU', 'Device', grab(t, /Product Name\s*:\s*(.+)/) || grab(t, /\|\s+\d+\s+(NVIDIA [^|]+?)\s{2,}/));
    add('GPU', 'Architecture', grab(t, /Product Architecture\s*:\s*(.+)/));
    add('GPU', 'Driver', grab(t, /Driver Version\s*:\s*([\d.]+)/), { mono: true });
    add('GPU', 'CUDA (driver)', grab(t, /CUDA Version\s*:\s*([\d.]+)/), { mono: true });
    add('GPU', 'nvidia-smi', grab(t, /NVIDIA-SMI\s+([\d.]+)/), { mono: true });
  }

  // --- host inventories: os.txt, host.txt (uname + os-release + lscpu + free), cpu.txt, memory.txt, storage.txt, meminfo.txt
  const hostText = [...byName(/^(host|os|cpu|memory|meminfo|storage)\.txt$/i)].map((f) => text(f) || '').join('\n');
  if (hostText) {
    add('Host', 'OS', grab(hostText, /PRETTY_NAME="?([^"\n]+)"?/));
    add('Host', 'Kernel', grab(hostText, /^Linux\s+(\S+)\s+\S+\s+GNU\/Linux/m), { mono: true });
    const models = [...hostText.matchAll(/Model name:\s*(.+)/g)].map((m) => m[1].trim());
    const cores = [...hostText.matchAll(/Core\(s\) per socket:\s*(\d+)/g)].map((m) => Number(m[1]));
    const total = grab(hostText, /^CPU\(s\):\s*(\d+)/m);
    const desc = models.length ? models.map((m, i) => (cores[i] ? `${cores[i]}× ${m}` : m)).join(' + ') : '';
    add('Host', 'CPU', desc ? `${total ? total + ' cores: ' : ''}${desc}` : total ? `${total} cores` : '');
    add('Host', 'Architecture', grab(hostText, /^Architecture:\s*(\S+)/m), { mono: true });
    const mem = grab(hostText, /^Mem:\s+(\S+)/m);
    if (mem) add('Host', 'Memory', `${spaced(mem)}B total`);
    else { const kb = Number(grab(hostText, /MemTotal:\s*(\d+)/)); if (kb) add('Host', 'Memory', formatBytes(kb * 1024)); }
    const swap = grab(hostText, /^Swap:\s+(\S+)/m);
    if (swap && swap !== '0B') add('Host', 'Swap', `${spaced(swap)}B`);
    const st = /^(\/dev\/\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/m.exec(hostText);
    if (st) add('Host', 'Storage', `${spaced(st[3])}B ${st[2]}, ${spaced(st[5])}B free (${st[1]})`);
  }

  // --- container inventories: docker.txt, runtime.txt, container.txt (python version + pip freeze)
  const docker = text(byName(/^docker\.txt$/i)[0]);
  if (docker) add('Container', 'Docker Engine', grab(docker, /Server:[\s\S]*?Version:\s*([\d.]+)/) || grab(docker, /Version:\s*([\d.]+)/), { mono: true });
  const runtime = text(byName(/^runtime\.txt$/i)[0]);
  if (runtime) add('Container', 'NVIDIA Container Toolkit', grab(runtime, /cli-version:\s*([\d.]+)/), { mono: true });
  const cont = byName(/^container\.txt$/i)[0];
  if (cont) {
    const t = text(cont) || '';
    add('Container', 'Python (container)', grab(t, /^Python\s+([\d.]+)/m), { mono: true });
    add('Framework', 'PyTorch', grab(t, /^torch==(\S+)/m) || grab(t, /^torch\s*@?\s*(\S+)/m), { mono: true });
    const pkgs = t.split('\n').filter((l) => /^[A-Za-z0-9_.-]+\s*(==|@)/.test(l)).length;
    if (pkgs) add('Container', 'Python packages', `${pkgs} recorded`, { href: link(cont), hrefLabel: `${pkgs} packages (container.txt)` });
  }
  const pk = byName(/^host-packages\.(txt|tsv)$/i)[0];
  if (pk) add('Host', 'Package inventory', 'captured', { href: link(pk), hrefLabel: path.basename(pk.rel) });
  const src = byName(/^(source\.sha256|SOURCE_SHA256SUMS\.txt|SHA256SUMS)$/i)[0];
  if (src) add('Source', 'Checksums', 'recorded', { href: link(src), hrefLabel: path.basename(src.rel) });

  return { items, files: files.map((f) => f.rel) };
}

function formatCudnn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 10000) return `${Math.floor(n / 10000)}.${Math.floor((n % 10000) / 100)}.${n % 100}`;
  return String(v);
}
