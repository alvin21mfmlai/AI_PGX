// Reusable fragments shared by the home page and the week pages.
import { esc, formatDate, formatNumber, formatBytes, compactNumber } from '../lib/util.mjs';

export const ICONS = {
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5A11.5 11.5 0 0 0 .5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.05.78 2.12v3.14c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/></svg>',
  scholar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 9l11 7 9-5.73V17h2V9L12 2Zm0 16.5-6-3.82V18c0 1.66 2.69 3 6 3s6-1.34 6-3v-3.32l-6 3.82Z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  rss: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56Zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9ZM5.98 16.04a1.98 1.98 0 1 0 0 3.96 1.98 1.98 0 0 0 0-3.96Z"/></svg>',
  chip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2"/><rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m5 12 4.5 4.5L19 7"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 7v5l3 2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 3v4m8-4v4M3 10h18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2Z"/></svg>',
};

export const icon = (name, cls = 'ico') => `<span class="${cls}">${ICONS[name] || ''}</span>`;

export function tagList(tags, cls = 'tags') {
  if (!tags?.length) return '';
  return `<ul class="${cls}" aria-label="Topics">${tags.map((t) => `<li class="tag">${esc(t)}</li>`).join('')}</ul>`;
}

export function statDecimals(v) {
  const n = Number(v);
  if (Number.isInteger(n) || Math.abs(n) >= 100) return 0;
  return Math.abs(n) >= 1 ? 1 : 3;
}

export function statTile({ label, value, unit = '', status = '', numeric = false, citeHtml = '' }, { size = '' } = {}) {
  const num = numeric && Number.isFinite(Number(value));
  const d = num ? statDecimals(value) : 0;
  const shown = num ? formatNumber(Number(value), d) : esc(String(value));
  const isText = !num && String(value).length > 6;
  const statusIcon = status === 'good' ? icon('check', 'ico ico--good') : status === 'warn' ? icon('warn', 'ico ico--warn') : '';
  return `<div class="stat${size ? ` stat--${size}` : ''}${status ? ` stat--${status}` : ''}${isText ? ' stat--text' : ''}">
    <div class="stat__value">${statusIcon}<span${num ? ` data-count="${Number(value)}" data-decimals="${d}"` : ''}>${shown}</span>${unit ? `<span class="stat__unit">${esc(unit)}</span>` : ''}${citeHtml}</div>
    <div class="stat__label">${esc(label)}</div>
  </div>`;
}

export function sparklineSVG(values, { width = 160, height = 44 } = {}) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v); const max = Math.max(...v);
  const pad = 4;
  const sx = (i) => pad + (i / (v.length - 1)) * (width - pad * 2);
  const sy = (y) => (max === min ? height / 2 : pad + (1 - (y - min) / (max - min)) * (height - pad * 2));
  const d = v.map((y, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
  const area = `${d} L${sx(v.length - 1).toFixed(1)},${height} L${sx(0).toFixed(1)},${height} Z`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">
    <path d="${area}" class="spark__area"/><path d="${d}" class="spark__line"/>
    <circle cx="${sx(v.length - 1).toFixed(1)}" cy="${sy(v[v.length - 1]).toFixed(1)}" r="3.5" class="spark__dot"/></svg>`;
}

export function weekCard(w, { base = './', featured = false } = {}) {
  const num = String(w.num).padStart(2, '0');
  const stats = (w.highlights || []).slice(0, 3);
  return `<a class="wcard${featured ? ' wcard--featured' : ''} rv" href="${base}${w.url}" aria-label="${esc(w.label)} ${num}: ${esc(w.title)}">
    <div class="wcard__top">
      <span class="wnum">${esc(w.label)} ${num}</span>
      ${w.date ? `<time class="wcard__date" datetime="${esc(w.date)}">${esc(formatDate(w.date))}</time>` : ''}
    </div>
    <h3 class="wcard__title">${esc(w.title)}</h3>
    <p class="wcard__summary">${esc(w.summaryText)}</p>
    ${tagList(w.tags)}
    <div class="wcard__foot">
      ${stats.length ? `<ul class="minis" aria-label="Key results">${stats.map((s) => `<li><strong>${s.numeric ? esc(formatNumber(Number(s.value), statDecimals(s.value))) : esc(String(s.value))}</strong> <span>${esc(s.unit ? s.unit : s.label)}</span></li>`).join('')}</ul>` : `<span class="minis"><span>${w.readingTime.minutes} min read</span></span>`}
      ${w.sparkline ? sparklineSVG(w.sparkline.values) : ''}
    </div>
    <span class="wcard__cta">Open the write-up ${icon('arrow')}</span>
  </a>`;
}

export function placeholderCard(num, label) {
  return `<div class="wcard wcard--soon rv" aria-hidden="true">
    <div class="wcard__top"><span class="wnum wnum--soon">${esc(label)} ${String(num).padStart(2, '0')}</span></div>
    <h3 class="wcard__title">Coming next</h3>
    <p class="wcard__summary">The next experiment folder will appear here automatically once it lands in the repository.</p>
  </div>`;
}

export function refList(refs, { numbered = true, startAt = 1, idPrefix = 'ref' } = {}) {
  if (!refs?.length) return '';
  const items = refs.map((r, i) => {
    const n = startAt + i;
    const host = safeHost(r.url);
    return `<li id="${idPrefix}-${esc(r.id || n)}" class="ref">
      ${numbered ? `<span class="ref__num">[${n}]</span>` : ''}
      <div class="ref__body">
        <a class="ref__title ext" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title || r.text || r.url)}</a>
        <div class="ref__meta">${r.publisher ? `<span>${esc(r.publisher)}</span>` : ''}${host ? `<span class="ref__host">${esc(host)}</span>` : ''}</div>
        ${r.note ? `<p class="ref__note">${esc(r.note)}</p>` : ''}
      </div>
    </li>`;
  });
  return `<ol class="refs" ${numbered ? `start="${startAt}"` : ''}>${items.join('')}</ol>`;
}

export function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function fileTable(files, { max = 60, hrefLabel = 'GitHub' } = {}) {
  if (!files?.length) return '<p class="muted">No files.</p>';
  const rows = files.slice(0, max).map((f) => `<tr><td class="mono"><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.rel)}</a></td><td class="num">${esc(formatBytes(f.size))}</td></tr>`).join('');
  const more = files.length > max ? `<tr><td colspan="2" class="muted">… and ${files.length - max} more files in the repository</td></tr>` : '';
  return `<div class="tbl-wrap"><table class="files"><thead><tr><th scope="col">File (opens on ${esc(hrefLabel)})</th><th scope="col" class="num">Size</th></tr></thead><tbody>${rows}${more}</tbody></table></div>`;
}

export function dataTable(header, rows, { caption = '', total = rows.length } = {}) {
  const th = header.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td class="${/^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(c) ? 'num' : ''}">${esc(fmtCell(c))}</td>`).join('')}</tr>`).join('');
  const note = total > rows.length ? `<p class="muted small">Showing the first ${rows.length} of ${total} rows — download the CSV for the rest.</p>` : '';
  return `<div class="tbl-wrap">${caption ? `<p class="tbl-cap">${esc(caption)}</p>` : ''}<table class="data"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>${note}`;
}

function fmtCell(c) {
  if (/^[-+]?\d*\.\d{6,}(e[-+]?\d+)?$/i.test(c)) { const n = Number(c); return Math.abs(n) < 0.01 ? n.toExponential(3) : formatNumber(n, 4); }
  return c;
}

export { compactNumber };
