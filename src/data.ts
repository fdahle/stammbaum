// `@family` is data/ when the private family is there, sample/ otherwise — see vite.config.ts.
import familyMarkdown from '@family/family.md?raw';
import { parseFamily } from './parser/parse';
import type { FamilyGraph, Person } from './parser/types';

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

/** By lower-case file name: `photo=heinrich.jpg` finds Heinrich.JPG as well. */
const byFileName = new Map(
  Object.entries(photos).map(([path, url]) => [path.split('/').pop()!.toLowerCase(), url]),
);

function photoByName(name: string): string | undefined {
  return byFileName.get(name.toLowerCase());
}

export function loadFamily(): FamilyGraph {
  const graph = parseFamily(familyMarkdown);
  // A picture that is not there would otherwise just quietly be an initials bubble.
  for (const person of graph.people.values()) {
    for (const name of [person.photo, ...(person.photos ?? [])]) {
      if (name && !photoByName(name)) {
        graph.warnings.push({ line: person.line ?? 0, message: `photo "${name}" is not in photos/`, text: name });
      }
    }
  }
  return graph;
}

export function photoUrl(person: Person): string | undefined {
  return person.photo ? photoByName(person.photo) : undefined;
}

/** Every picture of someone that exists: the portrait first, then `photos=`. */
export function galleryUrls(person: Person): string[] {
  const names = [person.photo, ...(person.photos ?? [])].filter((name): name is string => !!name);
  return [...new Set(names)].map(photoByName).filter((url): url is string => !!url);
}
