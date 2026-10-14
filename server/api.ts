import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { applyEdits, EditError, type Edit } from '../src/parser/write';

/**
 * The family as the app reads and changes it: `GET api/family`, `POST
 * api/edits` and the pictures under `photos/`. Shared by the production server
 * and `npm run dev`.
 *
 * Every save first copies the old family.md into `history/` and notes who
 * changed what in `history/changes.log` — so the folder, backed up as it is,
 * carries its own history, and any earlier version can be put back by hand.
 */
export interface ApiOptions {
  /** The folder with family.md and photos/. */
  dataDir: string;
  /** Who is asking: the login the proxy in front vouches for. */
  user(request: IncomingMessage): string | undefined;
  /** Logins that may edit, lower case; empty means everyone who is logged in. */
  editors: string[];
  /** Whether the family may be changed at all. */
  writable: boolean;
}

/** What the app gets: the file, and what goes with it. */
export interface FamilyPayload {
  markdown: string;
  /** Changes with every edit; lets the app notice someone else's. */
  version: string;
  /** File names in photos/. */
  photos: string[];
  /** When family.md last changed, ISO. */
  updated: string | undefined;
  /** Whether whoever asked may edit. */
  editable: boolean;
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

const MAX_BODY = 256 * 1024;
const MAX_EDITS = 50;

type Next = () => void;

export function familyApi(options: ApiOptions): (request: IncomingMessage, response: ServerResponse, next: Next) => void {
  const file = path.join(options.dataDir, 'family.md');
  // One save at a time, so two people saving at once both land.
  let queue: Promise<unknown> = Promise.resolve();

  const editable = (user: string | undefined) =>
    options.writable && !!user && (options.editors.length === 0 || options.editors.includes(user.toLowerCase()));

  const payload = async (user: string | undefined): Promise<FamilyPayload> => {
    const markdown = await readFile(file, 'utf8').catch(() => '');
    const updated = await stat(file).then((s) => s.mtime.toISOString(), () => undefined);
    const photos = await readdir(path.join(options.dataDir, 'photos')).catch(() => [] as string[]);
    return {
      markdown,
      version: createHash('sha256').update(markdown).digest('hex').slice(0, 16),
      photos: photos.filter((name) => extension(name) in IMAGE_TYPES),
      updated,
      editable: editable(user),
    };
  };

  const save = async (request: IncomingMessage, response: ServerResponse) => {
    // A form on another site cannot send this header without the browser asking first.
    if (request.headers['x-stammbaum'] !== 'edit' || !String(request.headers['content-type']).startsWith('application/json')) {
      return json(response, 403, { error: 'not from the app' });
    }
    const user = options.user(request);
    if (!options.writable) return json(response, 403, { error: 'read-only' });
    if (!user) return json(response, 401, { error: 'not logged in' });
    if (!editable(user)) return json(response, 403, { error: 'not allowed to edit' });

    let body: { edits?: unknown; message?: unknown };
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      return json(response, 400, { error: 'not JSON' });
    }
    if (!Array.isArray(body.edits) || body.edits.length === 0 || body.edits.length > MAX_EDITS) {
      return json(response, 400, { error: 'no edits' });
    }
    const message = String(body.message ?? 'Änderung').replace(/\s+/g, ' ').trim().slice(0, 200);

    const before = await readFile(file, 'utf8').catch(() => '');
    let result: { markdown: string; created: Record<string, string> };
    try {
      result = applyEdits(before, body.edits as Edit[]);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      const status = error.reason === 'conflict' ? 409 : 400;
      return json(response, status, { error: error.message, family: await payload(user) });
    }

    if (result.markdown !== before) {
      await keepHistory(options.dataDir, before, user, message);
      // Written next to the file and renamed over it: never half a family.md.
      const temporary = `${file}.saving`;
      await writeFile(temporary, result.markdown, 'utf8');
      await rename(temporary, file);
    }
    json(response, 200, { family: await payload(user), created: result.created });
  };

  return (request, response, next) => {
    const { pathname } = new URL(request.url ?? '/', 'http://local');
    const fail = (error: unknown) => {
      console.error(error);
      if (!response.headersSent) json(response, 500, { error: 'server error' });
    };

    if (pathname === '/api/family' && request.method === 'GET') {
      payload(options.user(request))
        .then((family) => {
          const etag = `"${family.version}-${family.editable ? 1 : 0}"`;
          response.setHeader('ETag', etag);
          response.setHeader('Cache-Control', 'no-cache');
          if (request.headers['if-none-match'] === etag) {
            response.statusCode = 304;
            response.end();
          } else json(response, 200, family);
        })
        .catch(fail);
    } else if (pathname === '/api/edits' && request.method === 'POST') {
      queue = queue.then(() => save(request, response)).catch(fail);
    } else if (pathname.startsWith('/photos/') && (request.method === 'GET' || request.method === 'HEAD')) {
      photo(options.dataDir, decodeURIComponent(pathname.slice('/photos/'.length)), response).catch(fail);
    } else {
      next();
    }
  };
}

/** The old file into history/, and a line about the change into changes.log. */
async function keepHistory(dataDir: string, before: string, user: string, message: string): Promise<void> {
  const folder = path.join(dataDir, 'history');
  await mkdir(folder, { recursive: true });
  const now = new Date();
  if (before !== '') {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    await writeFile(path.join(folder, `family-${stamp}.md`), before, 'utf8');
  }
  await appendFile(path.join(folder, 'changes.log'), `${now.toISOString()}\t${user}\t${message}\n`, 'utf8');
}

/** A picture from photos/, matched without regard to case, as the app does. */
async function photo(dataDir: string, name: string, response: ServerResponse): Promise<void> {
  const folder = path.join(dataDir, 'photos');
  // A plain file name only: nothing that could climb out of the folder.
  const safe = !/[\\/]/.test(name) && !name.startsWith('.');
  const match = safe ? (await readdir(folder).catch(() => [] as string[])).find((f) => f.toLowerCase() === name.toLowerCase()) : undefined;
  const type = match && IMAGE_TYPES[extension(match)];
  if (!match || !type) {
    response.statusCode = 404;
    response.end('not found');
    return;
  }
  response.setHeader('Content-Type', type);
  response.setHeader('Cache-Control', 'private, max-age=3600');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(path.join(folder, match)).pipe(response);
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

