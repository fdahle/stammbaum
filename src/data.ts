import { parseFamily } from './parser/parse';
import type { FamilyGraph, Person } from './parser/types';
import type { FamilySource } from './source/types';

/** The pictures of the family on screen, by lower-case file name. */
let photos = new Map<string, string>();
let stamp: FamilySource['stamp'] = {};

/** Reads the family out of `source`, which also decides where the pictures come from. */
export function readFamily(source: FamilySource): FamilyGraph {
  photos = source.photos;
  stamp = source.stamp;
  const graph = parseFamily(source.markdown);
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

/** How current the family on screen is, for the line under the tree. */
export function familyStamp(): FamilySource['stamp'] {
  return stamp;
}

/** `photo=heinrich.jpg` finds Heinrich.JPG as well. */
export function photoByName(name: string): string | undefined {
  return photos.get(name.toLowerCase());
}

export function photoUrl(person: Person): string | undefined {
  return person.photo ? photoByName(person.photo) : undefined;
}

/** Every picture of someone that exists: the portrait first, then `photos=`. */
export function galleryUrls(person: Person): string[] {
  const names = [person.photo, ...(person.photos ?? [])].filter((name): name is string => !!name);
  return [...new Set(names)].map(photoByName).filter((url): url is string => !!url);
}
