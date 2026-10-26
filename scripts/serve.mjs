#!/usr/bin/env node
/**
 * serve.mjs — server statis kecil untuk pengembangan lokal.
 *
 * GitHub Pages melayani repo apa adanya; server ini menirunya supaya
 * jalur relatif yang sama berlaku di kedua tempat.
 *
 *   node scripts/serve.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    else {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n  PFL Klasemen — http://localhost:${PORT}\n`);
});
