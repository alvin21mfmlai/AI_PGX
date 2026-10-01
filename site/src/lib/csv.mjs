// Tabular data (CSV / TSV / JSON Lines / JSON arrays) parsing and chart inference.
// Given the data files of a results session, work out which ones can be drawn and
// produce chart specs that the browser renders (assets/charts.js). Everything here
// is heuristic and defensive: a file that fits no rule simply gets a table view.
import path from 'node:path';
import { titleCase, median } from './util.mjs';

export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let row = []; let field = ''; let inQ = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).map((r) => header.map((_, i) => (r[i] ?? '').trim())) };
}

const isScalar = (v) => v == null || ['number', 'string', 'boolean'].includes(typeof v);

// Flatten nested objects into dotted keys ("response.timings.predicted_per_second"). Arrays of scalars are kept
// (as arrays) so callers can expand them; arrays of objects and anything deeper than `depth` are skipped.
export function flattenObject(obj, { depth = 4, prefix = '' } = {}) {
  const out = {};
  const walk = (o, pre, d) => {
    for (const [k, v] of Object.entries(o)) {
      const key = pre ? `${pre}.${k}` : k;
      if (isScalar(v)) out[key] = v;
      else if (Array.isArray(v)) { if (v.every(isScalar)) out[key] = v; }
      else if (typeof v === 'object' && d < depth) walk(v, key, d + 1);
    }
  };
  walk(obj, prefix, 1);
  return out;
}

// A list of objects → header (first-seen scalar keys, nested keys flattened) + string rows.
export function tableFromObjects(objs, { depth = 4 } = {}) {
  const header = [];
  const flat = objs.map((o) => flattenObject(o, { depth }));
  for (const f of flat) for (const k of Object.keys(f)) if (!Array.isArray(f[k]) && !header.includes(k)) header.push(k);
  const rows = flat.map((f) => header.map((k) => { const v = f[k]; return v == null || typeof v === 'object' ? '' : String(v); }));
  return { header, rows, flat };
}

// JSON Lines: one object per line.
export function parseJSONL(text) {
  const objs = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (o && typeof o === 'object' && !Array.isArray(o)) objs.push(o);
  }
  const { header, rows } = tableFromObjects(objs, { depth: 2 });
  return { header, rows };
}

// A JSON file holding an array of objects (llama-bench output, a case list…) is a table too.
export function parseJSONArray(text) {
  let v; try { v = JSON.parse(String(text || '')); } catch { return { header: [], rows: [], objects: [] }; }
  if (!Array.isArray(v) || !v.length || !v.every((o) => o && typeof o === 'object' && !Array.isArray(o))) return { header: [], rows: [], objects: [] };
  const { header, rows, flat } = tableFromObjects(v);
  return { header, rows, objects: v, flat };
}

export function parseTable(text, fileName) {
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (ext === 'jsonl' || ext === 'ndjson') return parseJSONL(text);
  if (ext === 'json') { const { header, rows } = parseJSONArray(text); return { header, rows }; }
  if (ext === 'tsv') return parseCSV(text, '\t');
  return parseCSV(text);
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const BOOL = new Set(['true', 'false', 'yes', 'no', 'pass', 'fail', 'passed', 'failed']);
const PACKED_RE = /^\s*[-+]?\d+(\.\d+)?(\s*,\s*[-+]?\d+(\.\d+)?)+\s*$/;

export function analyzeColumns(header, rows) {
  return header.map((name, i) => {
    const raw = rows.map((r) => r[i] ?? '');
    const nonEmpty = raw.filter((v) => v !== '');
    const nums = nonEmpty.filter((v) => NUM_RE.test(v));
    const bools = nonEmpty.filter((v) => BOOL.has(v.toLowerCase()));
    const times = nonEmpty.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)));
    let type = 'string';
    if (nonEmpty.length && nums.length / nonEmpty.length >= 0.9) type = nums.every((v) => /^[-+]?\d+$/.test(v)) ? 'int' : 'number';
    else if (nonEmpty.length && bools.length === nonEmpty.length) type = 'bool';
    else if (nonEmpty.length && times.length === nonEmpty.length) type = 'time';
    const unique = new Set(nonEmpty).size;
    let values;
    if (type === 'int' || type === 'number') values = raw.map((v) => (v === '' || !NUM_RE.test(v) ? null : Number(v)));
    else if (type === 'time') values = raw.map((v) => (v === '' ? null : Date.parse(v)));
    else values = raw;
    const monotonic = (type === 'int' || type === 'number' || type === 'time') && values.length > 1
      && values.every((v, k) => k === 0 || v == null || values[k - 1] == null || v > values[k - 1]);
    return { name, index: i, type, values, unique, constant: unique <= 1, monotonic, empty: nonEmpty.length === 0 };
  });
}

