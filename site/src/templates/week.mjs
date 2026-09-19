// One page per WEEKxx folder.
import { esc, formatDate, formatBytes, formatNumber } from '../lib/util.mjs';
import { icon, statTile, tagList, refList, fileTable, dataTable } from './partials.mjs';

const jsonForScript = (obj) => JSON.stringify(obj).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

export function weekPage({ config, week: w, weeks }) {
  const num = String(w.num).padStart(2, '0');
  const r = w.results;
  const prev = w.prev != null ? weeks.find((x) => x.num === w.prev) : null;
  const next = w.next != null ? weeks.find((x) => x.num === w.next) : null;
  const sections = [
    { id: 'overview', label: 'Overview', show: true },
    ...w.docs.map((d) => ({ id: d.id, label: shortDocLabel(d), show: true })),
    { id: 'results', label: 'Results', show: !!r },
    { id: 'environment', label: 'Environment', show: !!(r && r.env.items.length) },
    { id: 'code', label: 'Code', show: w.sources.length > 0 },
    { id: 'files', label: 'Files', show: true },
    { id: 'references', label: 'References', show: true },
  ].filter((s) => s.show);

  const archive = r?.archives?.[0];
  const hero = `
<header class="whero">
  <div class="hero__bg hero__bg--week" aria-hidden="true"><span class="orb orb--a"></span><span class="orb orb--b"></span><span class="grid"></span></div>
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../../">Home</a><span>/</span><a href="../../#weeks">Weeks</a><span>/</span><span aria-current="page">${esc(w.label)} ${num}</span></nav>
    <p class="eyebrow rv"><span class="wnum wnum--hero">${esc(w.label)} ${num}</span>${w.date ? `<span class="dot"></span><time datetime="${esc(w.date)}">${w.dateSource === 'run' ? 'Run on ' : 'Published '}${esc(formatDate(w.date, { long: true }))}</time>` : ''}<span class="dot"></span><span>${w.readingTime.minutes} min read</span></p>
    <h1 class="whero__title rv"><span class="grad">${esc(w.title)}</span></h1>
    ${w.subtitle ? `<p class="whero__sub rv">${esc(w.subtitle)}</p>` : ''}
    <p class="whero__lede rv">${esc(w.summaryText)}</p>
    <div class="rv">${tagList(w.tags)}</div>
    ${w.highlights?.length ? `<div class="stats stats--row rv">${w.highlights.slice(0, 4).map((h) => statTile(h, { size: 'md' })).join('')}</div>` : ''}
    <div class="hero__cta rv">
      <a class="btn btn--primary" href="${esc(w.repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github')} Folder on GitHub</a>
      ${r ? `<a class="btn btn--ghost" href="#results">See the results ${icon('arrow')}</a>` : ''}
      ${archive ? `<a class="btn btn--ghost" href="${esc(archive.url)}">${icon('download')} Result archive (${esc(formatBytes(archive.size))})</a>` : ''}
    </div>
  </div>
</header>
<nav class="subnav" aria-label="On this page"><div class="wrap subnav__inner">${sections.map((s) => `<a href="#${esc(s.id)}">${esc(s.label)}</a>`).join('')}</div></nav>`;

  const overview = `
<section class="wsec" id="overview" aria-labelledby="overview-h">
  <div class="wsec__head"><h2 id="overview-h">Overview</h2><a class="src" href="${esc(w.repoUrl)}/README.md" target="_blank" rel="noopener noreferrer">README.md on GitHub ${icon('link')}</a></div>
  <div class="md">${w.readme.empty ? '<p class="muted">This week has no README yet.</p>' : w.readme.html}</div>
</section>`;

  const docs = w.docs.map((d) => `
<section class="wsec" id="${esc(d.id)}" aria-labelledby="${esc(d.id)}-h">
  <div class="wsec__head"><h2 id="${esc(d.id)}-h">${esc(d.title)}</h2><a class="src" href="${esc(w.repoUrl)}/${esc(d.rel)}" target="_blank" rel="noopener noreferrer">${esc(d.rel)} ${icon('link')}</a></div>
  <div class="md">${d.html}</div>
</section>`).join('');

  let results = '';
  if (r) {
    const referenced = new Set([...r.summaryHtml.matchAll(/src="([^"]+)"/g)].map((m) => m[1]));
    const extraImages = r.images.filter((im) => !referenced.has(im.src));
    const chartedFiles = new Set(r.charts.flatMap((c) => c.files));
    const otherTables = r.tables.filter((t) => !chartedFiles.has(t.rel));
    results = `
<section class="wsec" id="results" aria-labelledby="results-h">
  <div class="wsec__head"><h2 id="results-h">Results</h2><a class="src" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Session folder ${icon('link')}</a></div>
  <div class="session">
    <div><span class="session__k">Session</span><code>${esc(r.session)}</code></div>
    ${r.stamp ? `<div><span class="session__k">Captured</span><time datetime="${esc(r.stamp)}">${esc(formatDate(r.stamp, { long: true }))} UTC</time></div>` : ''}
    ${r.sessionsCount > 1 ? `<div><span class="session__k">Sessions in repo</span>${r.sessionsCount} (latest shown)</div>` : ''}
    ${r.checksums ? `<div><span class="session__k">Integrity</span><a href="${esc(r.checksums)}" target="_blank" rel="noopener noreferrer">SHA256SUMS</a></div>` : ''}
    ${archive ? `<div><span class="session__k">Archive</span><a href="${esc(archive.url)}">${icon('download')} ${esc(archive.rel.split('/').pop())}</a>${archive.sha ? ` · <a href="${esc(archive.sha)}">.sha256</a>` : ''}</div>` : ''}
  </div>
  ${r.summaryHtml ? `<div class="md md--summary">${r.summaryHtml}</div>` : ''}
  ${r.charts.length ? `<h3 class="wsub">Interactive charts <span class="muted small">drawn from the CSV files in the session — hover or focus for exact values</span></h3>
  <div class="charts">${r.charts.map((c) => chartCard(c, r)).join('')}</div>` : ''}
  ${extraImages.length ? `<h3 class="wsub">Figures</h3><div class="gallery">${extraImages.map((im) => `<figure class="md-fig"><a href="${esc(im.src)}" target="_blank" rel="noopener"><img src="${esc(im.src)}" alt="${esc(im.name)}"${im.width ? ` width="${im.width}" height="${im.height}"` : ''} loading="lazy" decoding="async"></a><figcaption>${esc(im.rel.split('/').slice(-1)[0])}</figcaption></figure>`).join('')}</div>` : ''}
  ${otherTables.length ? `<h3 class="wsub">Other data files</h3>${otherTables.map((t) => `<details class="disc"><summary>${esc(t.rel)} <span class="muted">(${t.total} rows)</span></summary>${dataTable(t.header, t.rows, { total: t.total })}<p class="small"><a href="${esc(t.raw)}">${icon('download')} Download CSV</a> · <a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">View on GitHub</a></p></details>`).join('')}` : ''}
</section>`;
  }

  let environment = '';
  if (r && r.env.items.length) {
    const groups = [...new Set(r.env.items.map((i) => i.group))];
    environment = `
<section class="wsec" id="environment" aria-labelledby="env-h">
  <div class="wsec__head"><h2 id="env-h">Environment &amp; provenance</h2><a class="src" href="${esc(r.url)}/env" target="_blank" rel="noopener noreferrer">env/ on GitHub ${icon('link')}</a></div>
  <p class="muted">Captured automatically with the run, so anyone can see exactly which driver, container and host produced these numbers.</p>
  <div class="envgrid">
    ${groups.map((g) => `<div class="envcard rv"><h3>${esc(g)}</h3><dl>${r.env.items.filter((i) => i.group === g).map((i) => `<div><dt>${esc(i.label)}</dt><dd class="${i.mono ? 'mono' : ''}${i.truncate ? ' trunc' : ''}" ${i.truncate ? `title="${esc(i.value)}"` : ''}>${i.href ? `<a href="${esc(i.href)}" target="_blank" rel="noopener noreferrer">${esc(i.hrefLabel || i.value)}</a>` : esc(i.value)}</dd></div>`).join('')}</dl></div>`).join('')}
  </div>
  ${r.logs.length ? `<details class="disc"><summary>Run logs (${r.logs.length})</summary>${fileTable(r.logs.map((l) => ({ rel: l.rel.split('/').slice(-1)[0], size: l.size, url: l.url })))}</details>` : ''}
</section>`;
  }

  let code = '';
  if (w.sources.length) {
    code = `
<section class="wsec" id="code" aria-labelledby="code-h">
  <div class="wsec__head"><h2 id="code-h">Source code</h2><a class="src" href="${esc(w.repoUrl)}" target="_blank" rel="noopener noreferrer">Browse on GitHub ${icon('link')}</a></div>
  <p class="muted">The exact scripts in the week folder. Use the tabs to switch files; every block has a copy button.</p>
  <div class="tabs" data-tabs>
    <div class="tabs__list" role="tablist" aria-label="Source files">
      ${w.sources.map((s, i) => `<button class="tab" role="tab" type="button" id="tab-${i}" aria-controls="panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(s.rel)}<span class="tab__meta">${s.lines} lines</span></button>`).join('')}
    </div>
    ${w.sources.map((s, i) => `<div class="tabpanel" role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}" ${i ? 'hidden' : ''}>${s.html}<p class="small"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">View ${esc(s.rel)} on GitHub</a> · ${esc(formatBytes(s.size))}</p></div>`).join('')}
  </div>
  <noscript><style>.tabpanel[hidden]{display:block}</style></noscript>
</section>`;
  }

  const files = `
<section class="wsec" id="files" aria-labelledby="files-h">
  <div class="wsec__head"><h2 id="files-h">Files</h2><a class="src" href="${esc(w.repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(w.relDir)}/ on GitHub ${icon('link')}</a></div>
  <h3 class="wsub">Week folder</h3>
  ${fileTable(w.folderFiles)}
  ${r ? `<details class="disc"><summary>Latest results session (${r.files.length} files)</summary>${fileTable(r.files, { max: 80 })}</details>` : ''}
</section>`;

  const canon = [
    { title: `${w.relDir}/ — this week's folder in the repository`, url: w.repoUrl, publisher: 'GitHub' },
    r ? { title: `Results session ${r.session}`, url: r.url, publisher: 'GitHub' } : null,
    archive ? { title: 'Complete result archive (.tar.gz)', url: archive.url, publisher: 'GitHub raw download' } : null,
  ].filter(Boolean);
  const references = `
<section class="wsec" id="references" aria-labelledby="refs-h">
  <div class="wsec__head"><h2 id="refs-h">References &amp; links</h2></div>
  ${w.refs.length ? `<h3 class="wsub">Cited in this week's write-up</h3>${refList(w.refs.map((x) => ({ title: x.text || x.url, url: x.url })), { numbered: true, idPrefix: `w${num}-ref` })}` : '<p class="muted">No external links in this week\'s write-up.</p>'}
  <h3 class="wsub">Canonical sources</h3>
  ${refList(canon, { numbered: false })}
  <p class="muted small">Hardware specifications and manufacturer sources are listed on the <a href="../../#references">home page</a>.</p>
</section>`;

  const aside = `
<aside class="week__aside" aria-label="Page navigation">
  <div class="aside__box">
    <p class="aside__h">On this page</p>
    <ol class="aside__toc">${sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.label)}</a></li>`).join('')}</ol>
  </div>
  <div class="aside__box">
    <p class="aside__h">Run it yourself</p>
    <p class="small muted">Clone the repository on a ThinkStation PGX (or another GB10 machine), enter <code>${esc(w.relDir)}/</code> and run the runner script. Results land in <code>results/</code>.</p>
    <a class="btn btn--ghost btn--sm" href="${esc(w.repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github')} Open the folder</a>
  </div>
  ${(prev || next) ? `<div class="aside__box aside__nav">${prev ? `<a href="../${esc(prev.slug)}/">← ${esc(prev.label)} ${String(prev.num).padStart(2, '0')}<span>${esc(prev.title)}</span></a>` : ''}${next ? `<a href="../${esc(next.slug)}/">${esc(next.label)} ${String(next.num).padStart(2, '0')} →<span>${esc(next.title)}</span></a>` : ''}</div>` : ''}
</aside>`;

  const pager = `
<nav class="pager wrap" aria-label="Previous and next weeks">
  ${prev ? `<a class="pager__a" href="../${esc(prev.slug)}/"><span class="pager__k">← Previous</span><span class="pager__t">${esc(prev.label)} ${String(prev.num).padStart(2, '0')} · ${esc(prev.title)}</span></a>` : '<span></span>'}
  <a class="pager__a pager__a--home" href="../../#weeks"><span class="pager__k">All weeks</span><span class="pager__t">Back to the log</span></a>
  ${next ? `<a class="pager__a pager__a--r" href="../${esc(next.slug)}/"><span class="pager__k">Next →</span><span class="pager__t">${esc(next.label)} ${String(next.num).padStart(2, '0')} · ${esc(next.title)}</span></a>` : `<span class="pager__a pager__a--r pager__a--soon"><span class="pager__k">Next →</span><span class="pager__t">${esc(w.label)} ${String(w.num + 1).padStart(2, '0')} lands next week</span></span>`}
</nav>`;

  return `<article class="week">${hero}<div class="wrap week__grid"><div class="week__main">${overview}${docs}${results}${environment}${code}${files}${references}</div>${aside}</div>${pager}</article>`;
}

