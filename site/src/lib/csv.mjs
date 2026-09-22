// Tabular data (CSV / TSV / JSON Lines) parsing and chart inference. Given the
// data files of a results session, work out which ones can be drawn and produce
// chart specs that the browser renders (assets/charts.js). Everything here is
// heuristic and defensive: a file that fits no rule simply gets a table view.
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

// JSON Lines: one object per line. Scalar fields become columns (first-seen order); nested values are skipped.
export function parseJSONL(text) {
  const header = [];
  const objs = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    for (const k of Object.keys(o)) { const v = o[k]; if ((v == null || ['number', 'string', 'boolean'].includes(typeof v)) && !header.includes(k)) header.push(k); }
    objs.push(o);
  }
  const rows = objs.map((o) => header.map((k) => { const v = o[k]; return v == null ? '' : typeof v === 'object' ? '' : String(v); }));
  return { header, rows };
}

export function parseTable(text, fileName) {
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (ext === 'jsonl' || ext === 'ndjson') return parseJSONL(text);
  if (ext === 'tsv') return parseCSV(text, '\t');
  return parseCSV(text);
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const BOOL = new Set(['true', 'false', 'yes', 'no', 'pass', 'fail', 'passed', 'failed']);

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

// Candidate X columns, in order of preference.
const X_NAMES = ['trial', 'step', 'epoch', 'iteration', 'iter', 'block', 'index', 'idx', 'i', 'n', 'elapsed', 'elapsed_s', 'elapsed_seconds',
  't', 't_s', 'time', 'time_s', 'timestamp', 'timestamp_s', 'timestamp_utc', 'utc', 'mono', 'mono_start', 'epoch_s', 'unix', 'wall', 'wall_start',
  'date', 'datetime', 'x', 'batch', 'tick', 'seq', 'sample_index', 'token', 'tokens', 'position', 'layer', 'size', 'n_tokens', 'context',
  'context_length', 'batch_size', 'threads'];
const EXCLUDE_Y = ['seed', 'id', 'run', 'run_id', 'pid', 'sample', 'image_digest', 'digest', 'hash', 'sha256', 'pair', 'blocks'];
const TIMELIKE_RE = /(^|_)(start|end|begin|stop|utc|mono|epoch|unix|timestamp|time|date|wall_start|wall_end)(_|$)/i;
const ABSOLUTE_CLOCK_RE = /(utc|mono|epoch|unix|timestamp|wall|^time$|^t$)/i;
const PRIORITY = ['tflops', 'gflops', 'throughput', 'tokens', 'tok', 'ops_per', 'ops', 'latency', 'power', 'energy', 'joules', 'overhead',
  'accuracy', 'loss', 'util', 'temp', 'sm_mhz', 'clock', 'mhz', 'f1', 'auc', 'seconds', 'ms', 'cv', 'coverage', 'memavailable', 'mem', 'query'];

const UNITS = [
  [/(^|_)(tflops?|tflop_s|tflop\/s)$/i, 'TFLOP/s'], [/(^|_)(gflops?)$/i, 'GFLOP/s'], [/(^|_)(tokens?_(per_)?s(ec|econd)?|tok_s|tps|tokens_s)$/i, 'tokens/s'],
  [/(^|_)ops_per_(s|sec|second)$/i, 'ops/s'], [/(^|_)joules?_per_(\w+)$/i, (m) => `J/${m[2]}`], [/(^|_)(\w+)_per_(s|sec|second)$/i, (m) => `${m[2]}/s`],
  [/(^|_)(j|joules?|energy_j)$/i, 'J'], [/(^|_)(wh)$/i, 'Wh'], [/(^|_)(kwh)$/i, 'kWh'],
  [/(^|_)(ms|millis|milliseconds)$/i, 'ms'], [/(^|_)(us|micros|microseconds)$/i, 'µs'], [/(^|_)(s|sec|secs|seconds|elapsed)$/i, 's'],
  [/(^|_)(pct|percent|percentage)$/i, '%'], [/(^|_)(w|watts?)$/i, 'W'], [/(^|_)(c|celsius|temp_c)$/i, '°C'],
  [/(^|_)(kb)$/i, 'KB'], [/(^|_)(mb)$/i, 'MB'], [/(^|_)(gb)$/i, 'GB'], [/(^|_)(gib)$/i, 'GiB'], [/(^|_)(mib)$/i, 'MiB'],
  [/(^|_)(bytes?)$/i, 'bytes'], [/(^|_)(mhz)$/i, 'MHz'], [/(^|_)(ghz)$/i, 'GHz'], [/(^|_)(gbps)$/i, 'Gb/s'], [/(^|_)(mbps)$/i, 'Mb/s'],
];

export function unitFor(name) {
  const n = String(name);
  for (const [re, u] of UNITS) { const m = re.exec(n); if (m) return typeof u === 'function' ? u(m) : u; }
  if (/coefficient_of_variation|(^|_)cv$|(^|_)(coverage|fraction|ratio)$/i.test(n)) return 'ratio';
  return '';
}

const WORDS = { wall: 'Wall time', s: 'Seconds', seconds: 'Seconds', ms: 'Milliseconds', median_block: 'Median block throughput', warmup: 'Warm-up', lr: 'Learning rate', acc: 'Accuracy', ppl: 'Perplexity', tps: 'Tokens/s', ttft: 'Time to first token', tpot: 'Time per output token', util: 'Utilisation', mem: 'Memory', temp: 'Temperature', cv: 'Variability (CV)', block_cv: 'Block variability (CV)', rel_l2: 'Relative L2 error', p50: 'p50', p90: 'p90', p95: 'p95', p99: 'p99', sm: 'SM clock', memavailable: 'Memory available', memtotal: 'Memory total', swapfree: 'Swap free', swaptotal: 'Swap total', query: 'Query time', ops: 'Operations', operations: 'Operations', joules: 'Energy', energy: 'Energy' };

export function labelFor(name) {
  let n = String(name);
  const unitOnly = unitFor(n);
  n = n.replace(/(^|_)(tflops?|gflops?|tokens?_(per_)?s(ec|econd)?|tok_s|tps|per_(s|sec|second)|per_\w+|ms|us|secs?|seconds|elapsed|pct|percent|percentage|w|watts?|c|celsius|j|joules?|wh|kwh|kb|mb|gb|gib|mib|bytes?|mhz|ghz|gbps|mbps)$/i, '');
  n = n.replace(/^gpu_/, 'GPU ').replace(/^cpu_/, 'CPU ').replace(/^mem_/, 'memory ').replace(/_utc$/, '').replace(/_id$/, '');
  n = n.replace(/coefficient_of_variation/, 'variability (CV)');
  n = n.trim().replace(/^_+|_+$/g, '');
  if (!n) { const w = WORDS[String(name).toLowerCase()]; return w || (unitOnly && /[/%]/.test(unitOnly) ? unitOnly : titleCase(name)); }
  if (WORDS[n.toLowerCase()]) return WORDS[n.toLowerCase()];
  const t = titleCase(n);
  return t.replace(/\bTflops\b/i, 'TFLOP/s').replace(/\bCv\b/, 'CV').replace(/\bGpu\b/, 'GPU').replace(/\bCpu\b/, 'CPU').replace(/\bKb\b/, 'KB').replace(/\bSm\b/, 'SM').replace(/\bP(\d\d)\b/g, 'p$1');
}

// Large raw units are easier to read rescaled: KB → GB, bytes → MB/GB, ratio → %.
export function normalizeUnit(unit, values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return { unit, factor: 1 };
  const max = Math.max(...v.map(Math.abs));
  if (unit === 'KB' && max >= 1e6) return { unit: 'GB', factor: 1 / 1048576 };
  if (unit === 'KB' && max >= 1e3) return { unit: 'MB', factor: 1 / 1024 };
  if (unit === 'MB' && max >= 1e4) return { unit: 'GB', factor: 1 / 1024 };
  if (unit === 'bytes' && max >= 1e9) return { unit: 'GB', factor: 1 / 1073741824 };
  if (unit === 'bytes' && max >= 1e6) return { unit: 'MB', factor: 1 / 1048576 };
  if (unit === 'ratio' && max <= 2) return { unit: '%', factor: 100 };
  if (unit === 'µs' && max >= 1e4) return { unit: 'ms', factor: 1 / 1000 };
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
const baseName = (rel) => path.basename(rel).replace(/\.(csv|tsv|jsonl|ndjson)$/i, '');

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
  const key = (pre + suf).replace(/[-_ ]+$/g, '').replace(/^[-_ ]+/g, '') || names[0];
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
  const i = PRIORITY.findIndex((p) => n.includes(p));
  return i === -1 ? 99 : i;
}

/**
 * @param {{rel:string, text:string}[]} dataFiles  CSV / TSV / JSONL files of one results session (rel = path inside the session)
 * @param {{maxCharts?: number, maxPerFamily?: number}} [opts]
 * @returns {{charts: object[], tables: object[]}}
 */
export function inferCharts(dataFiles, opts = {}) {
  const maxCharts = opts.maxCharts ?? 10;
  const maxPerFamily = opts.maxPerFamily ?? 4;
  const parsed = dataFiles.map((f) => {
    const { header, rows } = parseTable(f.text, f.rel);
    return { ...f, header, rows, cols: analyzeColumns(header, rows), dir: path.dirname(f.rel) };
  }).filter((f) => f.header.length && f.rows.length);

  const families = new Map();
  for (const f of parsed) {
    const sig = `${f.dir}|${f.header.join(',')}`;
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

    for (const f of files) tables.push({ rel: f.rel, header: f.header, rows: f.rows.slice(0, 200), total: f.rows.length });
    if (rowsCount < 2) continue;

    // Pick X: a preferred name first, then a monotonic time column, then a leading monotonic integer column.
    let x = null;
    for (const name of X_NAMES) {
      const c = cols.find((k) => k.name.toLowerCase() === name && (k.type === 'int' || k.type === 'number' || k.type === 'time') && !k.constant);
      if (c) { x = c; break; }
    }
    if (!x) x = cols.find((c) => c.type === 'time' && c.monotonic) || cols.find((c) => c.type === 'int' && c.monotonic && c.index === 0) || null;
    const categorical = !x && cols[0] && (cols[0].type === 'string' || cols[0].type === 'time') && !cols[0].empty && rowsCount <= 24 && files.length === 1;
    if (!x && !categorical) {
      if (rowsCount >= 3 && cols.some((c) => (c.type === 'number' || c.type === 'int') && !c.constant)) {
        x = { name: 'index', type: 'int', values: first.rows.map((_, i) => i + 1), synthetic: true };
      } else continue;
    }
    // Absolute clocks (monotonic seconds, epoch seconds) become "elapsed" per series so cases overlay.
    const elapsed = !!(x && !x.synthetic && x.type !== 'time' && ABSOLUTE_CLOCK_RE.test(x.name) && Math.max(...x.values.filter((v) => v != null)) > 1e5);

    const yCols = cols.filter((c) => (c.type === 'number' || c.type === 'int') && !c.constant && c !== x
      && !EXCLUDE_Y.includes(c.name.toLowerCase()) && !X_NAMES.includes(c.name.toLowerCase()) && !TIMELIKE_RE.test(c.name));
    if (!yCols.length) continue;
    yCols.sort((a, b) => prio(a.name) - prio(b.name));

    if (categorical) {
      const labelsRaw = cols[0].values.map(String);
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
        if (made++ >= maxPerFamily) break;
        const rawUnit = u.startsWith('__') ? unitFor(gcols[0].name) : u.replace(/#\d+$/, '');
        const { unit, factor } = normalizeUnit(rawUnit, gcols.flatMap((c) => c.values));
        const series = gcols.slice(0, 6).map((c) => ({ name: labelFor(c.name), values: scale(c.values, factor) }));
        const xLabel = labelFor(cols[0].name);
        charts.push({
          kind: 'bar', file: first.rel, files: files.map((f) => f.rel), priority: Math.min(...gcols.map((c) => prio(c.name))), points: cats.length,
          title: gcols.length > 1 ? `${unit || 'Values'} by ${xLabel.toLowerCase()} — ${series.map((s) => s.name.toLowerCase()).join(', ')}` : `${series[0].name}${unit ? ` (${unit})` : ''} by ${xLabel.toLowerCase()}`,
          unit, xLabel, x: { name: cols[0].name, type: 'category', values: cats }, series,
        });
      }
      continue;
    }

    for (const yc of yCols.slice(0, maxPerFamily)) {
      const rawUnit = unitFor(yc.name);
      const { unit, factor } = normalizeUnit(rawUnit, files.flatMap((f) => f.cols.find((c) => c.name === yc.name)?.values || []));
      const series = files.slice(0, 6).map((f, si) => {
        const col = f.cols.find((c) => c.name === yc.name);
        let xs = x.synthetic ? f.rows.map((_, i) => i + 1) : f.cols.find((c) => c.name === x.name).values;
        if (elapsed) { const x0 = Math.min(...xs.filter((v) => v != null)); xs = xs.map((v) => (v == null ? null : v - x0)); }
        const pts = xs.map((xv, i) => [xv, col.values[i] == null ? null : col.values[i] * factor]).filter((p) => p[0] != null && p[1] != null);
        return { name: files.length > 1 ? labels[si] : labelFor(yc.name), points: thin(pts) };
      });
      const stats = series.map((s) => ({ name: s.name, median: median(s.points.map((p) => p[1])), min: Math.min(...s.points.map((p) => p[1])), max: Math.max(...s.points.map((p) => p[1])) }));
      const xLabel = x.synthetic ? 'Row' : elapsed ? 'Elapsed (s)' : labelFor(x.name);
      charts.push({
        kind: 'line', file: first.rel, files: files.map((f) => f.rel), priority: prio(yc.name), points: Math.max(...series.map((s) => s.points.length)),
        title: `${labelFor(yc.name)} by ${xLabel.toLowerCase()}${files.length > 1 ? ` — ${familyTitle}` : ''}`,
        unit, xLabel, xType: x.type === 'time' ? 'time' : 'number',
        series, stats, extra: files.length > 6 ? files.length - 6 : 0,
      });
    }
  }
  // Most informative first: headline metrics (throughput, tokens/s, power…) before housekeeping telemetry, then richer charts.
  charts.sort((a, b) => a.priority - b.priority || b.points - a.points);
  const kept = charts.slice(0, maxCharts);
  kept.forEach((c, i) => { c.id = `chart-${i + 1}`; });
  return { charts: kept, tables, skipped: charts.length - kept.length };
}

// A compact set of headline numbers from a runs-style CSV (one row per run / case).
export function keyStatsFromRuns(header, rows, { rowNoun = 'runs' } = {}) {
  const cols = analyzeColumns(header, rows);
  const stats = [];
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
