import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, familyApi, parseAddress, sendFile } from './api';

/**
 * The app and its family, behind the reverse proxy: the built page from
 * dist/, and family.md read — and written — live from DATA_DIR. Nothing here
 * checks passwords; the proxy in front does, and passes on who logged in.
 *
 *   DATA_DIR                the folder with family.md and photos/  (./data)
 *   PORT, HOST              where to listen                        (8080, 127.0.0.1)
 *   STAMMBAUM_USER_HEADER   the header naming the login            (Remote-User)
 *   STAMMBAUM_EDITORS       logins that may edit, comma-separated  (everyone)
 *   STAMMBAUM_READONLY=1    nobody may edit
 *   STAMMBAUM_PROXY_SECRET  if set, only requests whose X-Stammbaum-Proxy
 *                           header carries it are answered        (unset)
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
// Compared as hashes, so the comparison takes as long whatever was sent.
const proxySecret = process.env.STAMMBAUM_PROXY_SECRET ? digest(process.env.STAMMBAUM_PROXY_SECRET) : undefined;

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

/**
 * What the page may load and run: only its own files. Styles may be inline —
 * the flag font arrives as a <style>, and the views set positions on elements —
 * and pictures may be data: and blob: URLs, which saving the tree draws with.
 */
const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

/** Whether the request came through the proxy — always, unless STAMMBAUM_PROXY_SECRET says how to tell. */
function fromProxy(request: IncomingMessage): boolean {
  if (!proxySecret) return true;
  const value = request.headers['x-stammbaum-proxy'];
  return typeof value === 'string' && timingSafeEqual(digest(value), proxySecret);
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.end();
    return;
  }
  const pathname = parseAddress(request.url)?.pathname;
  const wanted = pathname === '/' ? '/index.html' : pathname && decode(pathname);
  if (!wanted) {
    response.statusCode = 400;
    response.end('bad address');
    return;
  }
  const file = path.resolve(staticDir, `.${wanted}`);
  if (!file.startsWith(staticDir + path.sep)) {
    response.statusCode = 404;
    response.end('not found');
    return;
  }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  await sendFile(request, response, file, {
    'Content-Type': type,
    // Built assets carry a hash in their name; the page itself must be fresh.
    'Cache-Control': wanted.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_POLICY } : {}),
  });
}

// Exported for the tests, to close it again.
export const server = createServer((request, response) => {
  const fail = (error: unknown) => {
    console.error(error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.end();
    }
  };
  try {
    // For docker's health check: says the server is up, and nothing about the family.
    if (request.url === '/healthz') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('ok');
      return;
    }
    response.setHeader('Referrer-Policy', 'same-origin');
    if (!fromProxy(request)) {
      response.statusCode = 403;
      response.end('not through the proxy');
      return;
    }
    api(request, response, () => serveStatic(request, response).catch(fail));
  } catch (error) {
    fail(error);
  }
}).listen(port, host, () => {
  const who = editors.length > 0 ? editors.join(', ') : 'everyone logged in';
  console.log(`Stammbaum on http://${host}:${(server.address() as AddressInfo).port} — family from ${dataDir}, editing: ${who}`);
});

// `docker stop` and Ctrl-C: no new requests, and the saves under way are
// written to the end before the server goes.
let stopping = false;
function stop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: stopping once the last save is written`);
  server.close(() => void api.idle().then(() => process.exit(0)));
  // Someone keeping a connection open does not keep the server up for ever.
  setTimeout(() => void api.idle().then(() => process.exit(0)), 8000).unref();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
