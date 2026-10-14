import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { familyApi } from './api';

/**
 * The app and its family, behind the reverse proxy: the built page from
 * dist/, and family.md read — and written — live from DATA_DIR. Nothing here
 * checks passwords; the proxy in front does, and passes on who logged in.
 *
 *   DATA_DIR               the folder with family.md and photos/  (./data)
 *   PORT, HOST             where to listen                        (8080, 127.0.0.1)
 *   STAMMBAUM_USER_HEADER  the header naming the login            (Remote-User)
 *   STAMMBAUM_EDITORS      logins that may edit, comma-separated  (everyone)
 *   STAMMBAUM_READONLY=1   nobody may edit
 */
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const staticDir = path.resolve(process.env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';
const userHeader = (process.env.STAMMBAUM_USER_HEADER ?? 'remote-user').toLowerCase();
const editors = (process.env.STAMMBAUM_EDITORS ?? '')
  .split(',')
  .map((login) => login.trim().toLowerCase())
  .filter(Boolean);

const api = familyApi({
  dataDir,
  user: (request) => {
    const value = request.headers[userHeader];
    const login = (Array.isArray(value) ? value[0] : value)?.trim();
    return login || undefined;
  },
  editors,
  writable: process.env.STAMMBAUM_READONLY !== '1',
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.end();
    return;
  }
  const { pathname } = new URL(request.url ?? '/', 'http://local');
  const wanted = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = path.resolve(staticDir, `.${wanted}`);
  const inside = file.startsWith(staticDir + path.sep);
  const found = inside ? await stat(file).then((s) => s.isFile(), () => false) : false;
  if (!found) {
    response.statusCode = 404;
    response.end('not found');
    return;
  }
  response.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  // Built assets carry a hash in their name; the page itself must be fresh.
  response.setHeader('Cache-Control', wanted.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

createServer((request, response) => {
  api(request, response, () => {
    serveStatic(request, response).catch((error) => {
      console.error(error);
      response.statusCode = 500;
      response.end();
    });
  });
}).listen(port, host, () => {
  const who = editors.length > 0 ? editors.join(', ') : 'everyone logged in';
  console.log(`Stammbaum on http://${host}:${port} — family from ${dataDir}, editing: ${who}`);
});
