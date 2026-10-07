// `@family` is data/ when the private family is there, sample/ otherwise — see vite.config.ts.
import familyMarkdown from '@family/family.md?raw';
import { parseFamily } from './parser/parse';
import type { FamilyGraph, Person } from './parser/types';

// Bundled at build time so the offline single-file build needs no network.
const photos = import.meta.glob('@family/photos/*.{jpg,jpeg,png,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const byFileName = new Map(
  Object.entries(photos).map(([path, url]) => [path.split('/').pop()!, url]),
);

export function loadFamily(): FamilyGraph {
  return parseFamily(familyMarkdown);
}

export function photoUrl(person: Person): string | undefined {
  return person.photo ? byFileName.get(person.photo) : undefined;
}

/** Every picture of someone that exists: the portrait first, then `photos=`. */
export function galleryUrls(person: Person): string[] {
  const names = [person.photo, ...(person.photos ?? [])].filter((name): name is string => !!name);
  return [...new Set(names)].map((name) => byFileName.get(name)).filter((url): url is string => !!url);
}
