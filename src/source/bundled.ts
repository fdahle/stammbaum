// `@family` is data/ when the private family is there, sample/ otherwise — see vite.config.ts.
import familyMarkdown from '@family/family.md?raw';
import type { Edit } from '../parser/write';
import type { FamilySource, Saved } from './types';

// Bundled at build time so the offline single-file build needs no network.
// Phones name their pictures IMG_1234.JPG, so the upper-case spellings count too.
const photos = import.meta.glob(
  '@family/photos/*.{jpg,jpeg,png,webp,gif,avif,svg,JPG,JPEG,PNG,WEBP,GIF,AVIF,SVG}',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) as Record<string, string>;

/** The family as it was when this file was built — to read, not to change. */
export async function loadSource(): Promise<FamilySource> {
  return {
    markdown: familyMarkdown,
    photos: new Map(Object.entries(photos).map(([path, url]) => [path.split('/').pop()!.toLowerCase(), url])),
    thumbs: new Map(),
    version: __FAMILY_COMMIT__ || 'bundled',
    stamp: { commit: __FAMILY_COMMIT__ },
    editable: false,
  };
}

export async function fetchChanges(): Promise<FamilySource | undefined> {
  return undefined;
}

export async function saveEdits(_edits: Edit[], _message: string): Promise<Saved> {
  throw new Error('this copy of the family cannot be changed');
}

export async function uploadThumb(_photo: string, _image: Blob): Promise<void> {
  throw new Error('this copy of the family cannot be changed');
}

export async function uploadPhoto(_image: Blob, _name: string): Promise<string> {
  throw new Error('this copy of the family cannot be changed');
}
