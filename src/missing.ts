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

/**
 * Pairs that are most likely the same person entered twice: the same name —
 * or one's birth name with the other's first name — and nothing that tells
 * them apart: no different sex, no different year of birth, and not already
 * each other's parent, child or partner.
 */
export function duplicates(family: Family): Array<[Person, Person]> {
  const fold = (text: string) =>
    text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const names = (person: Person): string[] => {
    const full = fold(person.name);
    const first = full.split(' ')[0];
    return person.maiden && first ? [full, `${first} ${fold(person.maiden)}`] : [full];
  };
  const year = (person: Person) => parseDate(person.born)?.y;
  const related = (a: Person, b: Person) =>
    [...family.parents(a.id), ...family.children(a.id), ...family.partnerships(a.id).flatMap((p) => (p.partner ? [p.partner] : []))].some(
      (other) => other.id === b.id,
    );

  const people = family.people().filter((person) => !isStandIn(person) && !person.stub);
  // Only people who share a name are compared — by name, not everyone with everyone.
  const keys = people.map(names);
  const byName = new Map<string, number[]>();
  keys.forEach((own, i) => {
    for (const name of new Set(own)) {
      const list = byName.get(name);
      if (list) list.push(i);
      else byName.set(name, [i]);
    }
  });
  const pairs: Array<[Person, Person]> = [];
  for (let i = 0; i < people.length; i++) {
    const alike = new Set(keys[i]!.flatMap((name) => byName.get(name)!.filter((j) => j > i)));
    for (const j of [...alike].sort((x, y) => x - y)) {
      const a = people[i]!;
      const b = people[j]!;
      if (a.sex && b.sex && a.sex !== b.sex) continue;
      if (year(a) && year(b) && year(a) !== year(b)) continue;
      if (related(a, b)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}
