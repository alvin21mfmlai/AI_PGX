// Discover WEEKxx folders in the repository and turn each into a page model.
// Nothing here requires the author to add files beyond what the weekly
// pipeline already produces (README.md, docs/, results/<session>/...).
// An optional WEEKxx/week.json can override title, summary, date, tags and
// highlights — see site/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderMarkdown, markdownToText } from './markdown.mjs';
import { inferCharts, keyStatsFromRuns, parseCSV } from './csv.mjs';
import { parseEnv } from './env.mjs';
import { codeBlock, languageFor } from './highlight.mjs';
import {
  exists, isDir, isFile, listFiles, readJSON, readText, slugify, parseSessionStamp, uniqueBy,
  fileSize, readingTime, warn, imageSize,
} from './util.mjs';

const WEEK_DIR_RE = /^week[-_ ]?0*(\d+)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;
const COPYABLE_RE = /\.(png|jpe?g|gif|svg|webp|avif|pdf)$/i;
const CODE_RE = /\.(sh|bash|py|js|mjs|cjs|ts|json|ya?ml|toml|sql|rs|go|c|h|cpp|cu|txt|cfg|ini)$/i;
const MAX_COPY_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 120 * 1024;

export function makeRepoUrls(repo) {
  const base = `https://github.com/${repo.owner}/${repo.name}`;
  const branch = repo.branch || 'main';
  return {
    base, branch,
    tree: (rel = '') => `${base}/tree/${branch}/${encodePath(rel)}`.replace(/\/$/, ''),
    blob: (rel) => `${base}/blob/${branch}/${encodePath(rel)}`,
    raw: (rel) => `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${encodePath(rel)}`,
    commit: (sha) => `${base}/commit/${sha}`,
    any: (kind) => `${base}/${kind}`,
  };
}
const encodePath = (rel) => String(rel).split('/').map(encodeURIComponent).join('/');

export function discoverWeekDirs(repoRoot) {
  const out = [];
  for (const name of fs.readdirSync(repoRoot)) {
    const m = WEEK_DIR_RE.exec(name);
    if (!m) continue;
    const dir = path.join(repoRoot, name);
    if (!isDir(dir)) continue;
    out.push({ id: name, num: Number(m[1]), dir });
  }
  return out.sort((a, b) => a.num - b.num);
}

