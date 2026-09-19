// Small shared helpers for the build. No dependencies.
import fs from 'node:fs';
import path from 'node:path';

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const attr = esc;

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

export function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

export function readJSON(file) {
  const t = readText(file);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
export function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
export function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
export function fileSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }

export function listFiles(dir, { ignore = [] } = {}) {
  // Recursive file list with paths relative to dir, POSIX separators, sorted.
  const out = [];
  const walk = (d, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (ignore.some((re) => re.test(r))) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) out.push({ rel: r, full, size: fileSize(full) });
    }
  };
  walk(dir, '');
  return out;
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

export function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content);
}

export function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

export function rmDir(p) { fs.rmSync(p, { recursive: true, force: true }); }

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatNumber(v, digits) {
  if (v == null || !Number.isFinite(Number(v))) return String(v ?? '');
  const n = Number(v);
  if (digits != null) return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}

export function compactNumber(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return formatNumber(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso, { long = false } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const day = d.getUTCDate();
  const mon = long
    ? d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
    : MONTHS[d.getUTCMonth()];
  return `${day} ${mon} ${d.getUTCFullYear()}`;
}

export function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 10);
}

// Session folder names look like 20260911T133621.601983Z — turn them into ISO timestamps.
export function parseSessionStamp(name) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z?$/.exec(String(name));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? '.' + m[7].slice(0, 3) : ''}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function relPath(fromDepth, target) {
  // Path from a page nested `fromDepth` directories deep to a root-relative target.
  const up = fromDepth > 0 ? '../'.repeat(fromDepth) : './';
  return up + String(target).replace(/^\.?\//, '');
}

export function uniqueBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = keyFn(x); if (seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}

export function titleCase(s) {
  return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function readingTime(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 200)) };
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function log(...args) { console.log('[site]', ...args); }
export function warn(...args) { console.warn('[site] warning:', ...args); }

// Pixel dimensions of PNG / JPEG / GIF / WebP files (enough to set width/height on <img> and avoid layout shift).
export function imageSize(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf.length < 24) return null;
  if (buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L' && buf.length >= 25) { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8X' && buf.length >= 30) return { width: (buf.readUIntLE(24, 3)) + 1, height: (buf.readUIntLE(27, 3)) + 1 };
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
