// Helpers for JSON result files (summary.json, config.json, status.json, checkin.json …):
// turn scalars into a readable key/value panel, turn nested "one object per mode"
// summaries into comparison tables, and pull out a few headline numbers.
// Schema-agnostic: nothing here assumes particular keys.
import { labelFor, unitFor, unitForPath, normalizeUnit } from './csv.mjs';
import { formatBytes, formatNumber, redactPaths } from './util.mjs';

const isScalar = (v) => v == null || ['number', 'string', 'boolean'].includes(typeof v);
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function formatValue(key, v, { unit: unitHint } = {}) {
  if (v == null) return { text: '—', muted: true };
  if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No', status: v ? 'good' : 'warn' };
  if (typeof v === 'number') {
    if (/bytes$/i.test(key)) return { text: formatBytes(v) };
    const raw = unitHint ?? unitForPath(key);
    const { unit, factor } = normalizeUnit(raw, [v]);
    const n = v * factor;
    if (unit === '%') return { text: `${formatNumber(n, Math.abs(n) >= 10 ? 1 : 2)} %` };
    if (Number.isInteger(n)) { const plain = /seed|_id$|^id$|hash|port|year|pid|^run$/i.test(key); return { text: unit ? `${plain ? n : n.toLocaleString('en-US')} ${unit}` : plain ? String(n) : n.toLocaleString('en-US') }; }
    const a = Math.abs(n);
    const text = a >= 100 ? formatNumber(n, 1) : a >= 1 ? formatNumber(n, 3) : String(Number(n.toPrecision(3)));
    return { text: unit ? `${text} ${unit}` : text };
  }
  if (Array.isArray(v)) {
    if (v.every(isScalar) && v.length <= 12) return { text: v.map((x) => formatValue(key, x).text).join(', ') };
    return { text: `${v.length} items`, muted: true };
  }
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) { const d = new Date(v); if (!Number.isNaN(d.getTime())) return { text: d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/Z$/, ' UTC') }; }
    if (/^[0-9a-f]{40,64}$/i.test(v)) return { text: v, mono: true, truncate: true };
    if (/^\d{8}T\d{6}(\.\d+)?Z?([-_][0-9a-z]+)?$/i.test(v)) return { text: v, mono: true };
    if (/^(complete|completed|pass|passed|ok|success|succeeded|met)$/i.test(v)) return { text: v, status: 'good' };
    if (/^(incomplete|running|fail|failed|error|warning|unavailable)/i.test(v)) return { text: v, status: 'warn' };
    const t = redactPaths(v);
    return { text: t, long: t.length > 90, mono: /^[~/][\w./-]+$/.test(t) };
  }
  return { text: String(v) };
}

/**
 * Objects whose children are all objects sharing most of their (flattened) keys — {"cpu": {...}, "gpu": {...}} —
 * are comparisons: one column per child, one row per metric. Returns [{ key, title, header, rows }].
 */
export function comparisonTables(obj, { minColumns = 2, maxColumns = 8 } = {}) {
  if (!isPlainObject(obj)) return [];
  const out = [];
  const consider = (key, v) => {
    if (!isPlainObject(v)) return;
    const kids = Object.entries(v);
    if (kids.length < minColumns || kids.length > maxColumns || !kids.every(([, c]) => isPlainObject(c))) return;
    const flat = kids.map(([k, c]) => [k, flatten(c)]);
    const keyLists = flat.map(([, f]) => Object.keys(f));
    const union = [...new Set(keyLists.flat())];
    const shared = union.filter((k) => keyLists.every((l) => l.includes(k)));
    if (union.length < 2 || shared.length / union.length < 0.5) return;
    const notes = [];
    const rows = [];
    for (const path of union) {
      const vals = flat.map(([, f]) => f[path]);
      // Identical long strings (a note repeated under every mode) become a footnote instead of a row.
      if (vals.every((x) => typeof x === 'string' && x.length > 60) && new Set(vals).size === 1) { notes.push(vals[0]); continue; }
      rows.push({ key: path, label: labelFor(path), cells: vals.map((x) => (x === undefined ? { text: '—', muted: true } : formatValue(path, x))) });
    }
    if (rows.length) out.push({ key, title: `${labelFor(key)} compared`, header: ['Metric', ...kids.map(([k]) => k)], rows, notes });
  };
  for (const [k, v] of Object.entries(obj)) consider(k, v);
  return out;
}

