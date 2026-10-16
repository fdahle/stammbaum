import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { familyApi, type ApiOptions } from '../server/api';

const FILE = '# Test\n\n```family\nperson anna "Anna Berg" sex=f born=1950\nperson ben "Ben Berg" sex=m\nanna + ben married=1975\n```\n';

let dir: string;
let server: Server;
let base: string;
const others: Server[] = [];
const folders: string[] = [];

/** The api on a port of its own, with the 404 the real server falls back to. */
async function serve(options: Partial<ApiOptions> & { dataDir: string }): Promise<{ server: Server; base: string }> {
  const api = familyApi({
    user: (request) => (request.headers['remote-user'] as string | undefined) || undefined,
    editors: ['anna', 'ben'],
    writable: true,
    ...options,
  });
  const server = createServer((request, response) =>
    api(request, response, () => {
      response.statusCode = 404;
      response.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stammbaum-'));
  await writeFile(path.join(dir, 'family.md'), FILE);
  await mkdir(path.join(dir, 'photos'));
  await writeFile(path.join(dir, 'photos', 'Anna.JPG'), 'not really a picture');
  await writeFile(path.join(dir, 'secret.txt'), 'private');
  ({ server, base } = await serve({ dataDir: dir }));
});

afterAll(async () => {
  server.close();
  for (const other of others) other.close();
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
});

const edit = (body: unknown, headers: Record<string, string> = {}, at = base) =>
  fetch(`${at}/api/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stammbaum': 'edit', 'Remote-User': 'anna', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const upload = (body: Buffer, type: string, headers: Record<string, string> = {}, at = base) =>
  fetch(`${at}/api/photos?name=Anna%20Berg`, {
    method: 'POST',
    headers: { 'Content-Type': type, 'X-Stammbaum': 'edit', 'Remote-User': 'anna', ...headers },
    body: new Uint8Array(body),
  });

/** A request exactly as written, past what fetch would tidy up first. */
const raw = (target: string, at = base) =>
  new Promise<number>((resolve, reject) => {
    const { hostname, port } = new URL(at);
    const sent = httpRequest({ hostname, port, path: target, method: 'GET' }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    sent.on('error', reject);
    sent.end();
  });

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('the family api', () => {
  it('serves the file to anyone, but says only editors may change it', async () => {
    const anonymous = await (await fetch(`${base}/api/family`)).json();
    expect(anonymous).toMatchObject({ markdown: FILE, photos: ['Anna.JPG'], editable: false });
    const editor = await (await fetch(`${base}/api/family`, { headers: { 'Remote-User': 'Anna' } })).json();
    expect(editor.editable).toBe(true);
    const relative = await (await fetch(`${base}/api/family`, { headers: { 'Remote-User': 'cousin' } })).json();
    expect(relative.editable).toBe(false);
  });

  it('answers an unchanged family with 304', async () => {
    const first = await fetch(`${base}/api/family`);
    const again = await fetch(`${base}/api/family`, { headers: { 'If-None-Match': first.headers.get('ETag')! } });
    expect(again.status).toBe(304);
  });

  it('refuses edits from outside the app, from nobody and from non-editors', async () => {
    const body = { edits: [{ kind: 'person', id: 'ben', set: { job: 'Koch' } }] };
    expect((await edit(body, { 'X-Stammbaum': 'nope' })).status).toBe(403);
    expect((await edit(body, { 'Remote-User': '' })).status).toBe(401);
    expect((await edit(body, { 'Remote-User': 'cousin' })).status).toBe(403);
    expect(await readFile(path.join(dir, 'family.md'), 'utf8')).toBe(FILE);
  });

  it('turns away what is not a list of edits', async () => {
    expect((await edit('{"edits": [')).status).toBe(400);
    expect((await edit('null')).status).toBe(400);
    expect((await edit({ edits: [] })).status).toBe(400);
    expect((await edit('{}', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(await readFile(path.join(dir, 'family.md'), 'utf8')).toBe(FILE);
  });

  it('turns away an edit that is too large, without waiting for all of it', async () => {
    // Sent in pieces with no length up front: the server has to count.
    const piece = new TextEncoder().encode(`{"edits": [${'0,'.repeat(64 * 1024)}`);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Far more than the limit, and it would go on: the answer comes first.
        if (sent++ < 64) controller.enqueue(piece);
        else controller.close();
      },
    });
    const response = await fetch(`${base}/api/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Stammbaum': 'edit', 'Remote-User': 'anna' },
      body: endless,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(response.headers.get('connection')).toBe('close');
    expect(await readFile(path.join(dir, 'family.md'), 'utf8')).toBe(FILE);
  });

  it('saves an edit, keeps the old file and logs who did it', async () => {
    const response = await edit({
      edits: [{ kind: 'add-person', ref: '$c', set: { name: 'Clara Berg' } }, { kind: 'add-child', parents: ['anna', 'ben'], child: '$c' }],
      message: 'Clara Berg als Kind von Anna & Ben eingetragen',
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.created).toEqual({ $c: 'clara-berg' });
    expect(body.family.markdown).toContain('anna + ben married=1975 -> clara-berg');
    expect(await readFile(path.join(dir, 'family.md'), 'utf8')).toBe(body.family.markdown);
    expect(await readdir(dir)).not.toContain('family.md.saving');

    const history = await readdir(path.join(dir, 'history'));
    const copy = history.find((name) => name.startsWith('family-'))!;
    expect(await readFile(path.join(dir, 'history', copy), 'utf8')).toBe(FILE);
    expect(await readFile(path.join(dir, 'history', 'changes.log'), 'utf8')).toMatch(/\tanna\tClara Berg als Kind von Anna & Ben eingetragen\n$/);
  });

  it('turns a stale edit away with the family as it is now', async () => {
    const response = await edit({ edits: [{ kind: 'person', id: 'anna', set: { born: '1951' }, was: { born: '1949' } }] });
    expect(response.status).toBe(409);
    expect((await response.json()).family.markdown).toContain('born=1950');
  });

  it('saves edits that arrive at the same time one after the other', async () => {
    const results = await Promise.all([
      edit({ edits: [{ kind: 'person', id: 'anna', set: { job: 'Ärztin' } }] }),
      edit({ edits: [{ kind: 'person', id: 'ben', set: { job: 'Koch' } }] }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const markdown = await readFile(path.join(dir, 'family.md'), 'utf8');
    expect(markdown).toContain('job=Ärztin');
    expect(markdown).toContain('job=Koch');
  });

  it('saves an edit while a slow upload is still on its way', async () => {
    let finish!: () => void;
    const slow = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(JPEG));
        finish = () => controller.close();
      },
    });
    const uploading = fetch(`${base}/api/photos?name=slow`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Stammbaum': 'edit', 'Remote-User': 'anna' },
      body: slow,
      duplex: 'half',
    } as RequestInit);
    const saved = await edit({ edits: [{ kind: 'person', id: 'ben', set: { job: 'Bäcker' } }] });
    expect(saved.status).toBe(200);
    finish();
    const uploaded = await uploading;
    expect(await uploaded.json()).toEqual({ name: 'slow.jpg' });
  });

  it('takes uploaded pictures under a free name built from the one asked for', async () => {
    const first = await upload(JPEG, 'image/jpeg');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ name: 'anna-berg.jpg' });
    expect(await (await upload(JPEG, 'image/jpeg')).json()).toEqual({ name: 'anna-berg-2.jpg' });
    expect(await readFile(path.join(dir, 'photos', 'anna-berg.jpg'))).toEqual(JPEG);
    expect((await fetch(`${base}/api/family`)).ok).toBe(true);
    expect((await (await fetch(`${base}/api/family`)).json()).photos).toContain('anna-berg-2.jpg');
    expect(await readFile(path.join(dir, 'history', 'changes.log'), 'utf8')).toContain('\tanna\tFoto anna-berg.jpg hochgeladen\n');

    // Not from the app, not an editor, not a picture, or not what it claims to be.
    expect((await upload(JPEG, 'image/jpeg', { 'X-Stammbaum': 'nope' })).status).toBe(403);
    expect((await upload(JPEG, 'image/jpeg', { 'Remote-User': 'cousin' })).status).toBe(403);
    expect((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415);
    expect((await upload(Buffer.from('<html>'), 'image/png')).status).toBe(415);
    expect((await readdir(path.join(dir, 'photos'))).sort()).toEqual(['Anna.JPG', 'anna-berg-2.jpg', 'anna-berg.jpg', 'slow.jpg']);
  });

  it('keeps a small version of a photo for the bubbles', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const thumb = (of: string, body: Buffer, type = 'image/jpeg') =>
      fetch(`${base}/api/photos?thumb=${encodeURIComponent(of)}`, {
        method: 'POST',
        headers: { 'Content-Type': type, 'X-Stammbaum': 'edit', 'Remote-User': 'anna' },
        body: new Uint8Array(body),
      });
    expect((await thumb('ANNA-BERG.jpg', jpeg)).status).toBe(200);
    const served = await fetch(`${base}/thumbs/anna-berg.jpg`);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(jpeg);
    expect((await (await fetch(`${base}/api/family`)).json()).thumbs).toEqual(['anna-berg.jpg']);

    expect((await thumb('nobody.jpg', jpeg)).status).toBe(404);
    expect((await thumb('anna-berg.jpg', Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415);
    expect((await thumb('anna-berg.jpg', Buffer.from('<svg/>'))).status).toBe(415);
    expect((await fetch(`${base}/thumbs/..%2Fanna-berg.jpg`)).status).toBe(404);
  });

  it('turns away a picture that is too large', async () => {
    const huge = Buffer.alloc(16 * 1024 * 1024, 0);
    huge.set([0xff, 0xd8, 0xff]);
    const response = await fetch(`${base}/api/photos?name=big`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Stammbaum': 'edit', 'Remote-User': 'anna' },
      body: new Uint8Array(huge),
    });
    expect(response.status).toBe(413);
    expect(await readdir(path.join(dir, 'photos'))).not.toContain('big.jpg');
  });

  it('serves pictures whatever their case, and nothing outside photos/', async () => {
    expect((await fetch(`${base}/photos/anna.jpg`)).status).toBe(200);
    expect((await fetch(`${base}/photos/..%2Fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/photos/..%5Csecret.txt`)).status).toBe(404);
  });

  it('says when a picture changed, answers 304 when the browser has it, and never lets one run', async () => {
    for (const address of [`${base}/photos/anna.jpg`, `${base}/thumbs/anna-berg.jpg`]) {
      const first = await fetch(address);
      const changed = first.headers.get('last-modified')!;
      expect(Date.parse(changed)).toBeGreaterThan(0);
      expect(first.headers.get('content-security-policy')).toContain('sandbox');
      expect((await fetch(address, { headers: { 'If-Modified-Since': changed } })).status).toBe(304);
      expect((await fetch(address, { method: 'HEAD', headers: { 'If-Modified-Since': changed } })).status).toBe(304);
      const older = new Date(Date.parse(changed) - 60_000).toUTCString();
      expect((await fetch(address, { headers: { 'If-Modified-Since': older } })).status).toBe(200);
      const head = await fetch(address, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe(String((await first.arrayBuffer()).byteLength));
    }
  });

  it('answers addresses that make no sense, and keeps going', async () => {
    expect((await raw('/photos/%E0%A4%A')).toString()).toMatch(/^4\d\d$/);
    expect((await raw('/thumbs/%E0%A4%A')).toString()).toMatch(/^4\d\d$/);
    expect(await raw('//')).toBe(400);
    expect((await fetch(`${base}/api/family`)).status).toBe(200);
  });

  it('turns a folder that looks like a photo into a 404, and keeps going', async () => {
    await mkdir(path.join(dir, 'photos', 'folder.jpg'));
    await mkdir(path.join(dir, 'photos', '.thumbs', 'folder.jpg.jpg'), { recursive: true });
    expect((await fetch(`${base}/photos/folder.jpg`)).status).toBe(404);
    expect((await fetch(`${base}/thumbs/folder.jpg`)).status).toBe(404);
    expect((await fetch(`${base}/photos/anna.jpg`)).status).toBe(200);
  });

  // Windows has no such modes, and root reads everything anyway.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('answers a photo it may not read with 500, and keeps going', async () => {
    const locked = path.join(dir, 'photos', 'locked.jpg');
    await writeFile(locked, JPEG);
    await chmod(locked, 0o000);
    expect((await fetch(`${base}/photos/locked.jpg`)).status).toBe(500);
    expect((await fetch(`${base}/photos/anna.jpg`)).status).toBe(200);
    await chmod(locked, 0o644);
  });
});

