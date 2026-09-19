// The landing page.
import { esc, formatDate } from '../lib/util.mjs';
import { icon, statTile, weekCard, placeholderCard, refList, tagList } from './partials.mjs';

export function homePage({ config, weeks, refIndex }) {
  const site = config.site;
  const prog = config.programme;
  const latest = weeks[weeks.length - 1];
  const total = prog.totalWeeks || 52;
  const done = weeks.length;
  const pct = Math.min(100, Math.round((done / total) * 100));
  const machine = config.machine;
  const refNum = (id) => (Array.isArray(id) ? id : [id]).map((x) => refIndex.get(x)).filter(Boolean);
  const cite = (id) => { const ns = refNum(id); return ns.length ? `<sup class="cite">${ns.map((n) => `<a href="#ref-${esc(refId(config, n))}" aria-label="Reference ${n}">[${n}]</a>`).join('')}</sup>` : ''; };

  const hero = `
<section class="hero" aria-labelledby="hero-title">
  <div class="hero__bg" aria-hidden="true"><span class="orb orb--a"></span><span class="orb orb--b"></span><span class="orb orb--c"></span><span class="grid"></span></div>
  <div class="wrap hero__inner">
    <div class="hero__copy">
      <p class="eyebrow rv">${icon('spark')} Weekly AI prototyping · ${esc(prog.label)} 01 → ${String(total).padStart(2, '0')}</p>
      <h1 class="hero__title rv" id="hero-title"><span class="grad">${esc(site.name).replace(/_/g, '_<wbr>')}</span></h1>
      <p class="hero__lede rv">${esc(site.tagline)}</p>
      <p class="hero__sub rv">${esc(site.description)}</p>
      <div class="hero__cta rv">
        <a class="btn btn--primary" href="#weeks">Explore the weeks ${icon('arrow')}</a>
        ${latest ? `<a class="btn btn--ghost" href="${esc(latest.url)}">Latest: ${esc(latest.label)} ${String(latest.num).padStart(2, '0')} — ${esc(latest.title)}</a>` : ''}
      </div>
      <ul class="hero__stats rv" aria-label="At a glance">
        <li>${statTile({ label: `${done === 1 ? 'week' : 'weeks'} published`, value: done, numeric: true })}</li>
        ${latest?.date ? `<li>${statTile({ label: 'latest run', value: formatDate(latest.date) })}</li>` : ''}
        ${machine.headline.slice(0, 2).map((h) => `<li>${statTile({ label: h.label, value: h.value, unit: h.unit, numeric: Number.isFinite(Number(h.value)) })}</li>`).join('')}
      </ul>
    </div>
    <div class="hero__art rv" aria-hidden="true">${chipArt()}</div>
  </div>
</section>`;

  const latestSection = latest ? `
<section class="section section--latest" id="latest" aria-labelledby="latest-title">
  <div class="wrap">
    <p class="eyebrow">Latest experiment</p>
    <div class="feature rv">
      <div class="feature__body">
        <div class="feature__top"><span class="wnum">${esc(latest.label)} ${String(latest.num).padStart(2, '0')}</span>${latest.date ? `<time datetime="${esc(latest.date)}">${latest.dateSource === 'run' ? 'Run ' : ''}${esc(formatDate(latest.date))}</time>` : ''}</div>
        <h2 class="feature__title" id="latest-title"><a href="${esc(latest.url)}">${esc(latest.title)}</a></h2>
        <p class="feature__summary">${esc(latest.summaryText)}</p>
        ${tagList(latest.tags)}
        ${latest.highlights?.length ? `<div class="stats stats--row">${latest.highlights.slice(0, 4).map((h) => statTile(h, { size: 'sm' })).join('')}</div>` : ''}
        <div class="feature__cta"><a class="btn btn--primary" href="${esc(latest.url)}">Read the full write-up ${icon('arrow')}</a><a class="btn btn--ghost" href="${esc(latest.repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github')} Folder on GitHub</a></div>
      </div>
      ${latest.cover ? `<a class="feature__media" href="${esc(latest.url)}#results" aria-label="Open results of ${esc(latest.title)}"><img src="${esc(latest.url + latest.cover)}" alt="Result chart from ${esc(latest.label)} ${String(latest.num).padStart(2, '0')}"${latest.coverSize ? ` width="${latest.coverSize.width}" height="${latest.coverSize.height}"` : ''} loading="lazy" decoding="async"></a>` : ''}
    </div>
  </div>
</section>` : '';

  const weeksSection = `
<section class="section" id="weeks" aria-labelledby="weeks-title">
  <div class="wrap">
    <div class="section__head">
      <div>
        <p class="eyebrow">The log</p>
        <h2 id="weeks-title">Every week, one experiment</h2>
        <p class="lede">${esc(prog.cadence)} The site rebuilds itself from the repository, so a new folder is a new page — write-up, charts, provenance and code included.</p>
      </div>
      <div class="progress" role="group" aria-label="Programme progress">
        <div class="progress__label"><strong>${done}</strong> of ${total} weeks</div>
        <div class="progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${done} of ${total} weeks published"><span style="width:${pct}%"></span></div>
      </div>
    </div>
    <div class="wgrid">
      ${[...weeks].reverse().map((w) => weekCard(w)).join('\n')}
      ${done < total ? placeholderCard(latest ? latest.num + 1 : 1, prog.label) : ''}
    </div>
  </div>
</section>`;

  const roadmap = `
<section class="section section--alt" id="roadmap" aria-labelledby="roadmap-title">
  <div class="wrap">
    <p class="eyebrow">Where this is going</p>
    <h2 id="roadmap-title">Roadmap</h2>
    <p class="lede">${esc(prog.roadmapIntro)}</p>
    <ol class="road">
      ${(prog.roadmap || []).map((r, i) => `<li class="road__item road__item--${esc(r.status || 'planned')} rv" style="--i:${i}">
        <span class="road__dot" aria-hidden="true"></span>
        <div class="road__body">
          <div class="road__head"><h3>${esc(r.title)}</h3><span class="pill pill--${esc(r.status || 'planned')}">${r.status === 'done' ? `${icon('check')} ${r.week ? `${esc(prog.label)} ${String(r.week).padStart(2, '0')}` : 'done'}` : r.status === 'active' ? 'in progress' : 'planned'}</span></div>
          <p>${esc(r.blurb)}</p>
        </div>
      </li>`).join('')}
    </ol>
  </div>
</section>`;

  const groups = [...new Set(machine.specs.map((s) => s.group))];
  const machineSection = `
<section class="section" id="machine" aria-labelledby="machine-title">
  <div class="wrap">
    <p class="eyebrow">The machine</p>
    <h2 id="machine-title">${esc(machine.name)}</h2>
    <p class="lede">${esc(machine.intro)}</p>
    <div class="stats stats--hero rv">
      ${machine.headline.map((h) => statTile({ label: h.label, value: h.value, unit: h.unit, numeric: Number.isFinite(Number(h.value)), citeHtml: cite(h.ref) }, { size: 'lg' })).join('')}
    </div>
    <div class="machine">
      <figure class="machine__art rv">${socArt()}<figcaption>How the GB10 is laid out: two Arm CPU clusters and a Blackwell GPU share one pool of memory, so the model that fits in memory is the model the GPU can run.</figcaption></figure>
      <div class="machine__specs rv">
        ${groups.map((g) => `<div class="spec-group"><h3>${esc(g)}</h3><dl class="specs">${machine.specs.filter((s) => s.group === g).map((s) => `<div class="spec"><dt>${esc(s.label)}</dt><dd>${esc(s.value)}${cite(s.ref)}</dd></div>`).join('')}</dl></div>`).join('')}
      </div>
    </div>
    <p class="note note--info">${icon('warn')} <span>${esc(machine.note)}</span></p>
  </div>
</section>`;

  const method = `
<section class="section section--alt" id="method" aria-labelledby="method-title">
  <div class="wrap">
    <p class="eyebrow">How each week works</p>
    <h2 id="method-title">Reproducible by design</h2>
    <p class="lede">${esc(config.method.intro)}</p>
    <ol class="steps">
      ${config.method.steps.map((s, i) => `<li class="step rv" style="--i:${i}"><span class="step__n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3><p>${esc(s.blurb)}</p></li>`).join('')}
    </ol>
  </div>
</section>`;

  const a = config.author;
  const links = (a.links || []).filter((l) => l.url);
  const about = `
<section class="section" id="about" aria-labelledby="about-title">
  <div class="wrap about rv">
    <div class="about__card">
      <p class="eyebrow">About the author</p>
      <h2 id="about-title">${esc(a.name)}</h2>
      <p class="about__role">${esc(a.role)}${a.location ? ` · ${esc(a.location)}` : ''}</p>
      <p>${esc(a.bio)}</p>
      ${links.length ? `<div class="about__links">${links.map((l) => `<a class="btn btn--ghost btn--sm" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${icon(l.icon || 'link')}<span>${esc(l.label)}</span></a>`).join('')}</div>` : ''}
    </div>
    <div class="about__aside">
      <h3>Follow along</h3>
      <p class="muted">New weeks are announced in the repository and in the <a href="feed.xml">RSS feed</a>. Everything is open: clone the folder, run the script on your own PGX, and compare numbers.</p>
      <a class="btn btn--primary" href="https://github.com/${esc(config.repo.owner)}/${esc(config.repo.name)}" target="_blank" rel="noopener noreferrer">${icon('github')} Star or watch the repo</a>
    </div>
  </div>
</section>`;

  const references = `
<section class="section section--alt" id="references" aria-labelledby="refs-title">
  <div class="wrap">
    <p class="eyebrow">Sources</p>
    <h2 id="refs-title">References</h2>
    <p class="lede">Hardware figures on this page are taken from the sources below and cited inline. Each week's page lists its own sources at the end.</p>
    ${refList(config.references, { numbered: true, idPrefix: 'ref' })}
  </div>
</section>`;

  return hero + latestSection + weeksSection + roadmap + machineSection + method + about + references;
}

function refId(config, n) { return config.references[n - 1]?.id || n; }

// Decorative "chip" illustration for the hero: a stylised die with pulsing lanes.
function chipArt() {
  const lanes = [];
  for (let i = 0; i < 12; i++) {
    const y = 26 + i * 24;
    lanes.push(`<line class="lane" x1="0" y1="${y}" x2="70" y2="${y}" style="--d:${(i * 0.35).toFixed(2)}s"/>`);
    lanes.push(`<line class="lane" x1="330" y1="${y}" x2="400" y2="${y}" style="--d:${(i * 0.35 + 0.2).toFixed(2)}s"/>`);
  }
  const cells = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) cells.push(`<rect class="cell" x="${112 + c * 22}" y="${96 + r * 22}" width="18" height="18" rx="3" style="--d:${((r * 8 + c) * 0.045).toFixed(2)}s"/>`);
  return `<svg class="chip" viewBox="0 0 400 330" role="img" aria-label="Illustration of a GPU superchip with data lanes">
  <defs>
    <linearGradient id="cg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#4ff09a"/><stop offset=".5" stop-color="#3fd8ff"/><stop offset="1" stop-color="#b98cff"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#3fd8ff" stop-opacity=".35"/><stop offset="1" stop-color="#3fd8ff" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="200" cy="165" r="190" fill="url(#glow)"/>
  <g class="lanes" stroke="url(#cg)" stroke-width="2" stroke-linecap="round">${lanes.join('')}</g>
  <rect x="70" y="20" width="260" height="290" rx="26" class="chip__pkg"/>
  <rect x="96" y="46" width="208" height="238" rx="18" class="chip__die"/>
  <text x="200" y="76" class="chip__label" text-anchor="middle">GB10 · GRACE BLACKWELL</text>
  <g class="cells">${cells.join('')}</g>
  <rect x="112" y="234" width="176" height="30" rx="8" class="chip__mem"/>
  <text x="200" y="254" class="chip__memlabel" text-anchor="middle">128 GB UNIFIED MEMORY</text>
</svg>`;
}

// System-on-chip layout diagram for "The machine".
function socArt() {
  const x925 = []; const a725 = []; const sms = [];
  for (let i = 0; i < 10; i++) { x925.push(`<rect x="${46 + i * 24}" y="82" width="18" height="18" rx="4" class="soc__core soc__core--x"/>`); a725.push(`<rect x="${46 + i * 24}" y="108" width="18" height="12" rx="3" class="soc__core soc__core--a"/>`); }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) sms.push(`<rect x="${386 + c * 20}" y="${78 + r * 19}" width="15" height="15" rx="3" class="soc__sm"/>`);
  return `<svg class="soc" viewBox="0 0 660 320" role="img" aria-label="Diagram of the GB10 superchip: a 20-core Arm CPU and a 48-SM Blackwell GPU connected by NVLink-C2C to 128 GB of unified LPDDR5x memory">
  <rect x="12" y="12" width="636" height="296" rx="22" class="soc__pkg"/>
  <text x="330" y="40" class="soc__title" text-anchor="middle">NVIDIA GB10 Grace Blackwell Superchip</text>
  <rect x="36" y="56" width="256" height="100" rx="12" class="soc__block"/>
  <text x="46" y="74" class="soc__h">CPU · 20 Arm v9.2 cores</text>
  ${x925.join('')}${a725.join('')}
  <text x="46" y="142" class="soc__s">10× Cortex-X925 · 10× Cortex-A725</text>
  <rect x="376" y="56" width="248" height="100" rx="12" class="soc__block"/>
  <text x="386" y="74" class="soc__h">GPU · Blackwell · 48 SMs</text>
  ${sms.join('')}
  <path d="M292 116 H376" class="soc__link"/>
  <text x="334" y="108" class="soc__tiny" text-anchor="middle">NVLink-C2C</text>
  <path d="M164 156 V184 M500 156 V184" class="soc__link"/>
  <rect x="36" y="184" width="588" height="56" rx="12" class="soc__mem"/>
  <text x="330" y="208" class="soc__h" text-anchor="middle">128 GB LPDDR5x unified memory · one coherent pool</text>
  <text x="330" y="228" class="soc__s" text-anchor="middle">256-bit interface · 273 GB/s · about 120 GB visible to the OS</text>
  <text x="330" y="270" class="soc__tiny" text-anchor="middle">1 PFLOP FP4 (with sparsity) · 240 W USB-C · 150 × 150 × 50.5 mm · DGX OS</text>
  <text x="330" y="292" class="soc__tiny" text-anchor="middle">ConnectX-7 200 Gb/s · 10 GbE · Wi-Fi 7 · up to 4 TB NVMe</text>
</svg>`;
}