// "41, 0, 3.66" packed into one string column (an nvidia-smi --query-gpu line, say) becomes one numeric column per
// value. Names come from the week's `columns` override when given, otherwise <column>_1, <column>_2, …
export function expandPackedColumns(header, rows, names = {}) {
  let h = header.slice(); let r = rows.map((row) => row.slice());
  for (let i = h.length - 1; i >= 0; i--) {
    const vals = r.map((row) => row[i] ?? '').filter((v) => v !== '');
    if (!vals.length || !vals.every((v) => PACKED_RE.test(v))) continue;
    const counts = new Set(vals.map((v) => v.split(',').length));
    if (counts.size !== 1) continue;
    const k = [...counts][0];
    if (k < 2 || k > 16) continue;
    const given = Array.isArray(names[h[i]]) ? names[h[i]] : [];
    const newNames = Array.from({ length: k }, (_, j) => given[j] || `${h[i]}_${j + 1}`);
    h = [...h.slice(0, i), ...newNames, ...h.slice(i + 1)];
    r = r.map((row) => { const parts = (row[i] ?? '') === '' ? Array(k).fill('') : row[i].split(',').map((p) => p.trim()); return [...row.slice(0, i), ...parts, ...row.slice(i + 1)]; });
  }
  return { header: h, rows: r };
}

// Candidate X columns, in order of preference.
const X_NAMES = ['trial', 'step', 'epoch', 'iteration', 'iter', 'block', 'case', 'case_id', 'sample', 'rep', 'repetition', 'index', 'idx', 'i', 'n',
  'elapsed', 'elapsed_s', 'elapsed_seconds', 't', 't_s', 'time', 'time_s', 'timestamp', 'timestamp_s', 'timestamp_utc', 'utc', 'mono', 'mono_start',
  'epoch_s', 'unix', 'unix_s', 'unix_time', 'wall', 'wall_start', 'date', 'datetime', 'x', 'batch', 'tick', 'seq', 'sample_index', 'token', 'tokens',
  'position', 'layer', 'size', 'n_tokens', 'context', 'context_length', 'batch_size', 'threads'];
const EXCLUDE_Y_RE = /(^|[._])(seed|ids?|run|run_id|pid|port|sample|image_digest|digest|hash|sha256|pair|blocks|created|exit|exit_code|status_code|build_number|n_threads|main_gpu)$/i;
const TIMELIKE_RE = /(^|[._])((start|end|begin|stop)(?!_to_)|utc|mono|epoch|unix|timestamp|time|date|wall_start|wall_end|created|test_time)([._]|$)|^ts$/i;
const ABSOLUTE_CLOCK_RE = /(utc|mono|epoch|unix|timestamp|wall|^time$|^t$)/i;
const PRIORITY = ['tflops', 'gflops', 'throughput', 'tokens', 'samples_ts', '_ts', 'latency', 'wall', 'predicted_per_second', 'generation_per_second', 'per_second', 'tok', 'ops_per', 'ops', 'power', 'energy', 'joules',
  'overhead', 'accuracy', 'loss', 'util', 'temp', 'sm_mhz', 'clock', 'mhz', 'f1', 'auc', 'seconds', 'ms', 'cv', 'coverage', 'memavailable', 'mem', 'query'];
// Token *counts* (prompt_tokens, completion_tokens…) are bookkeeping, not throughput.
const COUNT_RE = /(^|[._])(prompt|completion|total|input|output|cached|generated|predicted|n)_?(tokens?|n)$/i;
const STAT_WORD_RE = /^(median|mean|avg|average|min|max|minimum|maximum|stddev|std|p\d+)$/i;
const UNIT_NOUN = { 'tokens/s': 'throughput', 'TFLOP/s': 'throughput', 'GFLOP/s': 'throughput', 'ops/s': 'rate', W: 'power', J: 'energy', s: 'time', ms: 'time', 'µs': 'time', ns: 'time', '°C': 'temperature', '%': 'share' };

const UNITS = [
  [/(^|_)(tflops?|tflop_s|tflop\/s)$/i, 'TFLOP/s'], [/(^|_)(gflops?)$/i, 'GFLOP/s'], [/(^|_)(tokens?_(per_)?s(ec|econd)?|tok_s|tps|tokens_s)$/i, 'tokens/s'],
  [/(^|_)(avg|stddev|std|samples?|median|mean|min|max|p\d+)_ts$/i, 'tokens/s'], [/(^|_)(predicted|prompt|generation|gen|decode|prefill|eval)_per_(s|sec|second)$/i, 'tokens/s'],
  [/(^|_)ops_per_(s|sec|second)$/i, 'ops/s'], [/(^|_)joules?_per_(\w+)$/i, (m) => `J/${m[2]}`], [/(^|_)(\w+)_per_(s|sec|second)$/i, (m) => `${m[2]}/s`],
  [/(^|_)(j|joules?|energy_j)$/i, 'J'], [/(^|_)(wh)$/i, 'Wh'], [/(^|_)(kwh)$/i, 'kWh'],
  [/(^|_)(ms|millis|milliseconds)$/i, 'ms'], [/(^|_)(us|micros|microseconds)$/i, 'µs'], [/(^|_)(ns|nanos|nanoseconds)$/i, 'ns'], [/(^|_)(s|sec|secs|seconds|elapsed)$/i, 's'],
  [/(^|_)(pct|percent|percentage)$/i, '%'], [/(^|_)(w|watts?)$/i, 'W'], [/(^|_)(c|celsius|temp_c)$/i, '°C'],
  [/(^|_)(kb)$/i, 'KB'], [/(^|_)(mb)$/i, 'MB'], [/(^|_)(gb)$/i, 'GB'], [/(^|_)(gib)$/i, 'GiB'], [/(^|_)(mib)$/i, 'MiB'], [/(^|_)(kib)$/i, 'KiB'],
  [/(^|_)(bytes?)$/i, 'bytes'], [/(^|_)(mhz)$/i, 'MHz'], [/(^|_)(ghz)$/i, 'GHz'], [/(^|_)(gbps)$/i, 'Gb/s'], [/(^|_)(mbps)$/i, 'Mb/s'],
  [/(^|_)(speedup|speed_up|ratio_x|factor)$/i, '×'],
];

