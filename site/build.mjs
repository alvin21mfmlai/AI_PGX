#!/usr/bin/env node
// PGX_AI_Adventures — static site generator.
//
//   node site/build.mjs                 build from the repository this folder lives in
//   node site/build.mjs --repo <path>   build from another checkout of AI_PGX
//   node site/build.mjs --out <dir>     write somewhere other than site/dist
//   node site/build.mjs --url https://example.vercel.app   absolute URLs for feed/sitemap/OG tags
//
// Zero dependencies: everything it needs is in site/src and site/vendor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadWeeks } from './src/lib/weeks.mjs';
import { layout } from './src/templates/layout.mjs';
import { homePage } from './src/templates/home.mjs';
import { weekPage } from './src/templates/week.mjs';
import { esc, ensureDir, rmDir, writeFile, copyFile, listFiles, readJSON, log, warn, formatDate } from './src/lib/util.mjs';

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };

const repoRoot = path.resolve(flag('--repo', path.join(siteDir, '..')));
const outDir = path.resolve(flag('--out', path.join(siteDir, 'dist')));
const config = readJSON(path.join(siteDir, 'site.config.json'));
if (!config) { console.error('site.config.json is missing or invalid'); process.exit(1); }
const urlOverride = flag('--url', process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''));
if (urlOverride) config.site.url = urlOverride;
config.site.url = (config.site.url || '').replace(/\/$/, '');

const started = Date.now();
log(`repository: ${repoRoot}`);
log(`output:     ${outDir}`);

const weeks = loadWeeks(repoRoot, config);
log(`found ${weeks.length} week folder${weeks.length === 1 ? '' : 's'}: ${weeks.map((w) => w.id).join(', ') || '(none)'}`);

let commit = '';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a git checkout */ }
if (!commit && process.env.VERCEL_GIT_COMMIT_SHA) commit = process.env.VERCEL_GIT_COMMIT_SHA;
const buildInfo = { commit, date: formatDate(new Date().toISOString(), { long: true }), iso: new Date().toISOString() };

rmDir(outDir);
ensureDir(outDir);

// Static assets
const assetsSrc = path.join(siteDir, 'src', 'assets');
for (const f of listFiles(assetsSrc)) copyFile(f.full, path.join(outDir, 'assets', f.rel));

// Reference numbering (home page citations)
const refIndex = new Map((config.references || []).map((r, i) => [r.id, i + 1]));

// Home
const home = layout({
  config, title: config.site.name, description: config.site.description, path: '', depth: 0, buildInfo, pageClass: 'page-home',
  body: homePage({ config, weeks, refIndex }),
  jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: config.site.name, description: config.site.description, url: config.site.url || undefined, author: { '@type': 'Person', name: config.author.name } },
});
writeFile(path.join(outDir, 'index.html'), home);

// Weeks
for (const w of weeks) {
  const dir = path.join(outDir, 'weeks', w.slug);
  const html = layout({
    config, title: w.pageTitle, description: w.summaryText.slice(0, 300), path: w.url, depth: 2, buildInfo, pageClass: 'page-week',
    body: weekPage({ config, week: w, weeks }),
    jsonLd: { '@context': 'https://schema.org', '@type': 'TechArticle', headline: w.pageTitle, description: w.summaryText, datePublished: w.date || undefined, dateModified: w.updated || undefined, author: { '@type': 'Person', name: config.author.name }, url: config.site.url ? `${config.site.url}/${w.url}` : undefined, keywords: w.tags.join(', ') },
  });
  writeFile(path.join(dir, 'index.html'), html);
  for (const a of w.assets) copyFile(a.full, path.join(dir, 'files', a.rel));
}

// Machine-readable index of weeks
const weeksJson = weeks.map((w) => ({
  id: w.id, number: w.num, slug: w.slug, title: w.title, summary: w.summaryText, date: w.date, updated: w.updated, tags: w.tags,
  url: config.site.url ? `${config.site.url}/${w.url}` : w.url, repo: w.repoUrl,
  highlights: (w.highlights || []).map((h) => ({ label: h.label, value: h.value, unit: h.unit || '' })),
  results: w.results ? { session: w.results.session, captured: w.results.stamp, charts: w.results.charts.length, archive: w.results.archives[0]?.url || null } : null,
}));
writeFile(path.join(outDir, 'weeks.json'), JSON.stringify({ site: config.site.name, generated: buildInfo.iso, repository: `https://github.com/${config.repo.owner}/${config.repo.name}`, weeks: weeksJson }, null, 2));

// RSS
const linkFor = (w) => (config.site.url ? `${config.site.url}/${w.url}` : w.repoUrl);
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(config.site.name)}</title>
<link>${esc(config.site.url || `https://github.com/${config.repo.owner}/${config.repo.name}`)}</link>
<description>${esc(config.site.description)}</description>
<language>${esc(config.site.language || 'en')}</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${config.site.url ? `<atom:link href="${esc(config.site.url)}/feed.xml" rel="self" type="application/rss+xml"/>` : ''}
${[...weeks].reverse().map((w) => `<item>
<title>${esc(w.pageTitle)}</title>
<link>${esc(linkFor(w))}</link>
<guid isPermaLink="false">${esc(`${config.repo.owner}/${config.repo.name}/${w.id}`)}</guid>
${w.date ? `<pubDate>${new Date(w.date).toUTCString()}</pubDate>` : ''}
<description>${esc(w.summaryText)}</description>
${w.tags.map((t) => `<category>${esc(t)}</category>`).join('')}
</item>`).join('\n')}
</channel>
</rss>
`;
writeFile(path.join(outDir, 'feed.xml'), rss);

// Sitemap + robots
if (config.site.url) {
  const urls = ['', ...weeks.map((w) => w.url)];
  writeFile(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(`${config.site.url}/${u}`)}</loc><lastmod>${buildInfo.iso.slice(0, 10)}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${config.site.url}/sitemap.xml\n`);
} else {
  writeFile(path.join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
}

// 404
writeFile(path.join(outDir, '404.html'), layout({
  config, title: 'Page not found', description: 'That page does not exist.', path: '404.html', depth: 0, buildInfo, pageClass: 'page-404',
  body: `<section class="section"><div class="wrap notfound"><p class="eyebrow">404</p><h1 class="grad">Nothing on this lane.</h1><p class="lede">The page you asked for is not part of the site. Weekly pages live under <code>weeks/weekNN/</code>.</p><a class="btn btn--primary" href="${esc(config.site.url ? `${config.site.url}/` : '/')}">Back to the log</a></div></section>`,
}));

const files = listFiles(outDir);
const bytes = files.reduce((a, f) => a + f.size, 0);
log(`wrote ${files.length} files (${(bytes / 1024).toFixed(0)} KB) in ${Date.now() - started} ms`);
if (!weeks.length) warn('no weeks were rendered — the home page will show an empty log');
