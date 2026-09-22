// Markdown → HTML with the vendored marked (MIT), plus the site's own touches:
// unique heading ids + table of contents, link/image resolution through a
// callback, Prism-highlighted code blocks, responsive table wrappers and a
// collected list of external references.
import { Marked } from '../../vendor/marked/marked.esm.js';
import { highlight, normalizeLang } from './highlight.mjs';
import { esc, slugify } from './util.mjs';

const isExternal = (href) => /^(https?:)?\/\//i.test(href) || /^mailto:/i.test(href);
const isAnchor = (href) => String(href).startsWith('#');

/**
 * Render markdown.
 * @param {string} src
 * @param {object} opts
 * @param {(href:string, ctx:{isImage:boolean}) => string|null} [opts.resolve]  map relative hrefs; return null to keep
 * @param {number} [opts.shiftHeadings]  add to every heading level (e.g. 1 turns H1 into H2)
 * @param {string} [opts.idPrefix]  prefix for heading ids
 * @param {boolean} [opts.dropFirstH1]  omit the first H1 (when the page already shows the title)
 */
export function renderMarkdown(src, opts = {}) {
  const { resolve = () => null, shiftHeadings = 0, idPrefix = '', dropFirstH1 = false } = opts;
  const toc = [];
  const refs = [];
  const images = [];
  const paragraphs = [];
  const tables = [];
  const ids = new Map();
  let firstH1 = null;
  let firstParagraph = null;
  let droppedH1 = false;

  const uniqueId = (base) => {
    let id = (idPrefix ? `${idPrefix}-` : '') + base;
    const n = ids.get(id) || 0;
    ids.set(id, n + 1);
    return n ? `${id}-${n + 1}` : id;
  };

  const md = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens, this.parser.textRenderer).trim();
        if (depth === 1 && firstH1 == null) {
          firstH1 = text;
          if (dropFirstH1 && !droppedH1) { droppedH1 = true; return ''; }
        }
        const level = Math.min(6, depth + shiftHeadings);
        const id = uniqueId(slugify(text));
        toc.push({ level, text, id });
        const inner = this.parser.parseInline(tokens);
        return `<h${level} id="${esc(id)}" class="md-h"><a class="md-anchor" href="#${esc(id)}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${level}>\n`;
      },
      paragraph({ tokens }) {
        const html = this.parser.parseInline(tokens);
        const text = this.parser.parseInline(tokens, this.parser.textRenderer).trim();
        if (firstParagraph == null) firstParagraph = text;
        paragraphs.push({ text, onlyStrong: tokens.filter((t) => t.type !== 'space' && !(t.type === 'text' && !t.text.trim())).every((t) => t.type === 'strong') });
        return `<p>${html}</p>\n`;
      },
      code({ text, lang }) {
        const l = normalizeLang((lang || '').split(/\s+/)[0]);
        const html = highlight(text, l);
        return `<div class="code code--md" data-lang="${esc(l)}"><div class="code__bar"><span class="code__name">${esc(l || 'text')}</span><button class="code__copy" type="button" data-copy aria-label="Copy code">Copy</button></div><pre tabindex="0"><code class="language-${esc(l)}">${html}</code></pre></div>\n`;
      },
      table(token) {
        tables.push({ header: token.header.map((c) => this.parser.parseInline(c.tokens, this.parser.textRenderer).trim()), rows: token.rows.map((r) => r.map((c) => this.parser.parseInline(c.tokens, this.parser.textRenderer).trim())) });
        let head = '';
        for (const cell of token.header) head += this.tablecell(cell);
        let body = '';
        for (const row of token.rows) {
          let cells = '';
          for (const cell of row) cells += this.tablecell(cell);
          body += `<tr>\n${cells}</tr>\n`;
        }
        return `<div class="tbl-wrap" tabindex="0" role="group" aria-label="Table (scrolls horizontally)"><table>\n<thead>\n<tr>\n${head}</tr>\n</thead>\n${body ? `<tbody>${body}</tbody>` : ''}</table></div>\n`;
      },
      tablecell(cell) {
        const content = this.parser.parseInline(cell.tokens);
        const tag = cell.header ? 'th' : 'td';
        const style = cell.align ? ` style="text-align:${cell.align}"` : '';
        return `<${tag}${style}${cell.header ? ' scope="col"' : ''}>${content}</${tag}>\n`;
      },
      link({ href, title, tokens, text, autolink }) {
        const inner = autolink ? esc(text) : this.parser.parseInline(tokens);
        const plain = autolink ? text : this.parser.parseInline(tokens, this.parser.textRenderer);
        let h = href;
        let external = isExternal(h);
        if (!external && !isAnchor(h)) {
          const r = resolve(h, { isImage: false });
          if (r) { h = r; external = isExternal(h); }
        }
        if (external) refs.push({ text: plain.trim(), url: h });
        const t = title ? ` title="${esc(title)}"` : '';
        const ext = external ? ' class="ext" target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${esc(h)}"${t}${ext}>${inner}</a>`;
      },
      image({ href, title, text }) {
        let h = href;
        if (!isExternal(h)) { const r = resolve(h, { isImage: true }); if (r) h = r; }
        images.push({ src: h, alt: text || '' });
        const cap = title || text;
        return `<figure class="md-fig"><img src="${esc(h)}" alt="${esc(text || '')}" loading="lazy" decoding="async">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
      },
    },
  });

  const html = md.parse(src || '');
  return { html, toc, refs, images, paragraphs, tables, title: firstH1, summary: firstParagraph };
}

// Convert markdown to plain text (for meta descriptions and search snippets).
export function markdownToText(src) {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