describe('a family that may not be changed', () => {
  it('refuses edits and uploads to everyone', async () => {
    const readonly = await mkdtemp(path.join(tmpdir(), 'stammbaum-'));
    folders.push(readonly);
    await writeFile(path.join(readonly, 'family.md'), FILE);
    await mkdir(path.join(readonly, 'photos'));
    await writeFile(path.join(readonly, 'photos', 'anna.jpg'), JPEG);
    const { server, base } = await serve({ dataDir: readonly, writable: false });
    others.push(server);

    expect((await (await fetch(`${base}/api/family`, { headers: { 'Remote-User': 'anna' } })).json()).editable).toBe(false);
    expect((await edit({ edits: [{ kind: 'person', id: 'ben', set: { job: 'Koch' } }] }, {}, base)).status).toBe(403);
    expect((await upload(JPEG, 'image/jpeg', {}, base)).status).toBe(403);
    const thumb = await fetch(`${base}/api/photos?thumb=anna.jpg`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Stammbaum': 'edit', 'Remote-User': 'anna' },
      body: new Uint8Array(JPEG),
    });
    expect(thumb.status).toBe(403);
    expect(await readFile(path.join(readonly, 'family.md'), 'utf8')).toBe(FILE);
    expect((await readdir(readonly)).sort()).toEqual(['family.md', 'photos']);
    expect(await readdir(path.join(readonly, 'photos'))).toEqual(['anna.jpg']);
  });
});

describe('a family.md that cannot be read', () => {
  it('is an error, never an empty family to save over it', async () => {
    const broken = await mkdtemp(path.join(tmpdir(), 'stammbaum-'));
    folders.push(broken);
    // A folder where the file should be: there, but not readable as a file.
    await mkdir(path.join(broken, 'family.md'));
    const { server, base } = await serve({ dataDir: broken });
    others.push(server);

    expect((await fetch(`${base}/api/family`)).status).toBe(500);
    const response = await edit({ edits: [{ kind: 'add-person', ref: '$c', set: { name: 'Clara Berg' } }] }, {}, base);
    expect(response.status).toBe(500);
    expect((await stat(path.join(broken, 'family.md'))).isDirectory()).toBe(true);
    expect(await readdir(broken)).toEqual(['family.md']);
  });

  it('starts empty only when there is none yet', async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), 'stammbaum-'));
    folders.push(fresh);
    const { server, base } = await serve({ dataDir: fresh });
    others.push(server);
    expect((await (await fetch(`${base}/api/family`)).json()).markdown).toBe('');
  });
});
