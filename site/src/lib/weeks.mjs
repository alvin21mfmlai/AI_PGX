// Discover WEEKxx folders in the repository and turn each into a page model.
// Nothing here requires the author to add files beyond what a weekly pipeline
// already produces (README.md, docs/*.md, results/<session>/..., manifests/,
// exports/). An optional WEEKxx/week.json can override title, summary, date,
// tags and highlights — see site/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderMarkdown, markdownToText } from './markdown.mjs';
import { inferCharts, keyStatsFromRuns, parseTable } from './csv.mjs';
import { parseEnv } from './env.mjs';
import { panelFromJSON, keyStatsFromJSON, pickHighlights } from './jsondata.mjs';
import { codeBlock, languageFor } from './highlight.mjs';
import {
  isDir, isFile, listFiles, readJSON, readText, slugify, uniqueBy, readingTime, warn, imageSize, parseStamp,
} from './util.mjs';

const WEEK_DIR_RE = /^week[-_ ]?0*(\d+)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;
const COPYABLE_RE = /\.(png|jpe?g|gif|svg|webp|avif|pdf)$/i;
const CODE_RE = /\.(sh|bash|py|js|mjs|cjs|ts|json|ya?ml|toml|sql|rs|go|c|h|cpp|cu|txt|cfg|ini)$/i;
const DATA_RE = /\.(csv|tsv|jsonl|ndjson)$/i;
const SESSION_MARKERS = ['summary.md', 'summary.json', 'summary.csv', 'status.json', 'runs.csv', 'cases.json', 'results.json'];
const MAX_COPY_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 120 * 1024;
const MAX_DATA_BYTES = 4 * 1024 * 1024;