function flatten(o, pre = '', depth = 1, out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = pre ? `${pre}.${k}` : k;
    if (isScalar(v)) out[key] = v;
    else if (Array.isArray(v)) { if (v.every(isScalar) && v.length <= 12) out[key] = v; }
    else if (depth < 5) flatten(v, key, depth + 1, out);
  }
  return out;
}

/**
 * Scalar fields (and short scalar arrays) of a JSON object as panel rows. Objects one level down that hold only
 * scalars ({"cpu": true, "gpu": false}) are flattened into "<key> · <child>" rows; `skip` lists top-level keys to
 * leave out (a `config` block already shown from config.json, a `modes` block shown as a comparison table).
 */
export function panelFromJSON(obj, { max = 28, skip = [] } = {}) {
  if (!isPlainObject(obj)) return [];
  const rows = [];
  const push = (key, label, v) => { if (rows.length < max) rows.push({ key, label, ...formatValue(key, v) }); };
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k)) continue;
    if (isScalar(v) || (Array.isArray(v) && v.every(isScalar))) push(k, labelFor(k), v);
    else if (isPlainObject(v) && Object.values(v).every(isScalar) && Object.keys(v).length <= 6) {
      for (const [ck, cv] of Object.entries(v)) push(`${k}.${ck}`, `${labelFor(k)} · ${ck}`, cv);
    }
  }
  return rows;
}

/** Headline tiles from a summary-like JSON object. */
export function keyStatsFromJSON(obj) {
  if (!isPlainObject(obj)) return [];
  const stats = [];
  // largest array of objects → "N cases"
  let best = null;
  for (const [k, v] of Object.entries(obj)) if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object') && (!best || v.length > best.n)) best = { k, n: v.length };
  if (best) stats.push({ label: best.n === 1 ? best.k.replace(/s$/, '') : best.k, value: String(best.n), _kind: 'count' });
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && /median|mean|overhead|score|accuracy|throughput|tokens|latency|speedup|ratio|gain/i.test(k) && !/bytes$/i.test(k) && !/note|version/i.test(k)) {
      const raw = unitFor(k); const { unit, factor } = normalizeUnit(raw, [v]);
      stats.push({ label: softLower(labelFor(k)), value: v * factor, numeric: true, unit, _kind: 'number' });
    }
    if (typeof v === 'boolean' && /^(complete|completed|finished|done)$/i.test(k)) stats.push({ label: 'run status', value: v ? 'COMPLETE' : 'INCOMPLETE', status: v ? 'good' : 'warn', _kind: 'status' });
    else if (typeof v === 'boolean' && /met|pass|ok|success|valid|complete|hypothesis|target|within|stable/i.test(k)) stats.push({ label: softLower(labelFor(k)), value: v ? 'YES' : 'NO', status: v ? 'good' : 'warn', _kind: 'bool' });
    if (typeof v === 'string' && /^status$/i.test(k)) stats.push({ label: 'run status', value: v.toUpperCase(), status: /complete|pass|ok|success/i.test(v) ? 'good' : 'warn', _kind: 'status' });
    // {"cpu": true, "gpu": false} under a target-like key → "1/2"
    if (isPlainObject(v) && /met|pass|target|hypothesis|stab|within|ok/i.test(k)) {
      const vals = Object.values(v).filter((x) => typeof x === 'boolean');
      if (vals.length) { const n = vals.filter(Boolean).length; stats.push({ label: softLower(labelFor(k)), value: `${n}/${vals.length}`, status: n === vals.length ? 'good' : 'warn', _kind: 'bool' }); }
    }
  }
  return stats;
}

// Lower-case a label for a tile without flattening acronyms ("GPU vs CPU TG Speedup" → "GPU vs CPU TG speedup").
export function softLower(s) {
  return String(s).split(' ').map((w) => (/^[A-Z0-9][A-Z0-9/.-]*$/.test(w) && /[A-Z]/.test(w) && w.length > 1 ? w : w.toLowerCase())).join(' ');
}

/** Merge tiles from several sources into at most four, most informative first. */
export function pickHighlights(...lists) {
  const all = lists.flat().filter(Boolean);
  const order = { count: 0, number: 1, bool: 2, status: 3 };
  const seen = new Set(); const out = [];
  for (const s of all.sort((a, b) => (order[a._kind] ?? 1) - (order[b._kind] ?? 1))) {
    const key = s.label + '|' + (s.unit || '');
    if (seen.has(key)) continue;
    seen.add(key); out.push(s);
    if (out.length === 4) break;
  }
  return out.map(({ _kind, ...s }) => s);
}
