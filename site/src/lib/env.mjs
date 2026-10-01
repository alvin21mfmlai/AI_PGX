// Turn whatever environment inventory a week recorded into a provenance panel.
// Sources are matched by file name, so the Week 01 layout (results/<s>/env/*.txt +
// framework.json), the Week 02 layout (results/<s>/environment.json +
// manifests/<stamp>/{host,container,nvidia-smi*}.txt + image.lock) and the Week 03
// layout (flat manifests/: host-<stamp>.txt, gpu-gate.txt, nvcc-version.txt,
// llama-*-version.txt, model-files.json, binary-*-sha256.txt; locks.json pins) all
// work, and unknown layouts degrade to a link list. Machine identifiers (GPU UUIDs,
// serial numbers, hostnames, account names in paths) are deliberately never copied
// onto the page.
import path from 'node:path';
import { formatBytes, readJSON, readText, parseStamp, redactPaths } from './util.mjs';
import { formatValue } from './jsondata.mjs';
import { labelFor } from './csv.mjs';

function grab(text, re) { const m = re.exec(text || ''); return m ? m[1].trim() : ''; }
const spaced = (v) => String(v).replace(/^([\d.]+)([A-Za-z]+)$/, '$1 $2');
const short = (sha, n = 12) => String(sha).trim().slice(0, n);

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