export function makeRepoUrls(repo) {
  const base = `https://github.com/${repo.owner}/${repo.name}`;
  const branch = repo.branch || 'main';
  return {
    base, branch,
    tree: (rel = '') => `${base}/tree/${branch}/${encodePath(rel)}`.replace(/\/$/, ''),
    blob: (rel) => `${base}/blob/${branch}/${encodePath(rel)}`,
    raw: (rel) => `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${encodePath(rel)}`,
    commit: (sha) => `${base}/commit/${sha}`,
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

// "PGX52 — Week 01: Platform Baseline" / "PGX-52 Week 2 — GPU observability" → programme + title.
function parseTitle(h1, num, label) {
  const fallback = `${label} ${String(num).padStart(2, '0')}`;
  if (!h1) return { title: fallback, programme: '' };
  const m = new RegExp(`\\b${label}\\s*0*${num}\\b`, 'i').exec(h1);
  if (!m) return { programme: '', title: h1.trim() };
  const before = h1.slice(0, m.index).replace(/[\s—–:\-|·]+$/, '').trim();
  const after = h1.slice(m.index + m[0].length).replace(/^[\s—–:\-|·]+/, '').trim();
  return { programme: before, title: after || fallback };
}

// Tags are scored by how often a rule's keywords occur, with mentions in the title / summary / opening counted
// four times over, so a playbook that merely lists future topics does not get tagged with all of them.
function autoTags({ head, body }, rules) {
  const h = String(head).toLowerCase(); const b = String(body).toLowerCase();
  const count = (hay, needle) => { if (!needle) return 0; let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };
  const scored = (rules || []).map((r, idx) => ({ tag: r.tag, idx, score: r.match.reduce((acc, m) => acc + count(h, String(m).toLowerCase()) * 4 + count(b, String(m).toLowerCase()), 0) }))
    .filter((r) => r.score >= 3)
    .sort((a, b2) => b2.score - a.score || a.idx - b2.idx);
  return scored.slice(0, 6).sort((a, b2) => a.idx - b2.idx).map((r) => r.tag); // display in the rules' (topical-first) order
}

function statusOf(dir) {
  const st = readJSON(path.join(dir, 'status.json'));
  const sm = readJSON(path.join(dir, 'summary.json'));
  const s = (st && typeof st.status === 'string' && st.status) || (sm && typeof sm.status === 'string' && sm.status) || '';
  return { status: s, complete: /complete|pass|success|ok|done/i.test(s) };
}

function countCases(dir) {
  for (const name of ['summary.csv', 'runs.csv', 'cases.csv']) {
    const t = readText(path.join(dir, name));
    if (t) return parseTable(t, name).rows.length;
  }
  const sm = readJSON(path.join(dir, 'summary.json'));
  if (sm && typeof sm === 'object') for (const v of Object.values(sm)) if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object')) return v.length;
  const cases = readJSON(path.join(dir, 'cases.json'));
  if (Array.isArray(cases)) return cases.length;
  return 0;
}

function findSessions(dir) {
  const resultsDir = path.join(dir, 'results');
  if (!isDir(resultsDir)) return [];
  const sessions = [];
  for (const name of fs.readdirSync(resultsDir)) {
    const p = path.join(resultsDir, name);
    if (!isDir(p) || fs.lstatSync(p).isSymbolicLink()) continue;
    const stamp = parseStamp(name);
    const hasMarker = SESSION_MARKERS.some((m) => isFile(path.join(p, m)));
    if (!stamp && !hasMarker) continue;
    const { status, complete } = statusOf(p);
    const profile = stamp?.profile || '';
    const cases = countCases(p);
    const score = (complete ? 100 : 0) + (profile === 'full' ? 50 : profile === '' ? 40 : /cpu|smoke|test|dry|debug/i.test(profile) ? 0 : 30) + (cases > 0 ? 10 : 0);
    sessions.push({ name, dir: p, rel: `results/${name}`, stamp: stamp?.iso || null, profile, status, complete, cases, score });
  }
  sessions.sort((a, b) => a.name.localeCompare(b.name));
  return sessions;
}

function pickManifestDir(dir, sessionStamp) {
  const mdir = path.join(dir, 'manifests');
  if (!isDir(mdir)) return null;
  const dirs = fs.readdirSync(mdir).filter((n) => isDir(path.join(mdir, n))).map((n) => ({ n, stamp: parseStamp(n)?.iso || null })).sort((a, b) => a.n.localeCompare(b.n));
  if (!dirs.length) return null;
  if (sessionStamp) {
    const before = dirs.filter((d) => d.stamp && d.stamp <= sessionStamp);
    if (before.length) return path.join(mdir, before[before.length - 1].n);
  }
  return path.join(mdir, dirs[dirs.length - 1].n);
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
  const files = listFiles(dir, { ignore: [/(^|\/)\.git(\/|$)/, /node_modules/, /(^|\/)cache\//] });
  const fileByRel = new Map(files.map((f) => [f.rel, f]));
  const repoUrl = urls.tree(relDir);
  const blob = (rel) => urls.blob(`${relDir}/${rel}`);
  const raw = (rel) => urls.raw(`${relDir}/${rel}`);

  // Results sessions and the one the page leads with.
  const sessions = findSessions(dir);
  const session = sessions.length ? [...sessions].sort((a, b) => b.score - a.score || b.name.localeCompare(a.name))[0] : null;

  // Assets copied next to the page: images and small PDFs anywhere in the week folder, but from results/ only
  // the lead session; plus that session's own HTML dashboards.
  const assets = files.filter((f) => f.size <= MAX_COPY_BYTES && (
    (COPYABLE_RE.test(f.rel) && (!f.rel.startsWith('results/') || (session && f.rel.startsWith(session.rel + '/'))))
    || (session && f.rel.startsWith(session.rel + '/') && /\.html?$/i.test(f.rel) && f.size <= 2 * 1024 * 1024)));
  const assetRel = new Set(assets.map((f) => f.rel));
  const dims = new Map();
  for (const a of assets) {
    if (!IMAGE_RE.test(a.rel)) continue;
    if (/\.svg$/i.test(a.rel)) {
      const m = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec((readText(a.full) || '').slice(0, 2000));
      if (m) dims.set(`files/${a.rel}`, { width: Math.round(Number(m[1])), height: Math.round(Number(m[2])) });
    } else { const d = imageSize(a.full); if (d) dims.set(`files/${a.rel}`, d); }
  }
  const sizeImages = (html) => html.replace(/<img src="(files\/[^"]+)"/g, (m, src) => { const d = dims.get(src.replace(/&amp;/g, '&')); return d ? `<img src="${src}" width="${d.width}" height="${d.height}"` : m; });

  // Markdown documents rendered on the page, keyed by their path inside the week folder.
  const docPaths = files.filter((f) => /\.md$/i.test(f.rel) && !f.rel.startsWith('results/') && !f.rel.startsWith('manifests/') && f.rel.toLowerCase() !== 'readme.md').map((f) => f.rel).sort();
  const anchorFor = new Map();
  anchorFor.set('README.md', '#overview');
  for (const d of docPaths) anchorFor.set(d, `#doc-${slugify(d.replace(/\.md$/i, ''))}`);
  if (session) anchorFor.set(`${session.rel}/summary.md`, '#results');

  const resolveFrom = (baseRel) => (href, { isImage }) => {
    const [pathPart] = String(href).split('#');
    if (!pathPart) return null;
    let target = path.posix.normalize(path.posix.join(baseRel, pathPart.split('?')[0]));
    if (target.startsWith('../')) return urls.tree(path.posix.normalize(path.posix.join(relDir, target)));
    if (session) target = target.replace(/^results\/(latest|<[^/]+>|\$[A-Z_]+)(\/|$)/, `${session.rel}$2`);
    const lower = target.toLowerCase();
    const key = [...anchorFor.keys()].find((k) => k.toLowerCase() === lower);
    if (key && !isImage) return anchorFor.get(key);
    if (assetRel.has(target)) return `files/${target}`;
    if (fileByRel.has(target)) return isImage ? raw(target) : blob(target);
    if (isImage) return raw(target);
    if (isDir(path.join(dir, target))) return urls.tree(`${relDir}/${target}`);
    if (/\.tar\.gz$/.test(target) && session) {
      const arch = files.find((f) => /\.tar\.gz$/.test(f.rel) && f.rel.includes(session.name)) || files.find((f) => /^(results|exports)\/.*\.tar\.gz$/.test(f.rel));
      if (arch) return raw(arch.rel);
    }
    if (target.startsWith('results/')) return urls.tree(`${relDir}/results`);
    return repoUrl;
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
  // Summary: an explicit "Objective"-style table row beats the first real paragraph; a bold-only opening line becomes the subtitle.
  const rowsOf = readme.tables.flatMap((t) => t.rows).filter((r) => r.length >= 2);
  const objective = rowsOf.find((r) => /^(objective|goal|target|aim|purpose|question)$/i.test(r[0]))?.[1];
  const hypothesis = rowsOf.find((r) => /hypothesis/i.test(r[0]))?.[1] || '';
  const firstReal = readme.paragraphs.find((p) => p.text.length >= 60 && !p.onlyStrong)?.text;
  const opening = readme.paragraphs[0];
  const subtitle = meta.subtitle || (opening && opening.onlyStrong && opening.text.length <= 140 ? opening.text : '');
  const summary = meta.summary || objective || firstReal || readme.summary || (readmeSrc.trim() ? '' : 'The write-up for this week has not been published yet.') || config.site.description;

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
    const inSession = (rel) => rel.slice(session.rel.length + 1);
    const sessionFile = (name) => sFiles.find((f) => inSession(f.rel) === name);
    const summarySrc = readText(path.join(session.dir, 'summary.md'));
    const summaryMd = summarySrc ? renderMarkdown(summarySrc, { resolve: resolveFrom(session.rel), shiftHeadings: 2, idPrefix: 'results', dropFirstH1: true }) : null;
    const summaryJson = readJSON(path.join(session.dir, 'summary.json'));
    const configJson = readJSON(path.join(session.dir, 'config.json'));
    const dataFiles = sFiles.filter((f) => DATA_RE.test(f.rel) && !/(^|\/)source\//.test(inSession(f.rel)) && f.size <= MAX_DATA_BYTES)
      .map((f) => ({ rel: inSession(f.rel), full: f.full, text: readText(f.full) || '' }));
    const { charts, tables, skipped } = inferCharts(dataFiles);
    const tableMeta = (t) => ({ ...t, url: blob(`${session.rel}/${t.rel}`), raw: raw(`${session.rel}/${t.rel}`) });
    const primaryName = ['summary.csv', 'runs.csv', 'cases.csv', 'results.csv'].find((n) => sessionFile(n));
    const primaryTable = primaryName ? tableMeta(tables.find((t) => t.rel === primaryName) || { rel: primaryName, header: [], rows: [], total: 0 }) : null;
    const images = sFiles.filter((f) => IMAGE_RE.test(f.rel) && assetRel.has(f.rel)).map((f) => ({ rel: f.rel, src: `files/${f.rel}`, name: path.basename(f.rel), ...(dims.get(`files/${f.rel}`) || {}) }));
    const dashboards = sFiles.filter((f) => /\.html?$/i.test(f.rel) && assetRel.has(f.rel)).map((f) => ({ rel: f.rel, src: `files/${f.rel}`, name: path.basename(f.rel), url: blob(f.rel) }));

    // Provenance: the session's own inventory + the closest manifests/ capture + week-level checksum files.
    const manifestDir = pickManifestDir(dir, session.stamp);
    const envFiles = [
      ...sFiles.filter((f) => /^env\//.test(inSession(f.rel)) || /^(environment|framework|host|image-lock|source-git|runtime)\.json$|^(image\.lock|source\.sha256)$/i.test(inSession(f.rel))),
      ...(manifestDir ? files.filter((f) => f.full.startsWith(manifestDir + path.sep)) : []),
      ...files.filter((f) => /^manifests\/image\.lock$/.test(f.rel)),
      ...files.filter((f) => /^(SOURCE_SHA256SUMS\.txt|SHA256SUMS)$/i.test(f.rel)),
    ];
    const env = parseEnv(uniqueBy(envFiles, (f) => f.rel), { repoFileUrl: (p) => (p.startsWith('commit:') ? urls.commit(p.slice(7)) : blob(p)) });
    const rowNoun = primaryName === 'runs.csv' ? 'runs' : 'cases';
    const runStats = primaryTable && primaryTable.header.length ? keyStatsFromRuns(primaryTable.header, tables.find((t) => t.rel === primaryName)?.rows || [], { rowNoun }) : [];
    const keyStats = pickHighlights(keyStatsFromJSON(summaryJson), runStats);
    const archives = files.filter((f) => /^(results|exports)\/[^/]+\.(tar\.gz|tgz|zip)$/.test(f.rel))
      .map((f) => ({ rel: f.rel, size: f.size, url: raw(f.rel), sha: fileByRel.has(`${f.rel}.sha256`) ? raw(`${f.rel}.sha256`) : '', forSession: f.rel.includes(session.name) }))
      .sort((a, b) => Number(b.forSession) - Number(a.forSession) || a.rel.localeCompare(b.rel));
    const logs = [
      ...sFiles.filter((f) => /^logs\//.test(inSession(f.rel))),
      ...files.filter((f) => f.rel.startsWith(`results/${session.name}`) && !f.rel.startsWith(session.rel + '/') && /\.(txt|log)$/i.test(f.rel)),
    ].map((f) => ({ rel: f.rel, name: f.rel.split('/').slice(-1)[0], size: f.size, url: blob(f.rel) }));
    results = {
      session: session.name, sessionRel: session.rel, stamp: session.stamp, profile: session.profile, status: session.status, complete: session.complete,
      sessionsCount: sessions.length, url: urls.tree(`${relDir}/${session.rel}`),
      sessions: sessions.map((s) => ({ name: s.name, stamp: s.stamp, profile: s.profile || 'default', status: s.status || '', cases: s.cases, url: urls.tree(`${relDir}/${s.rel}`), lead: s.name === session.name })),
      summaryHtml: sizeImages(summaryMd?.html || ''), summaryRefs: summaryMd?.refs || [],
      summaryPanel: summaryJson ? panelFromJSON(summaryJson) : [], summaryUrl: sessionFile('summary.json') ? blob(`${session.rel}/summary.json`) : '',
      configPanel: configJson ? panelFromJSON(configJson) : [], configUrl: sessionFile('config.json') ? blob(`${session.rel}/config.json`) : '',
      charts, skipped, tables: tables.map(tableMeta), primaryTable, images, dashboards, env, keyStats, archives, logs,
      envUrl: sFiles.some((f) => /^env\//.test(inSession(f.rel))) ? urls.tree(`${relDir}/${session.rel}/env`) : manifestDir ? urls.tree(`${relDir}/${path.relative(dir, manifestDir).split(path.sep).join('/')}`) : urls.tree(`${relDir}/${session.rel}`),
      checksums: sFiles.some((f) => /SHA256SUMS$/i.test(f.rel)) ? blob(`${session.rel}/SHA256SUMS`) : (sessionFile('source.sha256') ? blob(`${session.rel}/source.sha256`) : ''),
      files: sFiles.map((f) => ({ rel: inSession(f.rel), size: f.size, url: blob(f.rel) })),
    };
  }

  // Source code viewer: runner + scripts, configs, tests… (not results/, manifests/, exports/, docs).
  const sources = files.filter((f) => CODE_RE.test(f.rel) && !/^(results|manifests|exports|docs)\//.test(f.rel) && f.rel !== 'week.json' && f.size <= MAX_SOURCE_BYTES)
    .sort((a, b) => sourceRank(a.rel) - sourceRank(b.rel) || a.rel.localeCompare(b.rel))
    .slice(0, 16)
    .map((f) => {
      const code = readText(f.full) || '';
      const lang = languageFor(f.rel);
      return { rel: f.rel, lang, size: f.size, lines: code.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length, url: blob(f.rel), html: codeBlock(code, lang, { fileName: f.rel, collapsedAfter: 40 }), text: code };
    });

  const refs = uniqueBy([...readme.refs, ...docs.flatMap((d) => d.refs), ...(results?.summaryRefs || [])], (r) => r.url)
    .filter((r) => !r.url.includes(`github.com/${config.repo.owner}/${config.repo.name}`));

  const git = gitDates(repoRoot, relDir);
  const runDate = session?.stamp || null;
  const date = meta.date || runDate || git.first || null;
  const dateSource = meta.date ? 'stated' : runDate ? 'run' : git.first ? 'commit' : 'none';

  const allText = [readmeSrc, ...docs.map((d) => d.text)].join('\n');
  const tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags.slice(0, 6) : autoTags({ head: `${title} ${subtitle} ${summary} ${markdownToText(readmeSrc).slice(0, 1500)}`, body: allText }, config.tagRules);
  const rt = readingTime(markdownToText(allText));
  const highlights = Array.isArray(meta.highlights) ? meta.highlights : (results?.keyStats || []);
  const cover = meta.cover && assetRel.has(meta.cover) ? `files/${meta.cover}` : (results?.images[0]?.src || '');
  const coverSize = dims.get(cover) || null;
  const sparkline = firstSeries(results?.charts || []);
  const folderFiles = files.filter((f) => !f.rel.startsWith('results/')).map((f) => ({ rel: f.rel, size: f.size, url: blob(f.rel) }));
  const idx = allWeekNums.indexOf(num);
  const pageTitle = title === `${label} ${String(num).padStart(2, '0')}` ? title : `${label} ${String(num).padStart(2, '0')}: ${title}`;

  return {
    id, num, slug, dir, relDir, label, title, pageTitle, programme: parsedTitle.programme, subtitle, hypothesis,
    fullTitle: readme.title || `${label} ${String(num).padStart(2, '0')}`,
    summary, summaryText: markdownToText(summary), tags, date, dateSource, updated: git.last, readingTime: rt,
    url: `weeks/${slug}/`, repoUrl,
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
  if (/^configs?\//i.test(rel)) return 4;
  if (/^tests?\//i.test(rel)) return 5;
  if (/^[^/]+\.py$/i.test(rel)) return 6;
  if (/^[^/]+$/.test(rel)) return 7;
  return 8;
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
