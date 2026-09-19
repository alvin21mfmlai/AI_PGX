#!/usr/bin/env node
// Tiny static server for previewing site/dist locally:  node site/serve.mjs  (then open http://localhost:4173)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.argv[2] || 'dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv' };

if (!fs.existsSync(root)) { console.error(`Nothing to serve at ${root} — run "node site/build.mjs" first.`); process.exit(1); }

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { res.writeHead(308, { Location: p + '/' }); return res.end(); }
  if (!fs.existsSync(file)) { file = path.join(root, '404.html'); res.statusCode = 404; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/`));