// locks.json — pinned upstream source and model (Week 03 style).
const LOCK_KEYS = {
  llama_tag: ['Source', 'llama.cpp release', { mono: true }], llama_commit: ['Source', 'llama.cpp commit', { mono: true, truncate: true }],
  llama_version: ['Framework', 'llama.cpp', { mono: true }], cuda_architecture: ['Framework', 'CUDA architecture', { mono: true }],
  model_repo: ['Model', 'Checkpoint'], model_revision: ['Model', 'Revision', { mono: true, truncate: true }], model_file: ['Model', 'File', { mono: true }],
  model_sha256: ['Model', 'SHA-256', { mono: true, truncate: true }], model: ['Model', 'Checkpoint'], quantization: ['Model', 'Quantisation', { mono: true }],
  verified_on: ['Source', 'Pins verified'], note: null, notes: null,
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
    items.push({ group, label, value: redactPaths(String(value)), ...extra });
  };
  const byName = (re) => files.filter((f) => re.test(path.basename(f.rel)));
  const text = (f) => (f ? readText(f.full) : null);
  const link = (f) => (repoFileUrl && f ? repoFileUrl(f.rel) : '');

  // --- JSON inventories (framework.json, environment.json, host.json, image-lock.json, source-git.json)
  for (const f of byName(/^(framework|environment|env|host|image-lock|image_lock|runtime|source-git)\.json$/i)) {
    const obj = readJSON(f.full);
    if (!obj || typeof obj !== 'object') continue;
    if (f.rel.endsWith('source-git.json') && obj.commit) {
      add('Source', 'Commit', short(obj.commit), { mono: true, href: repoFileUrl ? repoFileUrl(`commit:${obj.commit}`) : '' });
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

  // --- locks.json: pinned source tag/commit, model repository/revision/checksum, CUDA architecture
  for (const f of byName(/^(locks?|pins?|lockfile)\.json$/i)) {
    const obj = readJSON(f.full);
    if (!obj || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (LOCK_KEYS[key] === null || v == null || typeof v === 'object') continue;
      const map = LOCK_KEYS[key];
      if (!map) { add('Source', labelFor(k), formatValue(k, v).text); continue; }
      const extra = { ...(map[2] || {}) };
      if (key === 'model_repo' && /^[\w.-]+\/[\w.-]+$/.test(String(v))) { extra.href = `https://huggingface.co/${v}`; extra.hrefLabel = String(v); }
      add(map[0], map[1], String(v), extra);
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

  // --- gpu-gate.txt: "GPU=NVIDIA GB10 capability=12.1" + the outcome of the CUDA smoke test
  const gate = text(byName(/^gpu[-_]gate(-result)?\.txt$/i)[0]);
  if (gate) {
    add('GPU', 'Device', grab(gate, /GPU\s*=\s*([^\n]+?)(?:\s+capability=|$)/m));
    add('GPU', 'Compute capability', grab(gate, /capability\s*=\s*([\d.]+)/i), { mono: true });
    const verdict = grab(gate, /^(.*\b(PASS|FAIL|OK|SKIP)\b.*)$/m);
    if (verdict) add('GPU', 'CUDA gate', verdict.replace(/;.*$/, '').trim());
  }

  // --- toolchain: nvcc-version.txt, llama-*-version.txt, *-version.txt
  const nvcc = text(byName(/^nvcc[-_]version\.txt$/i)[0]);
  if (nvcc) add('Framework', 'CUDA toolkit (nvcc)', grab(nvcc, /release\s+[\d.]+,\s*V([\d.]+)/) || grab(nvcc, /release\s+([\d.]+)/), { mono: true });
  for (const f of byName(/^(llama[^/]*|[^/]*llama[^/]*)[-_]version\.txt$/i)) {
    const t = text(f) || '';
    const ver = grab(t, /version:\s*([^\n]+)/i);
    if (ver) add('Framework', 'llama.cpp', ver.replace(/\s*\(build \d+,\s*/, ' (').replace(/\)\s*$/, ')'), { mono: true });
    const built = grab(t, /built with\s+([^\n]+)/i);
    if (built) add('Framework', 'Compiler', built.replace(/\s+for\s+/, ' · '), { mono: true });
  }
  const lc = text(byName(/^(llama|source|upstream)[-_]commit\.txt$/i)[0]);
  if (lc && /^[0-9a-f]{7,64}$/i.test(lc.trim())) add('Source', 'llama.cpp commit', lc.trim(), { mono: true, truncate: true });

  // --- host inventories: os.txt, host.txt / host-<stamp>.txt (uname + os-release + lscpu + free), cpu.txt, memory.txt, storage.txt, meminfo.txt
  const hostFiles = byName(/^(host(-[\dT]+Z?)?|os|cpu|memory|meminfo|storage)\.txt$/i).sort((a, b) => b.rel.localeCompare(a.rel)).slice(0, 4);
  const hostText = hostFiles.map((f) => text(f) || '').join('\n');
  if (hostText) {
    add('Host', 'OS', grab(hostText, /PRETTY_NAME="?([^"\n]+)"?/));
    // "Linux 6.17.0-1032-nvidia aarch64 [GNU/Linux]" (uname -srm[o]); with `uname -a` the kernel is the token after the hostname.
    add('Host', 'Kernel', grab(hostText, /^Linux\s+(?:\S+\s+)?(\d[\w.+-]*)/m), { mono: true });
    const models = [...hostText.matchAll(/Model name:\s*(.+)/g)].map((m) => m[1].trim());
    const cores = [...hostText.matchAll(/Core\(s\) per socket:\s*(\d+)/g)].map((m) => Number(m[1]));
    const total = grab(hostText, /^CPU\(s\):\s*(\d+)/m);
    const desc = models.length ? [...new Set(models.map((m, i) => (cores[i] ? `${cores[i]}× ${m}` : m)))].join(' + ') : '';
    add('Host', 'CPU', desc ? `${total ? total + ' cores: ' : ''}${desc}` : total ? `${total} cores` : '');
    add('Host', 'Architecture', grab(hostText, /^Architecture:\s*(\S+)/m), { mono: true });
    const mem = grab(hostText, /^Mem:\s+(\S+)/m);
    if (mem) add('Host', 'Memory', `${spaced(mem)}B total`);
    else { const kb = Number(grab(hostText, /MemTotal:\s*(\d+)/)); if (kb) add('Host', 'Memory', formatBytes(kb * 1024)); }
    const swap = grab(hostText, /^Swap:\s+(\S+)/m);
    if (swap && swap !== '0B') add('Host', 'Swap', `${spaced(swap)}B`);
    // df -h ("/dev/nvme0n1p2  3.7T  78G  3.5T  3% /") or df -hT (with a filesystem-type column)
    const st = /^(\/dev\/\S+)\s+(?:([a-z0-9]+)\s+)?(\d+(?:\.\d+)?[KMGTP]i?B?)\s+(\d+(?:\.\d+)?[KMGTP]?i?B?)\s+(\d+(?:\.\d+)?[KMGTP]i?B?)\s+(\d+%)\s+(\S+)\s*$/m.exec(hostText);
    if (st) add('Host', 'Storage', `${spaced(st[3])}B${st[2] ? ` ${st[2]}` : ''}, ${spaced(st[5])}B free (${st[1]})`);
    const nv = grab(hostText, /Driver Version\s*:\s*([\d.]+)/) || grab(hostText, /NVIDIA-SMI\s+[\d.]+\s+Driver Version:\s*([\d.]+)/);
    if (nv) add('GPU', 'Driver', nv, { mono: true });
    const cudaDrv = grab(hostText, /CUDA Version\s*:\s*([\d.]+)/);
    if (cudaDrv) add('GPU', 'CUDA (driver)', cudaDrv, { mono: true });
    const py = grab(hostText, /^Python\s+([\d.]+)/m);
    if (py) add('Host', 'Python', py, { mono: true });
    const cmake = grab(hostText, /cmake version\s+([\d.]+)/i);
    if (cmake) add('Host', 'CMake', cmake, { mono: true });
    const gcc = grab(hostText, /^(?:gcc|cc|g\+\+|c\+\+)\s+\([^)]*\)\s+([\d.]+)/m);
    if (gcc) add('Host', 'GCC', gcc, { mono: true });
    add('GPU', 'Device', grab(hostText, /\|\s+\d+\s+(NVIDIA [^|]+?)\s{2,}/));
    const dpkg = hostText.split('\n').filter((l) => /^\S+\t\S+\t(arm64|amd64|all|aarch64)\s*$/.test(l)).length;
    if (dpkg >= 20 && hostFiles[0]) add('Host', 'Package inventory', `${dpkg} packages recorded`, { href: link(hostFiles[0]), hrefLabel: `${dpkg} packages (${path.basename(hostFiles[0].rel)})` });
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
    const torch = grab(t, /^torch==(\S+)/m) || grab(t, /^torch\s*@\s*\S*torch-([\w.%+-]+?)-cp\d/m) || grab(t, /^torch\s*@?\s*(\S+)/m);
    add('Framework', 'PyTorch', decodeURIComponent(torch), { mono: true });
    const pkgs = t.split('\n').filter((l) => /^[A-Za-z0-9_.-]+\s*(==|@)/.test(l)).length;
    if (pkgs) add('Container', 'Python packages', `${pkgs} recorded`, { href: link(cont), hrefLabel: `${pkgs} packages (container.txt)` });
  }
  const pk = byName(/^host-packages\.(txt|tsv)$/i)[0];
  if (pk) add('Host', 'Package inventory', 'captured', { href: link(pk), hrefLabel: path.basename(pk.rel) });

  // --- checksums and inventories: sources, built binaries, model files
  const src = byName(/^(source\.sha256|SOURCE_SHA256SUMS\.txt|SHA256SUMS(\.json)?)$/i)[0];
  if (src) add('Source', 'Checksums', 'recorded', { href: link(src), hrefLabel: path.basename(src.rel) });
  const sh = byName(/^source-hashes\.json$/i)[0];
  if (sh) { const obj = readJSON(sh.full); const n = obj && typeof obj === 'object' ? Object.keys(obj).length : 0; add('Source', 'Script hashes at run time', n ? `${n} files` : 'recorded', { href: link(sh), hrefLabel: `${n ? n + ' files' : 'recorded'} (source-hashes.json)` }); }
  const bins = byName(/^binary-[^/]*sha256[^/]*\.txt$|^binaries?\.sha256$/i);
  if (bins.length) {
    const n = bins.reduce((acc, f) => acc + (text(f) || '').split('\n').filter((l) => /^[0-9a-f]{64}\s+\S/i.test(l.trim())).length, 0);
    add('Source', 'Built binaries', `${n || bins.length} checksummed`, { href: link(bins[0]), hrefLabel: bins.map((f) => path.basename(f.rel)).join(', ') });
  }
  const mf = byName(/^model[-_]files\.json$/i)[0];
  if (mf) {
    const obj = readJSON(mf.full);
    const n = obj && typeof obj === 'object' ? Object.keys(obj).length : 0;
    if (n) add('Model', 'Files', `${n} file${n === 1 ? '' : 's'}, SHA-256 recorded`, { href: link(mf), hrefLabel: `${n} file${n === 1 ? '' : 's'}, SHA-256 recorded (${path.basename(mf.rel)})` });
  }

  return { items: sortItems(items), files: files.map((f) => f.rel) };
}

const GROUP_ORDER = ['GPU', 'Framework', 'Model', 'Container', 'Host', 'Source', 'Run', 'Other'];
function sortItems(items) {
  return items.map((it, i) => ({ it, i })).sort((a, b) => (GROUP_ORDER.indexOf(a.it.group) - GROUP_ORDER.indexOf(b.it.group)) || a.i - b.i).map(({ it }) => it);
}

function formatCudnn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 10000) return `${Math.floor(n / 10000)}.${Math.floor((n % 10000) / 100)}.${n % 100}`;
  return String(v);
}
