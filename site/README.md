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
build discovers it and, from the files that are already produced by your pipeline, derives
(each row lists the layouts seen so far — Week 01 CSV + `env/`, Week 02 JSON Lines + stamped
`manifests/`, Week 03 `runs/` + llama-bench JSON + flat `manifests/` — new ones degrade gracefully):

| Page element | Taken from |
|---|---|
| Title | the first `# Heading` of `README.md` — "PGX52 — Week 01: Platform Baseline" becomes *Platform Baseline* |
| Summary (cards, meta description, RSS) | the first paragraph of `README.md` |
| Overview section | the rest of `README.md`, rendered (links to files in the folder are resolved to GitHub or to the page) |
| Details sections | every other `*.md` in the folder or under `docs/` — `START_HERE.md`-style guides first, `LICENSING.md` last |
| Subtitle / hypothesis | a bold opening line under the title becomes the subtitle; a table row labelled *Objective* becomes the summary and one labelled *…hypothesis* becomes a callout in the header |
| Date | the lead results session's timestamp; falls back to the folder's first commit date, or `week.json` |
| Results session | every `results/<timestamp>[-profile]/` or `runs/<timestamp>[-id]/` folder is a run (`20260911T133621.601983Z`, `20260922T073443…Z-full` and `20261001T073959-2504c497` all work; `output/`, `sessions/` and `experiments/` are accepted too). The page leads with the most complete one — `status.json` or `summary.json` says *complete* (`"complete": true` counts), a `full` profile beats `cpu`/`smoke`, then the newest — and lists all the others |
| Results section | `summary.md` rendered, or `summary.json`, `config.json` and `checkin.json` shown as key/value panels (nested one-level objects such as `{"cpu": true, "gpu": false}` become rows); a `summary.json` block whose children share a shape — `"modes": {"cpu": {…}, "gpu": {…}}` — becomes a side-by-side comparison table; `summary.csv` / `runs.csv` / `cases.csv` shown as the results table; every image (PNG/SVG) in the session; any `dashboard.html` the run produced, hosted as-is |
| Interactive charts | CSV, TSV, JSON Lines and JSON files holding an array of objects (llama-bench output, a case list). Files in one folder with the same columns become one chart with a series per file (`p1-on-blocks.jsonl`, `p1-off-blocks.jsonl`, … or `…-run01.csv`, `…-run02.csv`); numbered single-object files (`quality-cpu-00.json` … `quality-cpu-12.json`, five or more) become one table per family with a row per file. `trial`/`step`/`epoch`/`case`/timestamp columns are the x-axis; absolute clocks (`mono_start`, `unix_s`) become *elapsed seconds* so cases overlay; a text column with a few repeated values (`mode`, `test`) splits a file into one line per value; numeric sample arrays inside JSON rows (`samples_ts`) are drawn per trial; long-format tables keyed by two text columns (`mode,test,median_tokens_s`) become grouped bar charts; a packed column like `"41, 0, 3.66"` is expanded into one column per value (name them in `week.json`, see below). Series whose magnitudes differ by more than 20× get separate axes rather than a flat line. At most ten charts, headline metrics (TFLOP/s, tokens/s, power, energy…) first; the rest keep a table view |
| Highlights (cards, hero) | `summary.json` (case count, `median_*`/`*_percent`/`*_speedup` numbers, `*_met`/`*_pass`/`hypothesis_*` booleans — also nested per mode, shown as `1/2` — and `status`/`complete`) and the results table (row count, median of any `median_*` column, pass columns; for a long-format table the peak value and where it occurred) |
| Environment & provenance | Week 01 style `results/<session>/env/*`, Week 02 style `results/<session>/environment.json` + `manifests/<timestamp>/` (`host.txt`, `container.txt`, `nvidia-smi*.txt`, `image.lock`), and Week 03 style flat `manifests/` (`host-<timestamp>.txt`, `gpu-gate.txt`, `nvcc-version.txt`, `llama-*-version.txt`, `llama-commit.txt`, `model-files.json`, `binary-*-sha256.txt`) plus `locks.json` pins (source tag/commit, model repository, revision, SHA-256, CUDA architecture) and `source-hashes.json` / `SOURCE_SHA256SUMS.txt`. Build logs, CMake caches, help texts and anything over 512 KB are skipped. GPU UUIDs, serial numbers and hostnames are never copied onto the page, and `/home/<user>/…` paths found in result files are shortened to `~/…` before rendering |
| Archives | `results/*.tar.gz`, `runs/*.tar.gz` and `exports/*.tar.gz` (with `.sha256` companions), the lead session's first |
| Source code viewer | `*.sh`, `*.py`, `*.cu`, `*.json`, `*.yaml`, `*.toml`, `*.txt` … in the folder (not under `results/`/`runs/`, `manifests/` or `exports/`; backup copies such as `week03.py.backup-…` are skipped) |
| Tags | scored against `tagRules` in `site.config.json` (mentions in the title and opening count four times over, so a playbook that merely lists future topics is not tagged with all of them) |
| References | every external link in the week's markdown, plus canonical links to the folder, the session and the archive |

Images and small PDFs are copied next to the page so the write-up renders offline from GitHub;
everything else (CSV, logs, archives) links to GitHub or `raw.githubusercontent.com`.

### Optional overrides: `WEEKnn/week.json`

If you ever want to override what is derived — a nicer title, a hand-picked cover image,
custom highlight numbers, tags, the date — drop a `week.json` in the week folder. See
`extras/week.json.example`; every key is optional.

The one key that is worth setting routinely is `columns`, which names the values of a
packed telemetry column so the charts get real labels and units:

```json
{ "columns": { "telemetry.jsonl": { "gpu_csv": ["gpu_temp_c", "gpu_util_pct", "gpu_power_w"] } } }
```

(`nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,power.draw` writes exactly that
triple; the `_c`, `_pct` and `_w` suffixes become °C, % and W.) Without it the columns are
called `gpu_csv_1`, `gpu_csv_2`, … and still charted.

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
- `programme` — the "Week" label, the total (52), the cadence sentence and the roadmap items.
  Give an item a `week` number and it turns green and links to that week's page automatically
  the moment the folder exists; until then it shows as *planned · Week NN*.
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
- **No charts for a data file** — a CSV/JSONL needs at least three rows (two for a bar chart) and
  one numeric column that varies. Constant columns (like a seed), id-like columns, token counts and
  time-stamp columns are skipped on purpose; the table view is always available. A JSON file is
  only treated as data when it holds an array of objects.
- **A results folder is git-ignored** — Week 03's `.gitignore` lists `runs/` and `manifests/`, so
  the published subset has to be added with `git add -f WEEK03/runs WEEK03/manifests` (or change
  the patterns to `runs/*` and `manifests/*` and un-ignore the published run with `!runs/<id>/`).
  Check the files for home-directory paths and hostnames before pushing; the generator shortens
  `/home/<user>/…` to `~/…` on the page, but the raw files on GitHub are what you committed.
- **The wrong run is shown** — the lead run is the most complete one, not the newest. Rename a
  profile (`…Z-full`) or add `status.json` with `{"status": "complete"}` to steer it.
- **Dates look wrong** — the date comes from the results session timestamp. Add
  `"date": "YYYY-MM-DD"` to `week.json` to pin it.
- **Build log** — the build prints the folders it found and the number of files written; run it
  locally with the same command Vercel uses to reproduce any failure.