export function unitFor(name) {
  const n = String(name).split('.').pop();
  for (const [re, u] of UNITS) { const m = re.exec(n); if (m) return typeof u === 'function' ? u(m) : u; }
  if (/coefficient_of_variation|(^|_)cv$|(^|_)(coverage|fraction|ratio)$/i.test(n)) return 'ratio';
  return '';
}

// Dotted keys from nested JSON: the nearest ancestor that names a unit lends it to the leaf ("end_to_end_seconds.median" → s).
export function unitForPath(key) {
  const parts = String(key).split('.');
  if (parts.length > 1 && /^(n|count|total|correct|samples|trials|cases|runs|\w+_n)$/i.test(parts[parts.length - 1])) return unitFor(parts[parts.length - 1]);
  for (let i = parts.length - 1; i >= 0; i--) { const u = unitFor(parts[i]); if (u) return u; }
  return '';
}

const WORDS = { wall: 'Wall time', s: 'Seconds', seconds: 'Seconds', ms: 'Milliseconds', median_block: 'Median block throughput', warmup: 'Warm-up', lr: 'Learning rate', acc: 'Accuracy', ppl: 'Perplexity', tps: 'Tokens/s', ttft: 'Time to first token', tpot: 'Time per output token', util: 'Utilisation', mem: 'Memory', temp: 'Temperature', cv: 'Variability (CV)', block_cv: 'Block variability (CV)', rel_l2: 'Relative L2 error', p50: 'p50', p90: 'p90', p95: 'p95', p99: 'p99', sm: 'SM clock', memavailable: 'Memory available', memtotal: 'Memory total', swapfree: 'Swap free', swaptotal: 'Swap total', query: 'Query time', ops: 'Operations', operations: 'Operations', joules: 'Energy', energy: 'Energy',
  // llama.cpp vocabulary (llama-bench rows, server timings)
  pp: 'Prompt processing', tg: 'Token generation', samples_ts: 'Throughput', samples_ns: 'Test duration', avg_ts: 'Average throughput', stddev_ts: 'Throughput std. deviation', avg_ns: 'Average duration', stddev_ns: 'Duration std. deviation',
  n: 'Samples', predicted_per_second: 'Generation throughput', prompt_per_second: 'Prompt processing throughput', predicted_per_token_ms: 'Time per generated token', prompt_per_token_ms: 'Prompt time per token',
  predicted_ms: 'Generation time', prompt_ms: 'Prompt processing time', predicted_n: 'Generated tokens', prompt_n: 'Prompt tokens', cache_n: 'Cached tokens', e2e: 'End-to-end', end_to_end: 'End-to-end', end_to_end_seconds: 'End-to-end time',
  wall_seconds: 'Wall time', gpu_util: 'GPU utilisation', gpu_util_pct: 'GPU utilisation', gpu_temp: 'GPU temperature', gpu_temp_c: 'GPU temperature', gpu_power: 'GPU power', gpu_power_w: 'GPU power', gpu_mem: 'GPU memory', mem_available: 'Memory available', mem_available_kib: 'Memory available', mem_used: 'Memory used' };

