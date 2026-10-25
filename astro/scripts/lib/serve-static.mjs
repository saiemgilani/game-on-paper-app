// The static server lighthouse-compare.mjs points Lighthouse at: each route's saved HTML,
// looked up by path plus query string, and the build's client files for everything else.
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { pageKey } from './browser.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
export function serveStatic(tree, pages, port) {
  const client = existsSync(join(tree.astro, 'dist', 'client')) ? join(tree.astro, 'dist', 'client') : join(tree.astro, 'dist');
  const html = new Map(Object.entries(pages).map(([route, p]) => [pageKey(route), p.file]));
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = html.get(pageKey(req.url));
    let type = TYPES['.html'];
    if (!file) {
      const candidate = resolve(client, `.${path}`);
      if (candidate.startsWith(client + sep) && existsSync(candidate) && statSync(candidate).isFile()) {
        file = candidate;
        type = TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream';
      }
    }
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = readFileSync(file);
    const headers = { 'Content-Type': type };
    if (path.startsWith('/_astro/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    if (/^(text\/|application\/(json|xml)|image\/svg)/.test(type)) {
      body = gzipSync(body, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
