import { t } from '../i18n';
import { isDeceased, knownDate, type Person } from '../parser/types';

/**
 * What a stand-in is to whoever is looking — "Urgroßmutter" rather than
 * "Mutter von Erna". The app sets it (main.ts), since it knows who looks.
 */
let standInWord: (person: Person) => string | undefined = () => undefined;

export function nameStandIns(word: (person: Person) => string | undefined): void {
  standInWord = word;
}

/** What we call someone in a bubble: the nickname if the family uses one. */
export function shortName(person: Person): string {
  if (isStandIn(person)) return standInWord(person) ?? person.name.split(' ')[0]!;
  return person.nick ?? person.name.split(' ')[0]!;
}

export function familyName(person: Person): string {
  // A stand-in has no surname: "unbekannt" under what they are to the viewer.
  if (isStandIn(person) && standInWord(person)) return t().unknownPerson;
  const parts = person.name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

/** The full name, with the name the family calls them in between: "Alexandra (Trini) Unger". */
export function displayName(person: Person): string {
  if (isStandIn(person)) {
    const word = standInWord(person);
    return word ? `${word} (${t().unknownPerson})` : person.name;
  }
  const [first, ...rest] = person.name.split(' ');
  if (!person.nick || person.nick === first) return person.name;
  return [first, `(${person.nick})`, ...rest].join(' ');
}

/**
 * "Mutter von Felix", "Parents of Anna": someone the app put in for a parent
 * nobody has named yet. Once they get a real name they are anyone else.
 */
const STAND_IN = /^(Mutter|Vater|Eltern|Elternteil|Mother|Father|Parents?) (von|of) \S/;

export function isStandIn(person: Person): boolean {
  return STAND_IN.test(person.name);
}

/** "KB" for Klaus Bauer — and a question mark for a stand-in, who has no name yet. */
export function initials(person: Person): string {
  if (isStandIn(person)) return '?';
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

/**
 * How current the family on screen is: `Stand 14.10.2026, 11:42` when it is
 * read live, `Erstellt 11.09.2026, 14:05 · Daten 5dc071f` for a built copy.
 */
export function buildStamp(builtAt: string, stamp: { updated?: string; commit?: string }): string {
  const format = (iso: string) => new Date(iso).toLocaleString(t().locale, { dateStyle: 'medium', timeStyle: 'short' });
  return stamp.updated ? t().asOf(format(stamp.updated)) : t().built(format(builtAt), stamp.commit ?? '');
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
 * A year counts as full on the day the date comes round — a 29 February on
 * the 28th in other years, as for the birthday itself.
 */
export function yearsBetween(from: DateParts, until: DateParts): { years: number; approx: boolean } | undefined {
  let years = until.y - from.y;
  let approx = false;
  const day = from.d === undefined ? undefined : anniversaryIn(from, until.y).d;
  if (from.m === undefined || until.m === undefined) approx = true;
  else if (until.m < from.m) years--;
  else if (until.m === from.m) {
    if (day === undefined || until.d === undefined) approx = true;
    else if (until.d < day) years--;
  }
  return years < 0 ? undefined : { years, approx };
}

/** Nobody in a family file is that old — a death date is simply missing. */
export const OLDEST = 110;

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
  if (isDeceased(person) || !born?.m || !born.d) return false;
  const day = anniversaryIn(born, now.y);
  return day.m === now.m && day.d === now.d;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** The day a full date comes round in year `y` — a 29 February on the 28th in other years. */
export function anniversaryIn(date: DateParts, y: number): Required<DateParts> {
  const m = date.m ?? 1;
  const d = date.d ?? 1;
  return m === 2 && d === 29 && !isLeapYear(y) ? { y, m: 2, d: 28 } : { y, m, d };
}

/** A stable pastel per person, used when there is no photo. */
export function avatarHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
