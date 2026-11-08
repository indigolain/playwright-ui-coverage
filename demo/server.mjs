// Tiny static server for the demo app (no dependencies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const port = Number(process.env.PORT || 4173);

const routes = [
  [/^\/$/, 'index.html'],
  [/^\/users\/?$/, 'users.html'],
  [/^\/users\/\d+\/?$/, 'user.html'],
  [/^\/settings\/?$/, 'settings.html'],
];

http
  .createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const match = routes.find(([re]) => re.test(pathname));
    const file = match ? match[1] : pathname.slice(1);
    const full = path.join(root, path.normalize(file));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const type = full.endsWith('.css') ? 'text/css' : full.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    fs.createReadStream(full).pipe(res);
  })
  .listen(port, () => console.log(`demo app on http://localhost:${port}`));
