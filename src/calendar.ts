import type { Family } from './family';
import { isDeceased, unionStatus, type Person } from './parser/types';
import { anniversaryIn, OLDEST, parseDate, type DateParts } from './ui/format';

/** A birthday or a partnership's anniversary coming up. */
export interface Occasion {
  kind: 'birthday' | 'married' | 'together';
  /** The person whose birthday it is, or the couple. */
  people: Person[];
  /** The day it falls on. */
  date: Required<DateParts>;
  /** Days from today: 0 is today. */
  days: number;
  /** The age they turn, or how many years the partnership has lasted. */
  years: number;
}

/**
 * Everything to congratulate someone on within the next `span` days: the
 * birthdays of the living, and the anniversaries of partnerships that last
 * and whose partners are both alive. Only full dates count.
 */
export function upcoming(family: Family, now: DateParts, span = 30): Occasion[] {
  const occasions: Occasion[] = [];
  const add = (kind: Occasion['kind'], people: Person[], date: string | undefined) => {
    const start = parseDate(date);
    if (!start?.m || !start.d) return;
    const next = nextOccurrence(start, now);
    const years = next.y - start.y;
    const days = daysBetween(now, next);
    if (years <= 0 || days > span) return;
    if (kind === 'birthday' && years > OLDEST) return;
    occasions.push({ kind, people, date: next, days, years });
  };

  for (const person of family.people()) {
    if (!isDeceased(person)) add('birthday', [person], person.born);
  }
  for (const union of family.graph.unions) {
    const status = unionStatus(union);
    if (status !== 'married' && status !== 'together') continue;
    const partners = union.partners.map((id) => family.person(id));
    if (partners.length !== 2 || partners.some((p) => !p || isDeceased(p))) continue;
    add(status, partners as Person[], status === 'married' ? union.married : union.together);
  }

  return occasions.sort(
    (a, b) => a.days - b.days || a.people[0]!.name.localeCompare(b.people[0]!.name),
  );
}

/** The next time `date` comes round, today included. */
function nextOccurrence(date: DateParts, now: DateParts): Required<DateParts> {
  const thisYear = anniversaryIn(date, now.y);
  return daysBetween(now, thisYear) >= 0 ? thisYear : anniversaryIn(date, now.y + 1);
}

function daysBetween(from: DateParts, to: Required<DateParts>): number {
  const start = Date.UTC(from.y, (from.m ?? 1) - 1, from.d ?? 1);
  return Math.round((Date.UTC(to.y, to.m - 1, to.d) - start) / 86_400_000);
}
