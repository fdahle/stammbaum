import { createHash } from 'node:crypto';
import { appendFile, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { tidyText } from '../src/parser/tidy';
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
  /** The photos among them that have a small version for the bubbles. */
  thumbs: string[];
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

/**
 * A photo opened on its own is shown, never run: an SVG put into photos/ by
 * hand may carry script, and it comes from the app's own origin.
 */
const PHOTO_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const MAX_BODY = 256 * 1024;
const MAX_PHOTO = 15 * 1024 * 1024;
const THUMB_SIZE = 512 * 1024;
const MAX_EDITS = 50;
/** How long the rest of a body that is too large is waited out before the connection closes. */
const LINGER = 2000;
/** How many earlier versions of family.md history/ keeps: a busy evening of relatives editing is a few hundred. */
const KEEP_COPIES = 1000;

type Next = () => void;

export interface FamilyApi {
  (request: IncomingMessage, response: ServerResponse, next: Next): void;
  /** Resolves once every save that has begun is written — for the server to wait on before it stops. */
  idle(): Promise<void>;
}

export function familyApi(options: ApiOptions): FamilyApi {
  const file = path.join(options.dataDir, 'family.md');
  // One save at a time, so two people saving at once both land. Only the
  // reading and writing of files waits here: bodies are read before, so a
  // slow upload holds up nobody else.
  let queue: Promise<unknown> = Promise.resolve();
  const queued = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  const editable = (user: string | undefined) =>
    options.writable && !!user && (options.editors.length === 0 || options.editors.includes(user.toLowerCase()));

  const payload = async (user: string | undefined): Promise<FamilyPayload> => {
    const markdown = await readFamily(file);
    const updated = await stat(file).then((s) => s.mtime.toISOString(), () => undefined);
    const photos = (await readdir(path.join(options.dataDir, 'photos')).catch(() => [] as string[])).filter((name) => extension(name) in IMAGE_TYPES);
    const small = new Set((await readdir(thumbFolder(options.dataDir)).catch(() => [] as string[])).map((name) => name.toLowerCase()));
    return {
      markdown,
      version: createHash('sha256').update(markdown).digest('hex').slice(0, 16),
      photos,
      thumbs: photos.filter((name) => small.has(thumbName(name))),
      updated,
      editable: editable(user),
    };
  };

  /** Who may change the family with this request; answers and gives `undefined` if nobody. */
  const editor = (request: IncomingMessage, response: ServerResponse): string | undefined => {
    // A form on another site cannot send this header without the browser asking first.
    if (request.headers['x-stammbaum'] !== 'edit') {
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
    const user = editor(request, response);
    if (!user) return;
    if (!contentType(request).startsWith('application/json')) return json(response, 415, { error: 'not JSON' });
    const raw = await body(request, response, MAX_BODY);
    if (!raw) return;

    let parsed: { edits?: unknown; message?: unknown } | null;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(response, 400, { error: 'not JSON' });
    }
    const edits = parsed && typeof parsed === 'object' ? parsed.edits : undefined;
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_EDITS) {
      return json(response, 400, { error: 'no edits' });
    }
    const message = String(parsed?.message ?? 'Änderung').replace(/\s+/g, ' ').trim().slice(0, 200);
    await queued(() => write(user, edits as Edit[], message, response));
  };

  /** family.md read, changed and written back — the part that waits its turn. */
  const write = async (user: string, edits: Edit[], message: string, response: ServerResponse) => {
    const before = await readFamily(file);
    let result: ReturnType<typeof applyEdits>;
    try {
      result = applyEdits(before, edits);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      const status = error.reason === 'conflict' ? 409 : 400;
      return json(response, status, { error: error.message, family: await payload(user) });
    }

    // A tidy file stays tidy: whatever was added lands where it belongs.
    // One kept in an order of its own is left in it.
    if (tidyText(before) === before) result.markdown = tidyText(result.markdown);

    if (result.markdown !== before) {
      await keepHistory(options.dataDir, before, user, message);
      // Written next to the file and renamed over it: never half a family.md.
      await writeSafely(file, `${file}.saving`, result.markdown);
    }
    json(response, 200, { family: await payload(user), created: result.created, renamed: result.renamed });
  };

  /**
   * The small version of a photo, made by the browser that uploaded it — so
   * the server needs no image library. Always a JPEG, at most THUMB_SIZE.
   */
  const uploadThumb = async (request: IncomingMessage, response: ServerResponse, of: string) => {
    const user = editor(request, response);
    if (!user) return;
    if (contentType(request) !== 'image/jpeg') return json(response, 415, { error: 'not a JPEG' });
    const image = await body(request, response, THUMB_SIZE);
    if (!image) return;
    if (!UPLOADS['image/jpeg']!.is(image)) return json(response, 415, { error: 'not a JPEG' });
    await queued(async () => {
      const photos = await readdir(path.join(options.dataDir, 'photos')).catch(() => [] as string[]);
      const original = photos.find((name) => name.toLowerCase() === of.toLowerCase() && extension(name) in IMAGE_TYPES);
      if (!original) return json(response, 404, { error: 'no such photo' });
      const folder = thumbFolder(options.dataDir);
      await mkdir(folder, { recursive: true });
      await writeSafely(path.join(folder, thumbName(original)), path.join(folder, `.${thumbName(original)}.saving`), image);
      json(response, 200, { thumb: original });
    });
  };

  /**
   * A picture into photos/, under a free name built from `?name=` — `klaus.jpg`,
   * then `klaus-2.jpg`. Which person shows it is a separate edit of family.md.
   */
  const upload = async (request: IncomingMessage, response: ServerResponse, query: URLSearchParams) => {
    const of = query.get('thumb');
    if (of !== null) return uploadThumb(request, response, of);
    const user = editor(request, response);
    if (!user) return;
    const kind = UPLOADS[contentType(request)];
    if (!kind) return json(response, 415, { error: 'not a kind of picture that is taken' });
    const image = await body(request, response, MAX_PHOTO);
    if (!image) return;
    if (!kind.is(image)) return json(response, 415, { error: 'not that kind of picture' });

    // In the queue, so two uploads never pick the same free name.
    await queued(async () => {
      const folder = path.join(options.dataDir, 'photos');
      await mkdir(folder, { recursive: true });
      const taken = new Set((await readdir(folder)).map((name) => name.toLowerCase()));
      const stem = slug(query.get('name') ?? '') || 'photo';
      let name = `${stem}.${kind.extension}`;
      for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.${kind.extension}`;

      await writeSafely(path.join(folder, name), path.join(folder, `.${name}.saving`), image);
      await appendFile(path.join(await historyFolder(options.dataDir), 'changes.log'), `${new Date().toISOString()}\t${user}\tFoto ${name} hochgeladen\n`, 'utf8');
      json(response, 200, { name });
    });
  };

  const handle = (request: IncomingMessage, response: ServerResponse, next: Next) => {
    const fail = (error: unknown) => {
      console.error(error);
      if (!response.headersSent) json(response, 500, { error: 'server error' });
    };
    // Nothing in here may throw: an odd address is the asker's mistake, not the end of the server.
    const address = parseAddress(request.url);
    if (!address) return json(response, 400, { error: 'bad address' });
    const { pathname, searchParams } = address;
    const reading = request.method === 'GET' || request.method === 'HEAD';

    if (pathname === '/api/family' && request.method === 'GET') {
      payload(options.user(request))
        .then((family) => {
          const etag = `"${family.version}-${family.editable ? 1 : 0}-${family.photos.length}-${family.thumbs.length}"`;
          response.setHeader('ETag', etag);
          response.setHeader('Cache-Control', 'no-cache');
          if (request.headers['if-none-match'] === etag) {
            response.statusCode = 304;
            response.end();
          } else json(response, 200, family);
        })
        .catch(fail);
    } else if (pathname === '/api/edits' && request.method === 'POST') {
      save(request, response).catch(fail);
    } else if (pathname === '/api/photos' && request.method === 'POST') {
      upload(request, response, searchParams).catch(fail);
    } else if (pathname.startsWith('/thumbs/') && reading) {
      thumb(options.dataDir, decode(pathname.slice('/thumbs/'.length)), request, response).catch(fail);
    } else if (pathname.startsWith('/photos/') && reading) {
      photo(options.dataDir, decode(pathname.slice('/photos/'.length)), request, response).catch(fail);
    } else {
      next();
    }
  };

  return Object.assign(handle, { idle: () => queue.then(() => undefined) });
}

/**
 * family.md as it is — empty only when there is none yet. Any other trouble
 * reading it is an error, never an empty family that the next save would
 * write over the real one.
 */
async function readFamily(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** Written to `temporary`, onto the disk, then renamed over `file`: never half a file, not even after a power cut. */
async function writeSafely(file: string, temporary: string, data: string | Buffer): Promise<void> {
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

/** The old file into history/, and a line about the change into changes.log. */
async function keepHistory(dataDir: string, before: string, user: string, message: string): Promise<void> {
  const folder = await historyFolder(dataDir);
  const now = new Date();
  if (before !== '') {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    await writeFile(path.join(folder, `family-${stamp}.md`), before, 'utf8');
    // Enough to take back a slip, without growing for ever: the newest ones stay.
    const copies = (await readdir(folder)).filter((name) => /^family-.*\.md$/.test(name)).sort();
    await Promise.all(copies.slice(0, -KEEP_COPIES).map((name) => unlink(path.join(folder, name))));
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
async function photo(dataDir: string, name: string | undefined, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const folder = path.join(dataDir, 'photos');
  const match = name !== undefined && plain(name) ? (await readdir(folder).catch(() => [] as string[])).find((f) => f.toLowerCase() === name.toLowerCase()) : undefined;
  const type = match && IMAGE_TYPES[extension(match)];
  if (!match || !type) return notFound(response);
  await sendFile(request, response, path.join(folder, match), {
    'Content-Type': type,
    'Cache-Control': 'private, max-age=3600',
    'Content-Security-Policy': PHOTO_POLICY,
  });
}

/** Small versions live next to the photos, hidden: photos/.thumbs/heinrich.jpg.jpg */
function thumbFolder(dataDir: string): string {
  return path.join(dataDir, 'photos', '.thumbs');
}

function thumbName(photo: string): string {
  return `${photo.toLowerCase()}.jpg`;
}

/** A photo's small version, or the 404 the app falls back from. */
async function thumb(dataDir: string, name: string | undefined, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (name === undefined || !plain(name)) return notFound(response);
  await sendFile(request, response, path.join(thumbFolder(dataDir), thumbName(name)), {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=3600',
    'Content-Security-Policy': PHOTO_POLICY,
  });
}

/** A plain file name only: nothing that could climb out of the folder. */
function plain(name: string): boolean {
  return !/[\\/]/.test(name) && !name.startsWith('.');
}

/**
 * A regular file as the response, with `headers` — or a 404 if there is
 * none. Says when it last changed, and answers a browser that has it already
 * with 304. A file that cannot be read, or a visitor who leaves halfway, ends
 * this response and nothing more.
 */
export async function sendFile(request: IncomingMessage, response: ServerResponse, file: string, headers: Record<string, string>): Promise<void> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    // No such file, a folder, or a name no file can have.
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG', 'ERR_INVALID_ARG_VALUE'].includes((error as NodeJS.ErrnoException).code ?? '')) return notFound(response);
    throw error;
  }
  let streaming = false;
  try {
    const info = await handle.stat();
    // A folder called x.jpg is no picture.
    if (!info.isFile()) return notFound(response);
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Last-Modified', info.mtime.toUTCString());
    // HTTP dates have whole seconds.
    if (Math.floor(info.mtimeMs / 1000) * 1000 <= Date.parse(String(request.headers['if-modified-since']))) {
      response.statusCode = 304;
      response.end();
      return;
    }
    response.setHeader('Content-Length', info.size);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    // From here on the stream closes the file, however it ends.
    streaming = true;
    await pipeline(handle.createReadStream(), response).catch((error: unknown) => {
      // Half sent, or the visitor has gone: there is nothing left to answer.
      if (response.headersSent || response.destroyed) return;
      throw error;
    });
  } finally {
    if (!streaming) await handle.close();
  }
}

function notFound(response: ServerResponse): void {
  response.statusCode = 404;
  response.end('not found');
}

/** The path and query a request asks for, or `undefined` for one that makes no sense. */
export function parseAddress(url: string | undefined): URL | undefined {
  try {
    return new URL(url ?? '/', 'http://local');
  } catch {
    return undefined;
  }
}

/** `M%C3%BCller` → `Müller`, or `undefined` for something that is no such encoding. */
export function decode(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function contentType(request: IncomingMessage): string {
  return String(request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

class TooLarge extends Error {}

/**
 * The request body, or a rejection once it grows past `limit` — or says
 * it will, before any of it is read. The rest is left unread.
 */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(request.headers['content-length']) > limit) return reject(new TooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.off('data', collect);
        request.pause();
        reject(new TooLarge());
      } else chunks.push(chunk);
    };
    request.on('data', collect);
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
    // Gone before the end; after it, this changes nothing.
    request.on('close', () => reject(new Error('request closed early')));
  });
}

/**
 * The body, or `undefined` once it has answered that it is too large. The
 * answer goes out at once and the connection closes; what is still on its
 * way is thrown away for LINGER first, or the browser could lose the answer
 * to a reset before reading it.
 */
async function body(request: IncomingMessage, response: ServerResponse, limit: number): Promise<Buffer | undefined> {
  try {
    return await readBody(request, limit);
  } catch (error) {
    if (!(error instanceof TooLarge)) throw error;
    const answer = JSON.stringify({ error: 'too large' });
    response.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(answer), Connection: 'close' });
    response.write(answer);
    const close = () => {
      clearTimeout(timer);
      if (!response.writableEnded) response.end();
    };
    const timer = setTimeout(close, LINGER).unref();
    request.once('end', close);
    request.resume();
    return undefined;
  }
}
