import { t } from '../i18n';
import { isDeceased, knownDate, type Person } from '../parser/types';

/** What we call someone in a bubble: the nickname if the family uses one. */
export function shortName(person: Person): string {
  return person.nick ?? person.name.split(' ')[0]!;
}

export function familyName(person: Person): string {
  const parts = person.name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

export function initials(person: Person): string {
  return person.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toUpperCase();
}

const YEAR = /^(\d{4})/;

export function year(date: string | undefined): string {
  return date ? (YEAR.exec(date)?.[1] ?? date) : '';
}

/** `1931 – 2011`, `* 1986`, `1920 – †` with no death date, or nothing at all. */
export function lifespan(person: Person): string {
  const born = year(knownDate(person.born));
  const died = year(knownDate(person.died));
  if (born && died) return `${born} – ${died}`;
  if (died) return `† ${died}`;
  if (born) return isDeceased(person) ? `${born} – †` : `* ${born}`;
  return isDeceased(person) ? '†' : '';
}

/** `2. April 1931` or `2 April 1931` — full dates for the detail view. */
export function longDate(date: string | undefined): string {
  if (!date) return '';
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(date);
  if (!match) return date;
  const [, y, m, d] = match;
  if (!m) return y!;
  const month = t().months[Number(m) - 1] ?? m;
  return t().longDate(d ? Number(d) : undefined, month, y!);
}

/** `Erstellt 11.09.2026, 14:05 · Daten 5dc071f` — when, and from what, this page was built. */
export function buildStamp(builtAt: string, commit: string): string {
  const when = new Date(builtAt).toLocaleString(t().locale, { dateStyle: 'medium', timeStyle: 'short' });
  return t().built(when, commit);
}

// ---- ages -----------------------------------------------------------------

/** A date as far as the file knows it: the year always, month and day maybe. */
export interface DateParts {
  y: number;
  m?: number;
  d?: number;
}

/** `1956`, `1956-04`, `1956-04-02` — anything else is not a date to count with. */
export function parseDate(date: string | undefined): DateParts | undefined {
  const match = date ? /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(date) : null;
  if (!match) return undefined;
  const [, y, m, d] = match;
  return { y: Number(y), ...(m ? { m: Number(m) } : {}), ...(d ? { d: Number(d) } : {}) };
}

export function today(now = new Date()): DateParts {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/**
 * Whole years from `from` to `until`. With only a year on either side the
 * birthday may or may not have passed yet, so the answer is marked `approx`.
 */
export function yearsBetween(from: DateParts, until: DateParts): { years: number; approx: boolean } | undefined {
  let years = until.y - from.y;
  let approx = false;
  if (from.m === undefined || until.m === undefined) approx = true;
  else if (until.m < from.m) years--;
  else if (until.m === from.m) {
    if (from.d === undefined || until.d === undefined) approx = true;
    else if (until.d < from.d) years--;
  }
  return years < 0 ? undefined : { years, approx };
}

/** Nobody in a family file is that old — a death date is simply missing. */
const OLDEST = 110;

/** How old someone is, or was when they died. */
export function ageOf(person: Person, now: DateParts): { years: number; approx: boolean; final: boolean } | undefined {
  const born = parseDate(person.born);
  if (!born) return undefined;
  if (isDeceased(person)) {
    const died = parseDate(person.died);
    const age = died && yearsBetween(born, died);
    return age ? { ...age, final: true } : undefined;
  }
  const age = yearsBetween(born, now);
  return age && age.years <= OLDEST ? { ...age, final: false } : undefined;
}

export function hasBirthday(person: Person, now: DateParts): boolean {
  const born = parseDate(person.born);
  return person.died === undefined && !!born && born.m === now.m && born.d === now.d;
}

/** A stable pastel per person, used when there is no photo. */
export function avatarHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
