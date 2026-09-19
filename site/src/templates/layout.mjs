// The page shell: <head>, sticky navigation and footer.
import { esc } from '../lib/util.mjs';
import { icon } from './partials.mjs';

export function layout({ config, title, description, path: pagePath = '', depth = 0, body, pageClass = '', jsonLd = null, buildInfo }) {
  const base = depth > 0 ? '../'.repeat(depth) : './';
  const site = config.site;
  const absolute = (p) => (site.url ? `${site.url.replace(/\/$/, '')}/${String(p).replace(/^\.?\//, '')}` : '');
  const fullTitle = title === site.name ? `${site.name} — ${site.tagline}` : `${title} · ${site.name}`;
  const canonical = absolute(pagePath);
  const og = absolute('assets/og.png');
  const repoUrl = `https://github.com/${config.repo.owner}/${config.repo.name}`;
  return `<!DOCTYPE html>
<html lang="${esc(site.language || 'en')}" data-theme="dark" class="no-js">
<head>
<meta charset="utf-8">
<script>document.documentElement.classList.remove('no-js')</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="${esc(site.themeColor || '#06080d')}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="${pagePath ? 'article' : 'website'}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || site.description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${og ? `<meta property="og:image" content="${esc(og)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description || site.description)}">
${og ? `<meta name="twitter:image" content="${esc(og)}">` : ''}
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${base}assets/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)} — new weeks" href="${base}feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="${base}assets/site.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="${esc(pageClass)}">
<a class="skip" href="#main">Skip to content</a>
<header class="nav" id="top">
  <div class="nav__inner">
    <a class="brand" href="${base}" aria-label="${esc(site.name)} home">
      <span class="brand__mark" aria-hidden="true">${icon('chip', 'brand__ico')}</span>
      <span class="brand__name">${esc(site.name)}</span>
    </a>
    <button class="nav__toggle" type="button" aria-expanded="false" aria-controls="navlinks" aria-label="Menu"><span></span><span></span><span></span></button>
    <nav class="nav__links" id="navlinks" aria-label="Site">
      <a href="${base}#weeks">Weeks</a>
      <a href="${base}#roadmap">Roadmap</a>
      <a href="${base}#machine">The machine</a>
      <a href="${base}#method">Method</a>
      <a href="${base}#about">About</a>
      <a href="${base}#references">References</a>
      <a class="btn btn--ghost btn--sm" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github')}<span>GitHub</span></a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap footer__inner">
    <div>
      <div class="brand brand--footer">${icon('chip', 'brand__ico')}<span class="brand__name">${esc(site.name)}</span></div>
      <p class="muted">${esc(site.tagline)}</p>
      <p class="muted small">Built from <a href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(config.repo.owner)}/${esc(config.repo.name)}</a>${buildInfo?.commit ? ` at <code>${esc(buildInfo.commit.slice(0, 7))}</code>` : ''} on ${esc(buildInfo?.date || '')}. Manufacturer names and product names are the property of their respective owners; this is an independent, personal project.</p>
    </div>
    <div class="footer__links">
      <a href="${base}#weeks">All weeks</a>
      <a href="${base}feed.xml">${icon('rss')} RSS feed</a>
      <a href="${base}weeks.json">weeks.json</a>
      <a href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github')} Repository</a>
      <a href="#top">Back to top ↑</a>
    </div>
  </div>
</footer>
<div id="tip" class="tip" role="status" aria-live="polite" hidden></div>
<script src="${base}assets/charts.js" defer></script>
<script src="${base}assets/site.js" defer></script>
</body>
</html>
`;
}
