// Helpers for JSON result files (summary.json, config.json, status.json …):
// turn top-level scalars into a readable key/value panel and pull out a few
// headline numbers. Schema-agnostic: nothing here assumes particular keys.
import { labelFor, unitFor, normalizeUnit } from './csv.mjs';
import { formatBytes, formatNumber } from './util.mjs';

const isScalar = (v) => v == null || ['number', 'string', 'boolean'].includes(typeof v);

export function formatValue(key, v) {
  if (v == null) return { text: '—', muted: true };
  if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No', status: v ? 'good' : 'warn' };
  if (typeof v === 'number') {
    if (/bytes$/i.test(key)) return { text: formatBytes(v) };
    const raw = unitFor(key);
    const { unit, factor } = normalizeUnit(raw, [v]);
    const n = v * factor;
    if (unit === '%') return { text: `${formatNumber(n, Math.abs(n) >= 10 ? 1 : 2)} %` };
    if (Number.isInteger(n)) { const plain = /seed|_id$|^id$|hash|port|year|pid/i.test(key); return { text: unit ? `${plain ? n : n.toLocaleString('en-US')} ${unit}` : plain ? String(n) : n.toLocaleString('en-US') }; }
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
    if (/^(complete|completed|pass|passed|ok|success|succeeded|met)$/i.test(v)) return { text: v, status: 'good' };
    if (/^(incomplete|running|fail|failed|error|warning|unavailable)/i.test(v)) return { text: v, status: 'warn' };
    return { text: v, long: v.length > 90 };
  }
  return { text: String(v) };
}

/** Top-level scalar fields (and short scalar arrays) of a JSON object as panel rows. */
export function panelFromJSON(obj, { max = 24 } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    if (rows.length >= max) break;
    if (isScalar(v) || (Array.isArray(v) && v.every(isScalar))) rows.push({ key: k, label: labelFor(k), ...formatValue(k, v) });
  }
  return rows;
}

/** Headline tiles from a summary-like JSON object. */
export function keyStatsFromJSON(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const stats = [];
  // largest array of objects → "N cases"
  let best = null;
  for (const [k, v] of Object.entries(obj)) if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object') && (!best || v.length > best.n)) best = { k, n: v.length };
  if (best) stats.push({ label: best.n === 1 ? best.k.replace(/s$/, '') : best.k, value: String(best.n), _kind: 'count' });
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && /median|mean|overhead|score|accuracy|throughput|tokens|latency/i.test(k) && !/bytes$/i.test(k)) {
      const raw = unitFor(k); const { unit, factor } = normalizeUnit(raw, [v]);
      stats.push({ label: labelFor(k).toLowerCase(), value: v * factor, numeric: true, unit, _kind: 'number' });
    }
    if (typeof v === 'boolean' && /met|pass|ok|success|valid|complete/i.test(k)) stats.push({ label: labelFor(k).toLowerCase(), value: v ? 'YES' : 'NO', status: v ? 'good' : 'warn', _kind: 'bool' });
    if (typeof v === 'string' && /^status$/i.test(k)) stats.push({ label: 'run status', value: v.toUpperCase(), status: /complete|pass|ok|success/i.test(v) ? 'good' : 'warn', _kind: 'status' });
  }
  return stats;
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
