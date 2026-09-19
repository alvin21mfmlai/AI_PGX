// Build-time syntax highlighting with the vendored Prism (MIT). Runs in Node,
// so the generated HTML needs no JavaScript to show highlighted code.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './util.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const comp = (name) => path.join(here, '..', '..', 'vendor', 'prismjs', 'components', `prism-${name}.min.js`);

const Prism = require(comp('core'));
// Components register themselves on the global Prism that prism-core created.
for (const lang of ['markup', 'clike', 'c', 'cpp', 'javascript', 'typescript', 'css', 'python', 'bash',
  'json', 'yaml', 'toml', 'markdown', 'docker', 'diff', 'ini', 'sql', 'rust', 'go']) {
  try { require(comp(lang)); } catch { /* optional language */ }
}

const EXT_LANG = {
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', html: 'markup',
  xml: 'markup', css: 'css', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cu: 'cpp', rs: 'rust', go: 'go',
  sql: 'sql', ini: 'ini', cfg: 'ini', diff: 'diff', patch: 'diff', dockerfile: 'docker', txt: 'text', env: 'bash', csv: 'text',
};

export function languageFor(fileName, hint) {
  if (hint) return normalizeLang(hint);
  const base = path.basename(String(fileName)).toLowerCase();
  if (base === 'dockerfile') return 'docker';
  if (base === 'makefile') return 'text';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT_LANG[ext] || 'text';
}

export function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase().trim();
  const alias = { shell: 'bash', sh: 'bash', console: 'bash', py: 'python', js: 'javascript', ts: 'typescript', yml: 'yaml',
    html: 'markup', xml: 'markup', svg: 'markup', jsonc: 'json', text: 'text', plaintext: 'text', txt: 'text', '': 'text' };
  return alias[l] || l;
}

export function highlight(code, lang) {
  const l = normalizeLang(lang);
  const grammar = Prism.languages[l];
  if (!grammar) return esc(code);
  try { return Prism.highlight(code, grammar, l); } catch { return esc(code); }
}

export function codeBlock(code, lang, { fileName = '', lines = true, collapsedAfter = 0 } = {}) {
  const l = normalizeLang(lang || 'text');
  const html = highlight(code.replace(/\r\n/g, '\n').replace(/\n$/, ''), l);
  const n = html.split('\n').length;
  const collapsible = collapsedAfter > 0 && n > collapsedAfter;
  return `<div class="code${collapsible ? ' is-collapsed' : ''}" data-lang="${esc(l)}"${collapsible ? ` data-lines="${n}"` : ''}>
  <div class="code__bar">
    <span class="code__name">${fileName ? esc(fileName) : esc(l)}</span>
    <span class="code__meta">${n} line${n === 1 ? '' : 's'}</span>
    <button class="code__copy" type="button" data-copy aria-label="Copy code">Copy</button>
  </div>
  <pre class="${lines ? 'line-numbers' : ''}"><code class="language-${esc(l)}">${html}</code></pre>
  ${collapsible ? `<button class="code__expand" type="button" data-expand aria-expanded="false">Show all ${n} lines</button>` : ''}
</div>`;
}
