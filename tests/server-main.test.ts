import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SECRET = 'only-the-proxy-knows';

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stammbaum-main-'));
  await mkdir(path.join(dir, 'data'));
  await writeFile(path.join(dir, 'data', 'family.md'), '```family\nperson anna "Anna Berg"\n```\n');
  await mkdir(path.join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'dist', 'index.html'), '<!doctype html><script type="module" src="./assets/app.js"></script>');
  await writeFile(path.join(dir, 'dist', 'assets', 'app.js'), 'console.log(1)');
  Object.assign(process.env, {
    DATA_DIR: path.join(dir, 'data'),
    STATIC_DIR: path.join(dir, 'dist'),
    HOST: '127.0.0.1',
    PORT: '0',
    STAMMBAUM_PROXY_SECRET: SECRET,
  });
  ({ server } = await import('../server/main'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const proxied = (address: string, init: RequestInit = {}) =>
  fetch(`${base}${address}`, { ...init, headers: { 'X-Stammbaum-Proxy': SECRET, ...init.headers } });

/** A request exactly as written, past what fetch would tidy up first. */
const raw = (target: string) =>
  new Promise<number>((resolve, reject) => {
    const sent = httpRequest({ hostname: '127.0.0.1', port: new URL(base).port, path: target, headers: { 'X-Stammbaum-Proxy': SECRET } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    sent.on('error', reject);
    sent.end();
  });

describe('the server behind the proxy', () => {
  it('answers only what came through the proxy', async () => {
    expect((await fetch(`${base}/`)).status).toBe(403);
    expect((await fetch(`${base}/api/family`, { headers: { 'Remote-User': 'anna' } })).status).toBe(403);
    expect((await fetch(`${base}/api/family`, { headers: { 'X-Stammbaum-Proxy': 'guessed' } })).status).toBe(403);
    expect((await proxied('/api/family')).status).toBe(200);
  });

  it('says it is up without the secret, and nothing more', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('serves the page with a policy that lets only its own script run', async () => {
    const page = await proxied('/');
    expect(page.status).toBe(200);
    const policy = page.headers.get('content-security-policy')!;
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
    const script = await proxied('/assets/app.js');
    expect(script.headers.get('cache-control')).toContain('immutable');
    expect(script.headers.get('content-security-policy')).toBeNull();
  });

  it('answers addresses that make no sense, and keeps going', async () => {
    expect(await raw('/%E0%A4%A')).toBe(400);
    expect(await raw('/photos/%E0%A4%A')).toBe(404);
    expect(await raw('//')).toBe(400);
    expect((await proxied('/../secret')).status).toBe(404);
    expect((await proxied('/assets')).status).toBe(404);
    expect((await proxied('/%00')).status).toBe(404);
    expect((await proxied('/thumbs/%00')).status).toBe(404);
    expect((await proxied('/')).status).toBe(200);
  });
});
