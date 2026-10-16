import type { Edit } from '../parser/write';
import type { FamilyPayload } from '../../server/api';
import { SaveConflict, UnsupportedImage, type FamilySource, type Saved } from './types';

/** Relative to the page, so the app also works below a sub-path. */
const url = (path: string) => new URL(path, document.baseURI).toString();

let etag: string | null = null;

function toSource(payload: FamilyPayload): FamilySource {
  return {
    markdown: payload.markdown,
    photos: new Map(payload.photos.map((name) => [name.toLowerCase(), url(`photos/${encodeURIComponent(name)}`)])),
    thumbs: new Map(payload.thumbs.map((name) => [name.toLowerCase(), url(`thumbs/${encodeURIComponent(name)}`)])),
    version: payload.version,
    stamp: payload.updated ? { updated: payload.updated } : {},
    editable: payload.editable,
  };
}

/** How long the family may take to arrive before the app says it did not. */
const LOAD_TIMEOUT_MS = 15_000;

/** Counts saves, so an answer asked for before one is not taken for newer than it. */
let saves = 0;

/**
 * Runs a request — body included — and gives up after LOAD_TIMEOUT_MS: weak
 * reception should end in a message, not in a blank page.
 */
async function inTime<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function loadSource(): Promise<FamilySource> {
  return inTime(async (signal) => {
    const response = await fetch(url('api/family'), { cache: 'no-cache', signal });
    if (!response.ok) throw new Error(`api/family: ${response.status}`);
    etag = response.headers.get('ETag');
    return toSource((await response.json()) as FamilyPayload);
  });
}

/** The family again if it changed since it was loaded — someone else saved, say. */
export function fetchChanges(): Promise<FamilySource | undefined> {
  const asked = saves;
  return inTime(async (signal) => {
    const headers: Record<string, string> = etag ? { 'If-None-Match': etag } : {};
    const response = await fetch(url('api/family'), { cache: 'no-cache', headers, signal });
    // A save went out meanwhile: this answer may be older than what it brought back.
    if (asked !== saves || response.status === 304 || !response.ok) return undefined;
    const payload = (await response.json()) as FamilyPayload;
    if (asked !== saves) return undefined;
    etag = response.headers.get('ETag');
    return toSource(payload);
  });
}

export async function saveEdits(edits: Edit[], message: string): Promise<Saved> {
  saves++;
  const response = await fetch(url('api/edits'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stammbaum': 'edit' },
    body: JSON.stringify({ edits, message }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    family?: FamilyPayload;
    created?: Record<string, string>;
    renamed?: Record<string, string>;
    error?: string;
  };
  if (response.status === 409 && body.family) throw new SaveConflict(toSource(body.family), body.error ?? 'conflict');
  if (!response.ok || !body.family) throw new Error(body.error ?? `api/edits: ${response.status}`);
  etag = null;
  return { source: toSource(body.family), created: body.created ?? {}, renamed: body.renamed ?? {} };
}

/** The small version of a photo already in photos/. */
export async function uploadThumb(photo: string, image: Blob): Promise<void> {
  const response = await fetch(url(`api/photos?thumb=${encodeURIComponent(photo)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'X-Stammbaum': 'edit' },
    body: image,
  });
  if (!response.ok) throw new Error(`api/photos: ${response.status}`);
}

/** Puts a picture into photos/; resolves to the file name it got there. */
export async function uploadPhoto(image: Blob, name: string): Promise<string> {
  const response = await fetch(url(`api/photos?name=${encodeURIComponent(name)}`), {
    method: 'POST',
    headers: { 'Content-Type': image.type, 'X-Stammbaum': 'edit' },
    body: image,
  });
  const body = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
  if (response.status === 415) throw new UnsupportedImage(body.error ?? 'api/photos: 415');
  if (!response.ok || !body.name) throw new Error(body.error ?? `api/photos: ${response.status}`);
  return body.name;
}
