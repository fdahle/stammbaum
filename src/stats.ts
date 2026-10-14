import type { Family } from './family';
import { isDeceased, knownDate, unionStatus, type Person, type Union } from './parser/types';
import { ageOf, familyName, parseDate, yearsBetween, type DateParts } from './ui/format';

export interface Age {
  person: Person;
  years: number;
  approx: boolean;
}

/** The family in numbers — every record is missing when the file cannot tell. */
export interface Stats {
  people: number;
  living: number;
  deceased: number;
  /** The longest line from an ancestor down to a descendant, both counted. */
  generations: number;
  /** Partnerships that last, married or not. */
  couples: number;
  oldestLiving?: Age;
  youngest?: Person;
  /** Who reached the highest age among the dead. */
  oldestEver?: Age;
  longestMarriage?: { people: Person[]; years: number; lasting: boolean };
  /** Every couple — or lone parent — with the most children, ties included. */
  mostChildren?: { couples: Person[][]; count: number };
  /** The most common of each, all of them on a tie — only when it occurs at least twice. */
  birthplace?: { values: string[]; count: number };
  surname?: { values: string[]; count: number };
  birthMonth?: { values: number[]; count: number };
}

export function familyStats(family: Family, now: DateParts): Stats {
  const people = family.people();
  const living = people.filter((p) => !isDeceased(p));
  const stats: Stats = {
    people: people.length,
    living: living.length,
    deceased: people.length - living.length,
    generations: generations(family),
    couples: family.graph.unions.filter((union) => {
      const partners = partnersOf(family, union);
      const lasting = unionStatus(union) === 'married' || unionStatus(union) === 'together';
      return lasting && partners.length === 2 && !partners.some(isDeceased);
    }).length,
  };

  const ages = people.flatMap((person) => {
    const age = ageOf(person, now);
    return age ? [{ person, ...age }] : [];
  });
  const oldestLiving = oldest(ages.filter((age) => !age.final));
  if (oldestLiving) stats.oldestLiving = oldestLiving;
  const oldestEver = oldest(ages.filter((age) => age.final));
  if (oldestEver) stats.oldestEver = oldestEver;

  const youngest = living
    .flatMap((person) => {
      const born = parseDate(person.born);
      return born ? [{ person, key: born.y * 10_000 + (born.m ?? 0) * 100 + (born.d ?? 0) }] : [];
    })
    .sort((a, b) => b.key - a.key)[0];
  if (youngest) stats.youngest = youngest.person;

  const marriage = longestMarriage(family, now);
  if (marriage) stats.longestMarriage = marriage;

  const count = Math.max(0, ...family.graph.unions.map((u) => u.children.length));
  if (count > 0) {
    const winners = family.graph.unions.filter((u) => u.children.length === count);
    stats.mostChildren = { couples: winners.map((u) => partnersOf(family, u)), count };
  }

  const birthplace = mostCommon(people.map((p) => p.birthplace));
  if (birthplace) stats.birthplace = birthplace;
  const surname = mostCommon(people.map((p) => familyName(p) || undefined));
  if (surname) stats.surname = surname;
  const birthMonth = mostCommon(people.map((p) => parseDate(p.born)?.m));
  if (birthMonth) stats.birthMonth = birthMonth;
  return stats;
}

/** Counts people down the longest line of parents and children. */
function generations(family: Family): number {
  const depth = new Map<string, number>();
  const visit = (id: string, path: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // Someone listed as their own ancestor: the file warns, the count stops.
    if (path.has(id)) return 0;
    path.add(id);
    const below = family.children(id).map((child) => visit(child.id, path));
    path.delete(id);
    const result = 1 + Math.max(0, ...below);
    depth.set(id, result);
    return result;
  };
  return Math.max(0, ...family.people().map((person) => visit(person.id, new Set())));
}

function oldest(ages: Age[]): Age | undefined {
  return [...ages].sort((a, b) => b.years - a.years || Number(a.approx) - Number(b.approx))[0];
}

/**
 * From the wedding to the divorce, to the first partner's death, or to today.
 * A marriage whose end is known but not its date cannot be measured.
 */
function longestMarriage(family: Family, now: DateParts): Stats['longestMarriage'] {
  let best: Stats['longestMarriage'];
  for (const union of family.graph.unions) {
    const start = parseDate(knownDate(union.married));
    const people = partnersOf(family, union);
    if (!start || people.length !== 2) continue;
    let end: DateParts | undefined = now;
    let lasting = true;
    if (union.divorced !== undefined || union.separated !== undefined) {
      end = parseDate(knownDate(union.divorced) ?? knownDate(union.separated));
      lasting = false;
    } else if (people.some(isDeceased)) {
      const deaths = people.filter(isDeceased).map((p) => parseDate(knownDate(p.died)));
      end = deaths.some((d) => !d) ? undefined : deaths.sort((a, b) => a!.y - b!.y)[0];
      lasting = false;
    }
    const years = end && yearsBetween(start, end)?.years;
    if (years !== undefined && (!best || years > best.years)) best = { people, years, lasting };
  }
  return best;
}

function partnersOf(family: Family, union: Union): Person[] {
  return union.partners.map((id) => family.person(id)).filter((p): p is Person => p !== undefined);
}

function mostCommon<T>(values: Array<T | undefined>): { values: T[]; count: number } | undefined {
  const counts = new Map<T, number>();
  for (const value of values) if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  const count = Math.max(0, ...counts.values());
  if (count < 2) return undefined;
  return { values: [...counts].filter(([, n]) => n === count).map(([value]) => value), count };
}