export function labelFor(name) {
  const full = String(name);
  if (full.includes('.')) {
    const parts = full.split('.');
    const leaf = parts[parts.length - 1];
    if (WORDS[leaf.toLowerCase()] && !STAT_WORD_RE.test(leaf) && !/^(n|total|count)$/i.test(leaf)) return WORDS[leaf.toLowerCase()];
    return parts.map((p) => labelFor(p)).join(' › ');
  }
  const known = WORDS[full.toLowerCase()];
  if (known) return known;
  let n = full;
  const unitOnly = unitFor(n);
  // "quality_target_ge_11_of_12" / "stability_cv_le_10_pct" keep their threshold (and its unit) readable.
  const cmp = /(^|_)(ge|le|gt|lt|eq|gte|lte)_\d/i.test(n);
  if (cmp) {
    n = n.replace(/(^|_)(ge|gte)_/gi, '$1≥ ').replace(/(^|_)(le|lte)_/gi, '$1≤ ').replace(/(^|_)gt_/gi, '$1> ').replace(/(^|_)lt_/gi, '$1< ').replace(/(^|_)eq_/gi, '$1= ')
      .replace(/(\d)_(\d)/g, '$1.$2').replace(/_pct$/i, ' %').replace(/_(ms|s|w|c)$/i, ' $1');
  } else {
    n = n.replace(/(^|_)(tflops?|gflops?|tokens?_(per_)?s(ec|econd)?|tok_s|tps|per_(s|sec|second)|per_\w+|ms|us|ns|secs?|seconds|elapsed|pct|percent|percentage|w|watts?|c|celsius|j|joules?|wh|kwh|kb|mb|gb|gib|mib|kib|bytes?|mhz|ghz|gbps|mbps)$/i, '');
    // "median_tokens_s" → "Median throughput" rather than a bare "Median".
    if (STAT_WORD_RE.test(n) && UNIT_NOUN[unitOnly]) return `${titleCase(n)} ${UNIT_NOUN[unitOnly]}`;
    if (WORDS[n.toLowerCase()] && n.toLowerCase() !== full.toLowerCase()) return WORDS[n.toLowerCase()];
  }
  n = n.replace(/^gpu_cpu_/, 'GPU vs CPU ').replace(/^gpu_/, 'GPU ').replace(/^cpu_/, 'CPU ').replace(/^mem_/, 'memory ').replace(/_utc$/, '').replace(/_id$/, '');
  n = n.replace(/coefficient_of_variation/, 'variability (CV)');
  n = n.trim().replace(/^_+|_+$/g, '');
  if (!n) return unitOnly && /[/%]/.test(unitOnly) ? unitOnly : titleCase(full);
  if (WORDS[n.toLowerCase()]) return WORDS[n.toLowerCase()];
  const t = titleCase(n);
  return t.replace(/\bTflops\b/i, 'TFLOP/s').replace(/\bCv\b/, 'CV').replace(/\bGpu\b/, 'GPU').replace(/\bCpu\b/, 'CPU').replace(/\bKb\b/, 'KB').replace(/\bSm\b/, 'SM').replace(/\bP(\d\d)\b/g, 'p$1')
    .replace(/\bTg\b/, 'token generation').replace(/\bPp\b/, 'prompt processing').replace(/\bJson\b/, 'JSON').replace(/\bCsv\b/, 'CSV').replace(/\bE2e\b/i, 'end-to-end')
    .replace(/\b(Of|Per|By|And|Or|To|In|At|The|For|Vs)\b/g, (m) => m.toLowerCase());
}

// "Variability (CV)" + "%" → "Variability (CV, %)"; "Median throughput" + "tokens/s" → "Median throughput (tokens/s)".
export function withUnit(label, unit) {
  if (!unit || label.toLowerCase() === unit.toLowerCase() || label.toLowerCase().endsWith(`(${unit.toLowerCase()})`)) return label;
  return /\)$/.test(label) ? `${label.slice(0, -1)}, ${unit})` : `${label} (${unit})`;
}

// Large raw units are easier to read rescaled: KB → GB, bytes → MB/GB, ratio → %.
export function normalizeUnit(unit, values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return { unit, factor: 1 };
  const max = Math.max(...v.map(Math.abs));
  if (unit === 'KB' && max >= 1e6) return { unit: 'GB', factor: 1 / 1048576 };
  if (unit === 'KB' && max >= 1e3) return { unit: 'MB', factor: 1 / 1024 };
  if (unit === 'KiB' && max >= 1e6) return { unit: 'GiB', factor: 1 / 1048576 };
  if (unit === 'KiB' && max >= 1e3) return { unit: 'MiB', factor: 1 / 1024 };
  if (unit === 'MB' && max >= 1e4) return { unit: 'GB', factor: 1 / 1024 };
  if (unit === 'MiB' && max >= 1e4) return { unit: 'GiB', factor: 1 / 1024 };
  if (unit === 'bytes' && max >= 1e9) return { unit: 'GB', factor: 1 / 1073741824 };
  if (unit === 'bytes' && max >= 1e6) return { unit: 'MB', factor: 1 / 1048576 };
  if (unit === 'ratio' && max <= 2) return { unit: '%', factor: 100 };
  if (unit === 'µs' && max >= 1e4) return { unit: 'ms', factor: 1 / 1000 };
  if (unit === 'ns' && max >= 1e9) return { unit: 's', factor: 1 / 1e9 };
  if (unit === 'ns' && max >= 1e5) return { unit: 'ms', factor: 1 / 1e6 };
  if (unit === 'ms' && max >= 1e5) return { unit: 's', factor: 1 / 1000 };
  return { unit, factor: 1 };
}
const scale = (arr, f) => (f === 1 ? arr : arr.map((x) => (x == null ? null : x * f)));

