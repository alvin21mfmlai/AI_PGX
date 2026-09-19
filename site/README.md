# PGX_AI_Adventures — the site generator

This folder turns the `WEEKxx/` folders of the **AI_PGX** repository into a public website:
a landing page (hero, latest experiment, the weekly log, roadmap, the machine, method,
about, references) plus one page per week with the rendered write-up, interactive charts
drawn from the CSV results, an environment/provenance panel, a syntax-highlighted source
viewer, file listings and per-week references. It also emits an RSS feed (`feed.xml`), a
machine-readable index (`weeks.json`), `sitemap.xml`, `robots.txt` and a 404 page.

There is **nothing to install**: the generator is plain Node.js (18 or newer) and the two
libraries it uses — [marked](https://github.com/markedjs/marked) and
[Prism](https://prismjs.com/) — are vendored under `site/vendor/` (both MIT).

```
AI_PGX/
├── vercel.json            ← tells Vercel how to build and where the output is
├── WEEK01/ WEEK02/ …      ← your experiments (unchanged)
└── site/
    ├── build.mjs          ← the generator:  node site/build.mjs
    ├── serve.mjs          ← local preview:  node site/serve.mjs
    ├── site.config.json   ← everything editable: name, tagline, author, hardware, roadmap, references
    ├── src/               ← templates, CSS, JS (charts.js, site.js), favicon, OG image
    ├── vendor/            ← marked + Prism (MIT)
    ├── extras/            ← optional GitHub Pages workflow and week.json example
    └── dist/              ← generated output (git-ignored)
```

## Deploying on Vercel (once)

1. Commit `vercel.json` and the `site/` folder to the `main` branch of `AI_PGX` and push.
2. In Vercel, **Add New… → Project**, import `alvin21mfmlai/AI_PGX`.
3. Leave the **Root Directory** as the repository root. Vercel reads `vercel.json`, which sets
   the framework preset to *Other*, skips the install step, runs `node site/build.mjs` and
   serves `site/dist`. Nothing needs to be typed into the dashboard.
4. Click **Deploy**. The first build takes about ten seconds.

From then on **every push to `main` rebuilds the site**, so publishing a new week is just
pushing the `WEEKnn/` folder as you already do. Preview deployments are created for other
branches and pull requests automatically.

Absolute URLs (Open Graph image, sitemap, RSS links) are derived from Vercel's
`VERCEL_PROJECT_PRODUCTION_URL` system variable, which is exposed to builds by default. If
you add a custom domain later, either leave it (Vercel reports the shortest production
domain) or set a `SITE_URL` environment variable such as `https://pgx.example.com` in the
project settings; `site.url` in `site.config.json` works too.

## The weekly workflow

Push a folder named `WEEK02`, `WEEK03`, … (`week-3`, `Week_03` and similar also work). The
build discovers it and, from the files that are already produced by your pipeline, derives:

| Page element | Taken from |
|---|---|
| Title | the first `# Heading` of `README.md` — "PGX52 — Week 01: Platform Baseline" becomes *Platform Baseline* |
| Summary (cards, meta description, RSS) | the first paragraph of `README.md` |
| Overview section | the rest of `README.md`, rendered (links to files in the folder are resolved to GitHub or to the page) |
| Details sections | every `docs/*.md` |
| Date | the newest `results/<timestamp>/` session; falls back to the folder's first commit date, or `week.json` |
| Results section | `results/<latest session>/summary.md`, every image in that session, and a chart for every CSV that can be drawn |
| Interactive charts | CSVs with a `trial`/`step`/`epoch`/timestamp column become line charts (files that differ only by `runNN` are overlaid as series); small tables keyed by a name become bar charts; everything else gets a table view |
| Highlights (cards, hero) | `results/<session>/runs.csv`: number of rows, `*_pass` booleans, the median of any `median_*` column |
| Environment & provenance | `results/<session>/env/` — `gpu.txt`, `framework.json`, `os.txt`, `host.json`, `cpu.txt`, `memory.txt`, `storage.txt`, `docker.txt`, `runtime.txt`, `image-lock.json`, `source-git.json` |
| Source code viewer | `*.sh`, `*.py`, `*.json`, `*.yaml`, `*.toml` … in the folder (not under `results/`) |
| Tags | matched against `tagRules` in `site.config.json` |
| References | every external link in the week's markdown, plus canonical links to the folder, the session and the archive |

Images and small PDFs are copied next to the page so the write-up renders offline from GitHub;
everything else (CSV, logs, archives) links to GitHub or `raw.githubusercontent.com`.

### Optional overrides: `WEEKnn/week.json`

If you ever want to override what is derived — a nicer title, a hand-picked cover image,
custom highlight numbers, tags — drop a `week.json` in the week folder. See
`extras/week.json.example`; every key is optional.

## Previewing locally

```bash
node site/build.mjs        # writes site/dist
node site/serve.mjs        # http://localhost:4173
```

`node site/build.mjs --repo /path/to/AI_PGX --out /tmp/out --url https://example.com` are all
accepted when you need them. Opening `site/dist/index.html` straight from disk also works
(all links are relative), although the charts need to be served over HTTP in some browsers.

## Customising

Everything on the landing page that is not derived from the week folders lives in
`site/site.config.json`:

- `site` — name, tagline, description, theme colour, optional `url`.
- `repo` — owner, repository name and branch used for every GitHub link.
- `programme` — the "Week" label, the total (52), the cadence sentence and the roadmap items
  (`status`: `done`, `active` or `planned`; `week` links a done item to its week number).
- `author` — name, role, location, bio and links (a link with an empty `url` is hidden — fill in
  LinkedIn and Google Scholar when you want them shown).
- `machine` — headline numbers, the specification rows and the note under them. Each row cites
  one or more `references` ids; the citation numbers are generated.
- `method` — the five "how each week works" steps.
- `references` — the numbered sources on the landing page. Add an entry and cite its `id` from
  a spec row.
- `tagRules` — keyword → tag mapping used to auto-tag weeks.

Design tokens (colours, fonts, radii) are at the top of `site/src/assets/site.css`; the chart
palette (`--s1` … `--s6`) was validated for colour-vision safety against the card surface and
is mirrored in `site/src/assets/charts.js`.

## GitHub Pages instead of Vercel

Copy `site/extras/github-pages.yml` to `.github/workflows/pages.yml`, set the repository's
Pages source to *GitHub Actions* and push. The workflow builds with the correct sub-path URL.

## Troubleshooting

- **A week is missing** — the folder name must match `WEEK` + number, and the build only
  reads the `main` branch that Vercel deploys.
- **No charts for a CSV** — a CSV needs at least two rows and one numeric column that varies.
  Constant columns (like a seed) are skipped on purpose; the table view is always available.
- **Dates look wrong** — the date comes from the results session timestamp. Add
  `"date": "YYYY-MM-DD"` to `week.json` to pin it.
- **Build log** — the build prints the folders it found and the number of files written; run it
  locally with the same command Vercel uses to reproduce any failure.
