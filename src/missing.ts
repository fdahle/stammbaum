import type { Family } from './family';
import { isDeceased, knownDate, type Person } from './parser/types';
import { isStandIn, OLDEST, parseDate, year, type DateParts } from './ui/format';

/** What family.md does not know yet about someone, worst first. */
export type GapKind =
  | 'standIn'
  | 'undeclared'
  | 'disconnected'
  | 'noSex'
  | 'noBirth'
  | 'partialBirth'
  | 'probablyDeceased'
  | 'undatedDeath'
  | 'noPhoto';

export interface Gap {
  kind: GapKind;
  /** Who it applies to, in file order, with what the file says so far. */
  people: Array<{ person: Person; detail?: string }>;
}

const ORDER: GapKind[] = [
  'standIn',
  'undeclared',
  'disconnected',
  'noSex',
  'noBirth',
  'partialBirth',
  'probablyDeceased',
  'undatedDeath',
  'noPhoto',
];

/**
 * Everything worth asking about at the next gathering: who is only mentioned,
 * who hangs in the air, and whose dates, sex or photo are missing — the last
 * two decide how the captions and bubbles look.
 */
export function gaps(family: Family, hasPhoto: (person: Person) => boolean, now: DateParts): Gap[] {
  const found = new Map<GapKind, Gap['people']>(ORDER.map((kind) => [kind, []]));
  const add = (kind: GapKind, person: Person, detail?: string) =>
    found.get(kind)!.push(detail === undefined ? { person } : { person, detail });

  const connected = mainBranch(family);
  const people = family.people().sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  for (const person of people) {
    // A stand-in needs a name first; dates and a photo come with the real person.
    if (isStandIn(person)) {
      add('standIn', person, person.name);
      continue;
    }
    if (person.stub) add('undeclared', person);
    if (!connected.has(person.id)) add('disconnected', person);
    if (!person.sex) add('noSex', person);

    const born = parseDate(person.born);
    if (!knownDate(person.born)) add('noBirth', person);
    else if (!born?.d) add('partialBirth', person, person.born);

    if (isDeceased(person)) {
      if (!knownDate(person.died)) add('undatedDeath', person);
    } else if (born && now.y - born.y > OLDEST) {
      add('probablyDeceased', person, year(person.born));
    }

    if (!hasPhoto(person)) add('noPhoto', person, person.photo);
  }

  return ORDER.map((kind) => ({ kind, people: found.get(kind)! })).filter((gap) => gap.people.length > 0);
}

/** The biggest group of people linked by parents, children and partners. */
function mainBranch(family: Family): Set<string> {
  let biggest = new Set<string>();
  const seen = new Set<string>();
  for (const start of family.people()) {
    if (seen.has(start.id)) continue;
    const branch = new Set([start.id]);
    for (const id of branch) {
      const next = [
        ...family.parents(id),
        ...family.children(id),
        ...family.partnerships(id).flatMap(({ partner }) => (partner ? [partner] : [])),
      ];
      for (const person of next) branch.add(person.id);
    }
    for (const id of branch) seen.add(id);
    if (branch.size > biggest.size) biggest = branch;
  }
  return biggest;
}
