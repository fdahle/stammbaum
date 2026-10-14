import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { applyEdits, EditError, type Edit } from '../src/parser/write';

/**
 * The family as the app reads and changes it: `GET api/family`, `POST
 * api/edits`, `POST api/photos` and the pictures under `photos/`. Shared by
 * the production server and `npm run dev`.
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

/**
 * What may be uploaded, and how each starts — the bytes have to agree with
 * the type. No SVG: it can carry script, and these are served from the app's
 * own origin.
 */
const UPLOADS: Record<string, { extension: string; is: (head: Buffer) => boolean }> = {
  'image/jpeg': { extension: 'jpg', is: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff },
  'image/png': { extension: 'png', is: (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: 'webp', is: (head) => head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP' },
  'image/gif': { extension: 'gif', is: (head) => head.toString('latin1', 0, 4) === 'GIF8' },
  'image/avif': { extension: 'avif', is: (head) => head.toString('latin1', 4, 12) === 'ftypavif' },
};

const MAX_BODY = 256 * 1024;
const MAX_PHOTO = 15 * 1024 * 1024;
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

  /** Who may change the family with this request; answers and gives `undefined` if nobody. */
  const editor = (request: IncomingMessage, response: ServerResponse, type: (contentType: string) => boolean): string | undefined => {
    // A form on another site cannot send this header without the browser asking first.
    if (request.headers['x-stammbaum'] !== 'edit' || !type(String(request.headers['content-type']))) {
      json(response, 403, { error: 'not from the app' });
      return undefined;
    }
    const user = options.user(request);
    if (!options.writable) json(response, 403, { error: 'read-only' });
    else if (!user) json(response, 401, { error: 'not logged in' });
    else if (!editable(user)) json(response, 403, { error: 'not allowed to edit' });
    else return user;
    return undefined;
  };

  const save = async (request: IncomingMessage, response: ServerResponse) => {
    const user = editor(request, response, (type) => type.startsWith('application/json'));
    if (!user) return;

    let body: { edits?: unknown; message?: unknown };
    try {
      body = JSON.parse((await readBody(request, MAX_BODY)).toString('utf8'));
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

  /**
   * A picture into photos/, under a free name built from `?name=` — `klaus.jpg`,
   * then `klaus-2.jpg`. Which person shows it is a separate edit of family.md.
   */
  const upload = async (request: IncomingMessage, response: ServerResponse) => {
    const kind = UPLOADS[String(request.headers['content-type']).split(';')[0]!.trim().toLowerCase()];
    const user = editor(request, response, () => !!kind);
    if (!user || !kind) return;

    let image: Buffer;
    try {
      image = await readBody(request, MAX_PHOTO);
    } catch {
      response.setHeader('Connection', 'close');
      return json(response, 413, { error: 'too large' });
    }
    if (!kind.is(image)) return json(response, 400, { error: 'not that kind of picture' });

    const folder = path.join(options.dataDir, 'photos');
    await mkdir(folder, { recursive: true });
    const taken = new Set((await readdir(folder)).map((name) => name.toLowerCase()));
    const { searchParams } = new URL(request.url ?? '/', 'http://local');
    const stem = slug(searchParams.get('name') ?? '') || 'photo';
    let name = `${stem}.${kind.extension}`;
    for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.${kind.extension}`;

    const temporary = path.join(folder, `.${name}.saving`);
    await writeFile(temporary, image);
    await rename(temporary, path.join(folder, name));
    await appendFile(path.join(await historyFolder(options.dataDir), 'changes.log'), `${new Date().toISOString()}\t${user}\tFoto ${name} hochgeladen\n`, 'utf8');
    json(response, 200, { name });
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
    } else if (pathname === '/api/photos' && request.method === 'POST') {
      // In the same queue, so two uploads never pick the same free name.
      queue = queue.then(() => upload(request, response)).catch(fail);
    } else if (pathname.startsWith('/photos/') && (request.method === 'GET' || request.method === 'HEAD')) {
      photo(options.dataDir, decodeURIComponent(pathname.slice('/photos/'.length)), response).catch(fail);
    } else {
      next();
    }
  };
}

/** The old file into history/, and a line about the change into changes.log. */
async function keepHistory(dataDir: string, before: string, user: string, message: string): Promise<void> {
  const folder = await historyFolder(dataDir);
  const now = new Date();
  if (before !== '') {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    await writeFile(path.join(folder, `family-${stamp}.md`), before, 'utf8');
  }
  await appendFile(path.join(folder, 'changes.log'), `${now.toISOString()}\t${user}\t${message}\n`, 'utf8');
}

async function historyFolder(dataDir: string): Promise<string> {
  const folder = path.join(dataDir, 'history');
  await mkdir(folder, { recursive: true });
  return folder;
}

/** `Klaus Bauer` → `klaus-bauer`: safe as a file name anywhere. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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

/** The request body, or a rejection once it grows past `limit` — the rest is drained unread. */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.off('data', collect);
        request.resume();
        reject(new Error('too large'));
      } else chunks.push(chunk);
    };
    request.on('data', collect);
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

