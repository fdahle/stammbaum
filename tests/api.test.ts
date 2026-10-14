import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { familyApi } from '../server/api';

const FILE = '# Test\n\n```family\nperson anna "Anna Berg" sex=f born=1950\nperson ben "Ben Berg" sex=m\nanna + ben married=1975\n```\n';

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stammbaum-'));
  await writeFile(path.join(dir, 'family.md'), FILE);
  await mkdir(path.join(dir, 'photos'));
  await writeFile(path.join(dir, 'photos', 'Anna.JPG'), 'not really a picture');
  await writeFile(path.join(dir, 'secret.txt'), 'private');
  const api = familyApi({
    dataDir: dir,
    user: (request) => (request.headers['remote-user'] as string | undefined) || undefined,
    editors: ['anna', 'ben'],
    writable: true,
  });
  server = createServer((request, response) =>
    api(request, response, () => {
      response.statusCode = 404;
      response.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const edit = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stammbaum': 'edit', 'Remote-User': 'anna', ...headers },
    body: JSON.stringify(body),
  });

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

  it('saves an edit, keeps the old file and logs who did it', async () => {
    const response = await edit({
      edits: [{ kind: 'add-person', ref: '$c', set: { name: 'Clara Berg' } }, { kind: 'add-child', parents: ['anna', 'ben'], child: '$c' }],
      message: 'Clara Berg als Kind von Anna & Ben eingetragen',
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.created).toEqual({ $c: 'clara' });
    expect(body.family.markdown).toContain('anna + ben married=1975 -> clara');
    expect(await readFile(path.join(dir, 'family.md'), 'utf8')).toBe(body.family.markdown);

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

  it('takes uploaded pictures under a free name built from the one asked for', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const upload = (body: Buffer, type: string, headers: Record<string, string> = {}) =>
      fetch(`${base}/api/photos?name=Anna%20Berg`, {
        method: 'POST',
        headers: { 'Content-Type': type, 'X-Stammbaum': 'edit', 'Remote-User': 'anna', ...headers },
        body: new Uint8Array(body),
      });

    const first = await upload(jpeg, 'image/jpeg');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ name: 'anna-berg.jpg' });
    expect(await (await upload(jpeg, 'image/jpeg')).json()).toEqual({ name: 'anna-berg-2.jpg' });
    expect(await readFile(path.join(dir, 'photos', 'anna-berg.jpg'))).toEqual(jpeg);
    expect((await fetch(`${base}/api/family`)).ok).toBe(true);
    expect((await (await fetch(`${base}/api/family`)).json()).photos).toContain('anna-berg-2.jpg');
    expect(await readFile(path.join(dir, 'history', 'changes.log'), 'utf8')).toContain('\tanna\tFoto anna-berg.jpg hochgeladen\n');

    // Not from the app, not an editor, not a picture, or not what it claims to be.
    expect((await upload(jpeg, 'image/jpeg', { 'X-Stammbaum': 'nope' })).status).toBe(403);
    expect((await upload(jpeg, 'image/jpeg', { 'Remote-User': 'cousin' })).status).toBe(403);
    expect((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(403);
    expect((await upload(Buffer.from('<html>'), 'image/png')).status).toBe(400);
    expect((await readdir(path.join(dir, 'photos'))).sort()).toEqual(['Anna.JPG', 'anna-berg-2.jpg', 'anna-berg.jpg']);
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
});