function shortDocLabel(d) {
  const t = String(d.title || d.rel);
  if (/experiment/i.test(t)) return 'Details';
  return t.length > 18 ? d.rel.replace(/^docs\//, '').replace(/\.md$/, '') : t;
}

function chartCard(c, r) {
  const t = r.tables.find((x) => x.rel === c.file);
  const table = chartTable(c);
  const meta = [`${c.series.length} series${c.extra ? ` (+${c.extra} not drawn)` : ''}`, c.unit ? `unit: ${c.unit}` : null, c.kind === 'line' ? 'line chart' : 'bar chart'].filter(Boolean).join(' · ');
  const stats = c.kind === 'line' && c.stats && c.stats.length > 1 ? `<table class="chart-stats" aria-label="Series summary"><thead><tr><th scope="col">Series</th><th scope="col" class="num">Median</th><th scope="col" class="num">Min</th><th scope="col" class="num">Max</th></tr></thead><tbody>${c.stats.map((s, i) => `<tr><td><span class="key" style="--c:var(--s${i + 1})"></span> ${esc(s.name)}</td><td class="num">${esc(fmtStat(s.median))}</td><td class="num">${esc(fmtStat(s.min))}</td><td class="num">${esc(fmtStat(s.max))}</td></tr>`).join('')}</tbody></table>` : '';
  return `<figure class="chart-card rv" id="${esc(c.id)}">
  <figcaption class="chart-head"><h4>${esc(c.title)}</h4><p class="chart-sub">${esc(meta)} · from <code>${esc(c.file)}</code></p></figcaption>
  <div class="chart" data-chart tabindex="0" role="img" aria-label="${esc(c.title)}. ${esc(meta)}. Use the table view below for exact values."><script type="application/json">${jsonForScript(c)}</script><noscript><p class="muted small">Enable JavaScript for the interactive chart, or use the table view below.</p></noscript></div>
  ${stats}
  <div class="chart-foot">
    <details class="disc disc--sm"><summary>Table view</summary>${table}</details>
    <div class="chart-links">${t ? `<a href="${esc(t.raw)}">${icon('download')} CSV</a><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ''}</div>
  </div>
</figure>`;
}

function chartTable(c) {
  if (c.kind === 'bar') {
    const header = [c.xLabel, ...c.series.map((s) => s.name + (c.unit ? ` (${c.unit})` : ''))];
    const rows = c.x.values.map((x, i) => [String(x), ...c.series.map((s) => fmt(s.values[i]))]);
    return dataTable(header, rows);
  }
  const xs = [...new Set(c.series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b).slice(0, 200);
  const header = [c.xLabel, ...c.series.map((s) => s.name + (c.unit ? ` (${c.unit})` : ''))];
  const rows = xs.map((x) => [c.xType === 'time' ? new Date(x).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z') : String(x), ...c.series.map((s) => { const p = s.points.find((q) => q[0] === x); return p ? fmt(p[1]) : ''; })]);
  return dataTable(header, rows);
}
const fmt = (v) => (v == null ? '' : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6))));
const fmtStat = (v) => {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : null;
  if (d == null) return String(Number(v.toPrecision(3)));
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