function gitDates(repoRoot, relDir) {
  try {
    const first = execFileSync('git', ['log', '--diff-filter=A', '--format=%cI', '--reverse', '--', relDir], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
    const last = execFileSync('git', ['log', '-1', '--format=%cI', '--', relDir], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { first: first || null, last: last || null };
  } catch { return { first: null, last: null }; }
}

function parseTitle(h1, num, label) {
  if (!h1) return { title: `${label} ${String(num).padStart(2, '0')}`, programme: '' };
  // "PGX52 — Week 01: Platform Baseline" → programme "PGX52", title "Platform Baseline"
  const m = new RegExp(`^(?:(.*?)\\s*[—–:-]\\s*)?${label}\\s*0*${num}\\s*(?:[—–:-]\\s*(.+))?$`, 'i').exec(h1.trim());
  if (m) return { programme: (m[1] || '').trim(), title: (m[2] || '').trim() || `${label} ${String(num).padStart(2, '0')}` };
  return { programme: '', title: h1.trim() };
}

function autoTags(text, rules) {
  const t = String(text).toLowerCase();
  const tags = [];
  for (const r of rules || []) if (r.match.some((m) => t.includes(String(m).toLowerCase()))) tags.push(r.tag);
  return tags.slice(0, 6);
}

/**
 * Build the model for one week folder.
 */
export function buildWeek(entry, { repoRoot, config, urls, allWeekNums }) {
  const { id, num, dir } = entry;
  const label = config.programme?.label || 'Week';
  const slug = `week${String(num).padStart(2, '0')}`;
  const relDir = path.relative(repoRoot, dir).split(path.sep).join('/');
  const meta = readJSON(path.join(dir, 'week.json')) || {};
  const files = listFiles(dir, { ignore: [/(^|\/)\.git(\/|$)/, /node_modules/] });
  const fileByRel = new Map(files.map((f) => [f.rel, f]));

  // Results sessions — directories under results/ that look like timestamps or hold a summary.md.
  const resultsDir = path.join(dir, 'results');
  let sessions = [];
  if (isDir(resultsDir)) {
    for (const name of fs.readdirSync(resultsDir)) {
      const p = path.join(resultsDir, name);
      if (!isDir(p)) continue;
      if (name === 'latest' && fs.lstatSync(p).isSymbolicLink()) continue;
      const stamp = parseSessionStamp(name);
      if (stamp || isFile(path.join(p, 'summary.md'))) sessions.push({ name, dir: p, rel: `results/${name}`, stamp });
    }
    sessions.sort((a, b) => a.name.localeCompare(b.name));
  }
  const session = sessions.length ? sessions[sessions.length - 1] : null;

  // Which assets get copied next to the page (images and small PDFs anywhere in the week folder,
  // but only from the latest session inside results/ to keep the site small).
  const assets = files.filter((f) => COPYABLE_RE.test(f.rel) && f.size <= MAX_COPY_BYTES
    && (!f.rel.startsWith('results/') || (session && f.rel.startsWith(session.rel + '/'))));
  const assetRel = new Set(assets.map((f) => f.rel));
  const dims = new Map();
  for (const a of assets) if (IMAGE_RE.test(a.rel) && !/\.svg$/i.test(a.rel)) { const d = imageSize(a.full); if (d) dims.set(`files/${a.rel}`, d); }
  // <img> tags for copied images get width/height so the page does not shift while they load.
  const sizeImages = (html) => html.replace(/<img src="(files\/[^"]+)"/g, (m, src) => { const d = dims.get(src.replace(/&amp;/g, '&')); return d ? `<img src="${src}" width="${d.width}" height="${d.height}"` : m; });

  // Markdown documents rendered on the page, keyed by their path inside the week folder.
  const docPaths = files.filter((f) => /\.md$/i.test(f.rel) && !f.rel.startsWith('results/') && f.rel.toLowerCase() !== 'readme.md').map((f) => f.rel).sort();
  const anchorFor = new Map();
  anchorFor.set('README.md', '#overview');
  for (const d of docPaths) anchorFor.set(d, `#doc-${slugify(d.replace(/\.md$/i, ''))}`);
  if (session) anchorFor.set(`${session.rel}/summary.md`, '#results');

  const resolveFrom = (baseRel) => (href, { isImage }) => {
    const [pathPart, hash = ''] = String(href).split('#');
    if (!pathPart) return null; // pure anchor
    let target = path.posix.normalize(path.posix.join(baseRel, pathPart.split('?')[0]));
    if (target.startsWith('../')) return urls.tree(path.posix.normalize(path.posix.join(relDir, target)));
    if (session) target = target.replace(/^results\/latest(\/|$)/, `${session.rel}$1`);
    const lower = target.toLowerCase();
    const key = [...anchorFor.keys()].find((k) => k.toLowerCase() === lower);
    if (key && !isImage) return anchorFor.get(key) + (hash ? '' : '');
    if (assetRel.has(target)) return `files/${target}`;
    if (fileByRel.has(target)) return isImage ? urls.raw(`${relDir}/${target}`) : urls.blob(`${relDir}/${target}`);
    if (isImage) return urls.raw(`${relDir}/${target}`); // not in this checkout — the raw URL is the best guess
    if (isDir(path.join(dir, target))) return urls.tree(`${relDir}/${target}`);
    if (target === 'results/latest.tar.gz' && session) {
      const arch = files.find((f) => /^results\/.*\.tar\.gz$/.test(f.rel) && f.rel.includes(session.name)) || files.find((f) => /^results\/.*\.tar\.gz$/.test(f.rel));
      if (arch) return urls.raw(`${relDir}/${arch.rel}`);
    }
    if (target.startsWith('results/')) return urls.tree(`${relDir}/results`);
    return urls.tree(relDir);
  };

  // README — a README that opens with a short plain line instead of a heading gets that line promoted to the title.
  let readmeSrc = readText(path.join(dir, 'README.md')) || readText(path.join(dir, 'readme.md')) || '';
  if (!/^#\s+\S/m.test(readmeSrc)) {
    const lines = readmeSrc.split('\n');
    const i = lines.findIndex((l) => l.trim());
    if (i >= 0 && lines[i].trim().length <= 90 && !/[.:]$/.test(lines[i].trim()) && !/^[-*>|`]/.test(lines[i].trim()) && (i + 1 >= lines.length || !lines[i + 1].trim())) lines[i] = `# ${lines[i].trim()}`;
    readmeSrc = lines.join('\n');
  }
  const readme = renderMarkdown(readmeSrc, { resolve: resolveFrom(''), shiftHeadings: 1, idPrefix: 'overview', dropFirstH1: true });
  const parsedTitle = parseTitle(readme.title, num, label);
  const title = meta.title || parsedTitle.title;
  const summary = meta.summary || readme.summary || (readmeSrc.trim() ? '' : 'The write-up for this week has not been published yet.') || config.site.description;

  // Docs
  const docs = docPaths.map((rel) => {
    const src = readText(path.join(dir, rel)) || '';
    const r = renderMarkdown(src, { resolve: resolveFrom(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel)), shiftHeadings: 1, idPrefix: slugify(rel), dropFirstH1: true });
    return { rel, id: anchorFor.get(rel).slice(1), title: r.title || rel.replace(/\.md$/i, ''), html: sizeImages(r.html), refs: r.refs, toc: r.toc, text: markdownToText(src) };
  });

  // Results
  let results = null;
  if (session) {
    const sFiles = files.filter((f) => f.rel.startsWith(session.rel + '/'));
    const summarySrc = readText(path.join(session.dir, 'summary.md'));
    const summaryMd = summarySrc ? renderMarkdown(summarySrc, { resolve: resolveFrom(session.rel), shiftHeadings: 2, idPrefix: 'results', dropFirstH1: true }) : null;
    const csvFiles = sFiles.filter((f) => /\.csv$/i.test(f.rel) && !f.rel.includes('/source/') && f.size <= 4 * 1024 * 1024)
      .map((f) => ({ rel: f.rel.slice(session.rel.length + 1), full: f.full, text: readText(f.full) || '' }));
    const { charts, tables } = inferCharts(csvFiles);
    const images = sFiles.filter((f) => IMAGE_RE.test(f.rel) && assetRel.has(f.rel)).map((f) => ({ rel: f.rel, src: `files/${f.rel}`, name: path.basename(f.rel), ...(dims.get(`files/${f.rel}`) || {}) }));
    const envFiles = sFiles.filter((f) => f.rel.startsWith(`${session.rel}/env/`));
    const env = parseEnv(path.join(session.dir, 'env'), envFiles, { repoFileUrl: (p) => (p.startsWith('blob/') ? urls.blob(`${relDir}/${p.slice(5)}`) : p.startsWith('commit/') ? urls.commit(p.slice(7)) : urls.tree(relDir)) });
    const runsFile = csvFiles.find((f) => /(^|\/)runs\.csv$/i.test(f.rel));
    let keyStats = [];
    if (runsFile) { const { header, rows } = parseCSV(runsFile.text); keyStats = keyStatsFromRuns(header, rows); }
    const archives = files.filter((f) => /^results\/[^/]+\.tar\.gz$/.test(f.rel)).map((f) => ({ rel: f.rel, size: f.size, url: urls.raw(`${relDir}/${f.rel}`), sha: files.find((g) => g.rel === `${f.rel}.sha256`) ? urls.raw(`${relDir}/${f.rel}.sha256`) : '' }));
    const logs = sFiles.filter((f) => f.rel.startsWith(`${session.rel}/logs/`)).map((f) => ({ rel: f.rel, size: f.size, url: urls.blob(`${relDir}/${f.rel}`) }));
    results = {
      session: session.name, sessionRel: session.rel, stamp: session.stamp, sessionsCount: sessions.length,
      url: urls.tree(`${relDir}/${session.rel}`),
      summaryHtml: sizeImages(summaryMd?.html || ''), summaryRefs: summaryMd?.refs || [],
      charts, tables: tables.map((t) => ({ ...t, url: urls.blob(`${relDir}/${session.rel}/${t.rel}`), raw: urls.raw(`${relDir}/${session.rel}/${t.rel}`) })),
      images, env, keyStats, archives, logs,
      checksums: sFiles.some((f) => /SHA256SUMS$/i.test(f.rel)) ? urls.blob(`${relDir}/${session.rel}/SHA256SUMS`) : '',
      files: sFiles.map((f) => ({ rel: f.rel.slice(session.rel.length + 1), size: f.size, url: urls.blob(`${relDir}/${f.rel}`) })),
    };
  }

  // Source code viewer: top-level runner + scripts, benchmarks, etc. (not results/, not docs).
  const sources = files.filter((f) => CODE_RE.test(f.rel) && !f.rel.startsWith('results/') && !f.rel.startsWith('docs/') && f.rel !== 'week.json' && f.size <= MAX_SOURCE_BYTES)
    .sort((a, b) => sourceRank(a.rel) - sourceRank(b.rel) || a.rel.localeCompare(b.rel))
    .slice(0, 14)
    .map((f) => {
      const code = readText(f.full) || '';
      const lang = languageFor(f.rel);
      return { rel: f.rel, lang, size: f.size, lines: code.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length, url: urls.blob(`${relDir}/${f.rel}`), html: codeBlock(code, lang, { fileName: f.rel, collapsedAfter: 40 }), text: code };
    });

  // References: every external link in the week's markdown, de-duplicated.
  const refs = uniqueBy([...readme.refs, ...docs.flatMap((d) => d.refs), ...(results?.summaryRefs || [])], (r) => r.url)
    .filter((r) => !r.url.includes(`github.com/${config.repo.owner}/${config.repo.name}`));

  // Dates
  const git = gitDates(repoRoot, relDir);
  const runDate = session?.stamp || null;
  const date = meta.date || runDate || git.first || null;
  const dateSource = meta.date ? 'stated' : runDate ? 'run' : git.first ? 'commit' : 'none';

  const allText = [readmeSrc, ...docs.map((d) => d.text)].join('\n');
  const tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags.slice(0, 6) : autoTags(allText, config.tagRules);
  const rt = readingTime(markdownToText(allText));
  const highlights = Array.isArray(meta.highlights) ? meta.highlights : (results?.keyStats || []);
  const cover = meta.cover && assetRel.has(meta.cover) ? `files/${meta.cover}` : (results?.images[0]?.src || '');
  const coverSize = dims.get(cover) || null;
  const sparkline = firstSeries(results?.charts || []);

  const folderFiles = files.filter((f) => !f.rel.startsWith('results/')).map((f) => ({ rel: f.rel, size: f.size, url: urls.blob(`${relDir}/${f.rel}`) }));
  const idx = allWeekNums.indexOf(num);

  return {
    id, num, slug, dir, relDir, label, title, programme: parsedTitle.programme, subtitle: meta.subtitle || '',
    fullTitle: readme.title || `${label} ${String(num).padStart(2, '0')}`,
    pageTitle: title === `${label} ${String(num).padStart(2, '0')}` ? title : `${label} ${String(num).padStart(2, '0')}: ${title}`,
    summary, summaryText: markdownToText(summary), tags, date, dateSource, updated: git.last, readingTime: rt,
    url: `weeks/${slug}/`, repoUrl: urls.tree(relDir),
    readme: { html: sizeImages(readme.html), toc: readme.toc, empty: !readmeSrc.trim() },
    docs, results, sources, refs, highlights, cover, coverSize, sparkline, assets, folderFiles,
    prev: idx > 0 ? allWeekNums[idx - 1] : null, next: idx < allWeekNums.length - 1 ? allWeekNums[idx + 1] : null,
    meta,
  };
}

function sourceRank(rel) {
  if (/^run[^/]*\.sh$/i.test(rel)) return 0;
  if (/^[^/]+\.sh$/i.test(rel)) return 1;
  if (/^scripts\//i.test(rel)) return 2;
  if (/^benchmarks?\//i.test(rel)) return 3;
  if (/^[^/]+\.py$/i.test(rel)) return 4;
  if (/^[^/]+$/.test(rel)) return 5;
  return 6;
}

function firstSeries(charts) {
  // Charts arrive sorted by priority (headline metrics first), so the first line chart is the story.
  const c = charts.find((ch) => ch.kind === 'line' && ch.series?.[0]?.points?.length > 2);
  if (!c) return null;
  const pts = c.series[0].points.map((p) => p[1]);
  return { values: pts, label: `${c.series[0].name} · ${c.title}`, unit: c.unit };
}

export function loadWeeks(repoRoot, config) {
  const urls = makeRepoUrls(config.repo);
  const dirs = discoverWeekDirs(repoRoot);
  if (!dirs.length) warn(`no WEEKxx folders found under ${repoRoot}`);
  const nums = dirs.map((d) => d.num);
  return dirs.map((d) => buildWeek(d, { repoRoot, config, urls, allWeekNums: nums }));
}
