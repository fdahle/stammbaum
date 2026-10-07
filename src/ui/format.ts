import { t } from '../i18n';
import type { Person } from '../parser/types';

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

/** `1931 – 2011`, `* 1986`, or nothing at all. */
export function lifespan(person: Person): string {
  const born = year(person.born);
  const died = year(person.died);
  if (born && died) return `${born} – ${died}`;
  if (died) return `† ${died}`;
  if (born) return `* ${born}`;
  return '';
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

//** A stable pastel per person, used when there is no photo. */
export function avatarHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
