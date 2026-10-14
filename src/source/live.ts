import type { Edit } from '../parser/write';
import type { FamilyPayload } from '../../server/api';
import { SaveConflict, type FamilySource, type Saved } from './types';

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

export async function loadSource(): Promise<FamilySource> {
  const response = await fetch(url('api/family'), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`api/family: ${response.status}`);
  etag = response.headers.get('ETag');
  return toSource((await response.json()) as FamilyPayload);
}

/** The family again if it changed since it was loaded — someone else saved, say. */
export async function fetchChanges(): Promise<FamilySource | undefined> {
  const response = await fetch(url('api/family'), { cache: 'no-cache', headers: etag ? { 'If-None-Match': etag } : {} });
  if (response.status === 304 || !response.ok) return undefined;
  etag = response.headers.get('ETag');
  return toSource((await response.json()) as FamilyPayload);
}

export async function saveEdits(edits: Edit[], message: string): Promise<Saved> {
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
  if (!response.ok || !body.name) throw new Error(body.error ?? `api/photos: ${response.status}`);
  return body.name;
}