function commonPrefix(strings) {
  if (!strings.length) return '';
  let p = strings[0];
  for (const s of strings) { while (!s.startsWith(p)) p = p.slice(0, -1); if (!p) break; }
  return p;
}
function commonSuffix(strings) {
  if (!strings.length) return '';
  let p = strings[0];
  for (const s of strings) { while (!s.endsWith(p)) p = p.slice(1); if (!p) break; }
  return p;
}
const baseName = (rel) => path.basename(rel).replace(/#.*$/, '').replace(/\.(csv|tsv|jsonl|ndjson|json)$/i, '');

// Files in one directory that share a column set form a family: one chart, one series per file.
function familyLabels(files) {
  const names = files.map((f) => baseName(f.rel));
  if (names.length === 1) return { key: names[0], labels: [names[0]] };
  // Only strip whole tokens: cut the shared prefix back to its last separator and the shared suffix forward to its first one.
  let pre = commonPrefix(names); const lastSep = Math.max(pre.lastIndexOf('-'), pre.lastIndexOf('_'), pre.lastIndexOf(' ')); pre = lastSep >= 0 ? pre.slice(0, lastSep + 1) : '';
  let suf = commonSuffix(names); const firstSep = [...suf].findIndex((ch) => '-_ '.includes(ch)); suf = firstSep >= 0 ? suf.slice(firstSep) : '';
  const labels = names.map((n) => {
    let mid = n.slice(pre.length, suf ? n.length - suf.length : undefined);
    if (!mid) mid = n;
    const m = /run[-_ ]?(\d+)/i.exec(mid);
    return m ? `Run ${Number(m[1])}` : mid.replace(/^[-_ ]+|[-_ ]+$/g, '');
  });
  const key = (pre + suf).replace(/[-_ ]NN$/, '').replace(/[-_ ]+$/g, '').replace(/^[-_ ]+/g, '') || names[0];
  return { key, labels };
}

const MAX_POINTS = 1500;
function thin(values) {
  if (values.length <= MAX_POINTS) return values;
  const stride = Math.ceil(values.length / MAX_POINTS);
  return values.filter((_, i) => i % stride === 0);
}

function prio(name) {
  const n = name.toLowerCase();
  if (COUNT_RE.test(n)) return 60;
  const i = PRIORITY.findIndex((p) => n.includes(p));
  return i === -1 ? 99 : i;
}

// A row of llama-bench output is a "pp512" / "tg128" test; other row-like objects use a name-ish field or their index.
function rowLabel(obj, i) {
  if (obj && typeof obj === 'object') {
    if (Number(obj.n_prompt) > 0 && !(Number(obj.n_gen) > 0)) return `pp${obj.n_prompt}`;
    if (Number(obj.n_gen) > 0 && !(Number(obj.n_prompt) > 0)) return `tg${obj.n_gen}`;
    if (Number(obj.n_prompt) > 0 && Number(obj.n_gen) > 0) return `pp${obj.n_prompt}+tg${obj.n_gen}`;
    for (const k of ['name', 'test', 'label', 'case', 'mode', 'id', 'run']) if (isScalar(obj[k]) && obj[k] !== '' && obj[k] != null) return String(obj[k]);
  }
  return `row ${i + 1}`;
}

// Numeric sample arrays inside JSON rows ("samples_ts": [7601.15, …]) become a long-format table: one row per
// sample, with the parent row's label as a series column.
function samplesTable(rel, objects, flat) {
  const arrKeys = [];
  for (const f of flat) for (const [k, v] of Object.entries(f)) if (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number') && !arrKeys.includes(k)) arrKeys.push(k);
  if (!arrKeys.length) return null;
  const header = ['test', 'trial', ...arrKeys];
  const rows = [];
  objects.forEach((o, i) => {
    const f = flat[i]; const label = rowLabel(o, i);
    const n = Math.max(...arrKeys.map((k) => (Array.isArray(f[k]) ? f[k].length : 0)));
    for (let s = 0; s < n; s++) rows.push([label, String(s + 1), ...arrKeys.map((k) => (Array.isArray(f[k]) && f[k][s] != null ? String(f[k][s]) : ''))]);
  });
  return { rel: `${rel}#samples`, header, rows, derived: 'samples' };
}

/**
 * @param {{rel:string, text:string, objects?:object[], header?:string[], rows?:string[][]}[]} dataFiles  data files of one results session (rel = path inside the session)
 * @param {{maxCharts?: number, maxPerFamily?: number, columns?: object}} [opts]  columns: { [file]: { [packedColumn]: [names…] } }
 * @returns {{charts: object[], tables: object[], skipped: number}}
 */
export function inferCharts(dataFiles, opts = {}) {
  const maxCharts = opts.maxCharts ?? 10;
  const maxPerFamily = opts.maxPerFamily ?? 4;
  const columnNames = opts.columns || {};
  const namesFor = (rel) => columnNames[rel] || columnNames[path.basename(rel)] || {};

  const parsed = [];
  for (const f of dataFiles) {
    let header; let rows; let derived = f.derived || '';
    let extra = null;
    if (f.header && f.rows) ({ header, rows } = f);
    else if (/\.json$/i.test(f.rel)) {
      const j = parseJSONArray(f.text);
      ({ header, rows } = j);
      if (j.objects?.length) extra = samplesTable(f.rel, j.objects, j.flat);
    } else ({ header, rows } = parseTable(f.text, f.rel));
    if (!header?.length || !rows?.length) continue;
    ({ header, rows } = expandPackedColumns(header, rows, namesFor(f.rel)));
    parsed.push({ ...f, header, rows, derived, cols: analyzeColumns(header, rows), dir: path.dirname(f.rel) });
    if (extra) parsed.push({ ...extra, cols: analyzeColumns(extra.header, extra.rows), dir: path.dirname(f.rel), text: '' });
  }

  const families = new Map();
  for (const f of parsed) {
    const sig = `${f.dir}|${f.derived}|${f.header.join(',')}`;
    if (!families.has(sig)) families.set(sig, []);
    families.get(sig).push(f);
  }

  const charts = [];
  const tables = [];
  for (const files of families.values()) {
    files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
    const first = files[0];
    const cols = first.cols;
    const rowsCount = Math.max(...files.map((f) => f.rows.length));
    const { key, labels } = familyLabels(files);
    const familyTitle = labelFor(key);
    const perFamily = (first.derived || first.pattern) ? Math.min(2, maxPerFamily) : maxPerFamily;

    for (const f of files) tables.push({ rel: f.rel, header: f.header, rows: f.rows.slice(0, 200), total: f.rows.length, derived: f.derived || '', pattern: f.pattern || '' });
    if (rowsCount < 2 || files.every((f) => f.nochart)) continue;

    // Pick X: a preferred name first, then a monotonic time column, then a leading monotonic integer column.
    let x = null;
    for (const name of X_NAMES) {
      const c = cols.find((k) => k.name.toLowerCase() === name && (k.type === 'int' || k.type === 'number' || k.type === 'time') && !k.constant);
      if (c) { x = c; break; }
    }
    if (!x) x = cols.find((c) => c.type === 'time' && c.monotonic) || cols.find((c) => c.type === 'int' && c.monotonic && c.index === 0) || null;
    const strCols = cols.filter((c) => c.type === 'string' && !c.empty && !c.constant);
    const categorical = !x && cols[0] && (cols[0].type === 'string' || cols[0].type === 'time') && !cols[0].empty && rowsCount <= 24 && files.length === 1;
    // Long-format tables ("mode,test,median…"): the first two text columns index the rows together.
    const pivot = categorical && strCols.length >= 2 && strCols[0] === cols[0] && cols[0].unique < rowsCount && (() => {
      const pairs = new Set(cols[0].values.map((v, i) => `${v}\u0000${strCols[1].values[i]}`));
      return pairs.size === rowsCount && cols[0].unique <= 8 && strCols[1].unique <= 16;
    })();
    if (!x && !categorical) {
      if (rowsCount >= 3 && cols.some((c) => (c.type === 'number' || c.type === 'int') && !c.constant)) {
        x = { name: 'index', type: 'int', values: first.rows.map((_, i) => i + 1), synthetic: true };
      } else continue;
    }
    if (x && rowsCount < 3) continue; // two points are not a line
    // Absolute clocks (monotonic seconds, epoch seconds) become "elapsed" per series so cases overlay.
    const elapsed = !!(x && !x.synthetic && x.type !== 'time' && ABSOLUTE_CLOCK_RE.test(x.name) && Math.max(...x.values.filter((v) => v != null)) > 1e5);

    // A prompt/dataset listing (long text cells) only gets charts for columns that look like measurements.
    const texty = strCols.some((c) => c.values.reduce((a, v) => a + String(v).length, 0) / Math.max(1, c.values.length) > 120);
    const yCols = cols.filter((c) => (c.type === 'number' || c.type === 'int') && !c.constant && c !== x
      && !EXCLUDE_Y_RE.test(c.name) && !X_NAMES.includes(c.name.toLowerCase()) && !TIMELIKE_RE.test(c.name)
      && (!texty || unitFor(c.name) || prio(c.name) < 99));
    if (!yCols.length) continue;
    yCols.sort((a, b) => prio(a.name) - prio(b.name));

    if (pivot) {
      const sCol = cols[0]; const xCol = strCols[1];
      const seriesKeys = [...new Set(sCol.values)];
      const allCats = [...new Set(xCol.values)];
      const xLabel = labelFor(xCol.name);
      let made = 0;
      for (const yc of yCols) {
        if (made++ >= perFamily) break;
        const { unit, factor } = normalizeUnit(unitFor(yc.name), yc.values);
        const value = (sk, cat) => { const i = sCol.values.findIndex((v, k) => v === sk && xCol.values[k] === cat); return i === -1 || yc.values[i] == null ? null : yc.values[i] * factor; };
        // Categories whose values differ by more than 20× (prompt processing at 7,700 tokens/s next to generation
        // at 70) are drawn on separate axes, otherwise the small bars vanish.
        const catMax = (cat) => Math.max(...seriesKeys.map((sk) => Math.abs(value(sk, cat) ?? 0)));
        const groups = splitCategories(allCats, catMax);
        for (const cats of groups) {
          const series = seriesKeys.slice(0, 6).map((sk) => ({ name: sk, values: cats.map((cat) => value(sk, cat)) }));
          charts.push({
            kind: 'bar', file: first.rel, files: files.map((f) => f.rel), priority: prio(yc.name), points: cats.length,
            title: `${withUnit(labelFor(yc.name), unit)} by ${xLabel.toLowerCase()} — ${seriesKeys.join(', ')}${groups.length > 1 ? ` · ${cats.join(', ')}` : ''}`,
            unit, xLabel, x: { name: xCol.name, type: 'category', values: cats }, series,
          });
        }
      }
      continue;
    }

    if (categorical) {
      let labelsRaw = cols[0].values.map(String);
      if (strCols.length >= 2 && cols[0].unique < rowsCount) labelsRaw = labelsRaw.map((l, i) => `${l} · ${strCols[1].values[i]}`);
      const seenL = new Map(); labelsRaw = labelsRaw.map((l) => { const n = (seenL.get(l) || 0) + 1; seenL.set(l, n); return n > 1 ? `${l} (${n})` : l; });
      const prefix = commonPrefix(labelsRaw);
      const cats = prefix.length >= 6 && labelsRaw.every((l) => l.length > prefix.length) ? labelsRaw.map((l) => l.slice(prefix.length)) : labelsRaw;
      // Columns share a chart only when they share a unit and a similar magnitude (a 0.3 % CV next to 100 % coverage would vanish).
      const groups = new Map();
      const maxAbs = (c) => Math.max(...c.values.filter((v) => v != null).map(Math.abs), 0);
      for (const c of yCols) {
        const u = unitFor(c.name) || `__${c.name}`;
        let g = u; let i = 1;
        while (groups.has(g) && (groups.get(g).some((o) => { const a = maxAbs(o), b = maxAbs(c); return a > 0 && b > 0 && (a / b > 20 || b / a > 20); }))) g = `${u}#${++i}`;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(c);
      }
      let made = 0;
      for (const [u, gcols] of groups) {
        if (made++ >= perFamily) break;
        const rawUnit = u.startsWith('__') ? unitFor(gcols[0].name) : u.replace(/#\d+$/, '');
        const { unit, factor } = normalizeUnit(rawUnit, gcols.flatMap((c) => c.values));
        const series = gcols.slice(0, 6).map((c) => ({ name: labelFor(c.name), values: scale(c.values, factor) }));
        const xLabel = labelFor(cols[0].name);
        charts.push({
          kind: 'bar', file: first.rel, files: files.map((f) => f.rel), priority: Math.min(...gcols.map((c) => prio(c.name))), points: cats.length,
          title: gcols.length > 1 ? `${unit || 'Values'} by ${xLabel.toLowerCase()} — ${series.map((s) => s.name.toLowerCase()).join(', ')}` : `${withUnit(series[0].name, unit)} by ${xLabel.toLowerCase()}`,
          unit, xLabel, x: { name: cols[0].name, type: 'category', values: cats }, series,
        });
      }
      continue;
    }

    // A text column with a few repeated values (mode, test, backend…) splits each file into one line per value.
    const seriesCol = strCols.find((c) => c !== x && c.unique >= 2 && c.unique <= 8 && rowsCount >= c.unique * 2 && !/(^|[._])(id|name|note|prompt|path|file|url|hash)$/i.test(c.name)) || null;

    let picked = 0;
    for (const yc of yCols) {
      if (picked++ >= perFamily) break;
      const rawUnit = unitFor(yc.name);
      const { unit, factor } = normalizeUnit(rawUnit, files.flatMap((f) => f.cols.find((c) => c.name === yc.name)?.values || []));
      const series = [];
      files.slice(0, 6).forEach((f, si) => {
        const col = f.cols.find((c) => c.name === yc.name);
        if (!col) return;
        let xsAll = x.synthetic ? f.rows.map((_, i) => i + 1) : f.cols.find((c) => c.name === x.name).values;
        const sc = seriesCol ? f.cols.find((c) => c.name === seriesCol.name) : null;
        const keys = sc ? [...new Set(sc.values)] : [null];
        for (const sk of keys) {
          const idx = xsAll.map((_, i) => i).filter((i) => !sc || sc.values[i] === sk);
          let xs = idx.map((i) => xsAll[i]);
          if (elapsed) { const x0 = Math.min(...xs.filter((v) => v != null)); xs = xs.map((v) => (v == null ? null : v - x0)); }
          const pts = xs.map((xv, j) => [xv, col.values[idx[j]] == null ? null : col.values[idx[j]] * factor]).filter((p) => p[0] != null && p[1] != null);
          if (pts.length < 2) continue;
          const fileLabel = files.length > 1 ? labels[si] : '';
          const name = sk != null ? (fileLabel ? `${fileLabel} ${sk}` : String(sk)) : (fileLabel || labelFor(yc.name));
          series.push({ name, points: thin(pts) });
        }
      });
      if (!series.length) continue;
      const xLabel = x.synthetic ? 'Row' : elapsed ? 'Elapsed (s)' : labelFor(x.name);
      const baseTitle = `${labelFor(yc.name)} by ${xLabel.toLowerCase()}`;
      // Series whose magnitudes differ by more than 20× (7,700 tokens/s next to 70) get their own chart each.
      for (const grp of splitByMagnitude(series)) {
        const stats = grp.map((s) => ({ name: s.name, median: median(s.points.map((p) => p[1])), min: Math.min(...s.points.map((p) => p[1])), max: Math.max(...s.points.map((p) => p[1])) }));
        const suffix = series.length > 1 ? ` — ${grp.length > 3 && grp.length === series.length && files.length > 1 && !seriesCol ? familyTitle : grp.map((s) => s.name).join(', ')}` : '';
        charts.push({
          kind: 'line', file: first.rel, files: files.map((f) => f.rel), priority: prio(yc.name), points: Math.max(...grp.map((s) => s.points.length)),
          title: `${baseTitle}${suffix}`, unit, xLabel, xType: x.type === 'time' ? 'time' : 'number',
          series: grp.slice(0, 6), stats, extra: Math.max(0, grp.length - 6) + (files.length > 6 ? files.length - 6 : 0),
        });
      }
    }
  }
  // Most informative first: headline metrics (throughput, tokens/s, power…) before housekeeping telemetry, then richer charts.
  charts.sort((a, b) => a.priority - b.priority || b.points - a.points);
  const kept = charts.slice(0, maxCharts);
  kept.forEach((c, i) => { c.id = `chart-${i + 1}`; });
  return { charts: kept, tables, skipped: charts.length - kept.length };
}

// Split categories into at most two groups at the widest gap in magnitude, when that gap exceeds 20×.
function splitCategories(cats, magnitude) {
  if (cats.length < 2) return [cats];
  const sorted = [...cats].sort((a, b) => magnitude(a) - magnitude(b));
  let cut = -1; let widest = 20;
  for (let i = 1; i < sorted.length; i++) {
    const lo = magnitude(sorted[i - 1]); const hi = magnitude(sorted[i]);
    const ratio = lo > 0 ? hi / lo : (hi > 0 ? Infinity : 1);
    if (ratio > widest) { widest = ratio; cut = i; }
  }
  if (cut === -1) return [cats];
  const low = new Set(sorted.slice(0, cut));
  return [cats.filter((c) => !low.has(c)), cats.filter((c) => low.has(c))];
}

// Split series into at most two groups at the widest gap in median magnitude, when that gap exceeds 20×.
function splitByMagnitude(series) {
  if (series.length < 2) return [series];
  const med = (s) => Math.abs(median(s.points.map((p) => p[1]))) || 0;
  const sorted = [...series].sort((a, b) => med(a) - med(b));
  let cut = -1; let widest = 20;
  for (let i = 1; i < sorted.length; i++) {
    const lo = med(sorted[i - 1]); const hi = med(sorted[i]);
    const ratio = lo > 0 ? hi / lo : (hi > 0 ? Infinity : 1);
    if (ratio > widest) { widest = ratio; cut = i; }
  }
  if (cut === -1) return [series];
  const low = new Set(sorted.slice(0, cut));
  return [series.filter((s) => !low.has(s)), series.filter((s) => low.has(s))];
}

// Which text columns index a small long-format table (see `pivot` above) — shared with keyStatsFromRuns.
function pivotColumns(cols, rowsCount) {
  const strCols = cols.filter((c) => c.type === 'string' && !c.empty && !c.constant);
  if (strCols.length < 2 || strCols[0] !== cols[0] || rowsCount > 24 || cols[0].unique >= rowsCount) return null;
  const pairs = new Set(cols[0].values.map((v, i) => `${v}\u0000${strCols[1].values[i]}`));
  return pairs.size === rowsCount ? [cols[0], strCols[1]] : null;
}

// A compact set of headline numbers from a runs-style CSV (one row per run / case).
export function keyStatsFromRuns(header, rows, { rowNoun = 'runs' } = {}) {
  const cols = analyzeColumns(header, rows);
  const stats = [];
  const pivot = pivotColumns(cols, rows.length);
  if (pivot) {
    // A summary keyed by (mode, test): the headline is the best value of the first metric, and where it occurred.
    const metric = cols.filter((c) => (c.type === 'number' || c.type === 'int') && !c.constant && !EXCLUDE_Y_RE.test(c.name) && !TIMELIKE_RE.test(c.name) && !X_NAMES.includes(c.name.toLowerCase()))
      .sort((a, b) => prio(a.name) - prio(b.name))[0];
    if (metric) {
      const { unit, factor } = normalizeUnit(unitFor(metric.name), metric.values);
      let bi = -1; metric.values.forEach((v, i) => { if (v != null && (bi === -1 || v > metric.values[bi])) bi = i; });
      if (bi >= 0) stats.push({ label: `peak ${labelFor(metric.name).toLowerCase()} · ${pivot.map((c) => c.values[bi]).join(' ')}`, value: metric.values[bi] * factor, numeric: true, unit, _kind: 'number' });
    }
    return stats;
  }
  if (rows.length) stats.push({ label: rows.length === 1 ? rowNoun.replace(/s$/, '') : rowNoun, value: String(rows.length), _kind: 'count' });
  const med = cols.find((c) => /median/i.test(c.name) && (c.type === 'number' || c.type === 'int') && !TIMELIKE_RE.test(c.name));
  if (med) {
    const m = median(med.values.filter((v) => v != null));
    const { unit, factor } = normalizeUnit(unitFor(med.name), med.values);
    const what = labelFor(med.name).replace(/^Median\s*/i, '').replace(/\s*Block\s*/i, ' ').trim().toLowerCase();
    if (Number.isFinite(m)) stats.push({ label: what && what !== unit.toLowerCase() ? `median ${what} across ${rowNoun}` : `median across ${rowNoun}`, value: m * factor, numeric: true, unit, _kind: 'number' });
  }
  for (const c of cols) {
    if (c.type === 'bool' && /pass|ok|success|correct|stab|met/i.test(c.name)) {
      const vals = c.values.map((v) => String(v).toLowerCase());
      const passed = vals.filter((v) => ['true', 'yes', 'pass', 'passed'].includes(v)).length;
      const label = labelFor(c.name).replace(/ Pass$/i, '').toLowerCase();
      const advisory = /stab/i.test(c.name);
      const value = passed === vals.length ? 'PASS' : advisory && passed === 0 ? 'WARNING' : `${passed}/${vals.length}`;
      stats.push({ label, value, status: passed === vals.length ? 'good' : 'warn', _kind: 'bool' });
    }
  }
  return stats.slice(0, 4);
}
