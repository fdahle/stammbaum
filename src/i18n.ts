import type { UnionStatus } from './parser/types';
import { readStored, writeStored } from './ui/storage';

/**
 * The two languages the app speaks. The family file itself — names, notes,
 * places — is shown as written; only the app's own words are translated.
 */
export type Lang = 'de' | 'en';
export const LANGS: ReadonlyArray<{ id: Lang; label: string }> = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
];

const approx = (prefix: string, value: number, is: boolean) => `${is ? prefix : ''}${value}`;

const de = {
  locale: 'de-DE',
  months: [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ],
  /** `2. April 1931`, `April 1931`. */
  longDate: (day: number | undefined, month: string, year: string) =>
    day === undefined ? `${month} ${year}` : `${day}. ${month} ${year}`,
  built: (when: string, commit: string) => (commit ? `Erstellt ${when} · Daten ${commit}` : `Erstellt ${when}`),

  description: 'Stammbaum — wer ist noch mal wer?',
  back: 'Zurück zur Übersicht',
  search: 'Person suchen',
  searchPlaceholder: 'Wer ist das?',
  hintTouch: 'Ziehen zum Bewegen · zwei Finger zum Zoomen · tippen für eine Person',
  hintMouse: 'Ziehen zum Bewegen · Mausrad zum Zoomen · Klick für eine Person',
  warnings: (count: number) => `${count} ${count === 1 ? 'Hinweis' : 'Hinweise'} in family.md`,
  warningLine: (line: number, message: string) => `Zeile ${line}: ${message}`,
  moreWarnings: (count: number) => `… und ${count} weitere`,

  menu: 'Einstellungen',
  iAm: 'Ich bin',
  nobody: 'Niemand ausgewählt',
  iAmHint: 'Alle werden mit ihrer Verwandtschaft zu dir beschriftet.',
  whoAreYou: 'Wer bist du?',
  noneOfThem: 'Niemand davon',
  language: 'Sprache',
  appearance: 'Darstellung',
  modes: { system: 'Automatisch', light: 'Hell', dark: 'Dunkel' },
  findRelation: 'Verwandtschaft finden',
  pickFirst: 'Wessen Verwandtschaft?',
  pickOther: (name: string) => `${name} ist verwandt mit …`,
  close: 'Schließen',
  pickerPlaceholder: 'Name, Ort, Verwandtschaft …',
  noMatches: 'Niemand gefunden.',

  fit: 'Ganzen Stammbaum zeigen',
  ancestorsOf: (name: string) => `Vorfahren von ${name}`,
  descendantsOf: (name: string) => `Nachkommen von ${name}`,

  parents: 'Eltern',
  child: 'Kind',
  children: 'Kinder',
  withPartner: (name: string) => `mit ${name}`,
  noRelatives: 'Keine Verwandten in der Datei hinterlegt.',
  nee: (name: string) => `geb. ${name}`,
  status: {
    married: 'verheiratet',
    together: 'zusammen',
    divorced: 'geschieden',
    separated: 'getrennt',
  } satisfies Record<UnionStatus, string>,
  since: (year: string) => `seit ${year}`,
  /** How long a lasting partnership has gone on, inside its pill. */
  yearsTogether: (years: number) => `${years} J.`,
  inPlace: (place: string) => `in ${place}`,
  age: (years: number, isApprox: boolean) => `${approx('etwa ', years, isApprox)} Jahre`,
  ageAtDeath: (years: number, isApprox: boolean) => `wurde ${approx('etwa ', years, isApprox)} Jahre alt`,
  birthdayToday: 'Hat heute Geburtstag!',
  lives: (place: string) => `Wohnt in ${place}`,
  adopted: 'Adoptiert',
  photo: (n: number, of: number) => `Foto ${n} von ${of}`,
  previousPhoto: 'Voriges Foto',
  nextPhoto: 'Nächstes Foto',
  ancestors: 'Vorfahren',
  descendants: 'Nachkommen',
  relatedTo: 'Verwandt mit …',
  howAreWeRelated: 'Wie sind wir verwandt?',
  thisIsMe: 'Das bin ich',

  isTo: (from: string, to: string) => `Für ${from} ist ${to}`,
  noTerm: 'keine eigene Bezeichnung',
  samePerson: 'Das ist zweimal dieselbe Person.',
  notConnected: 'Die beiden sind im Stammbaum nicht miteinander verbunden.',
  path: 'Der Weg',
  pathHint: 'Jeder Schritt sagt, was die Person für die vorige ist.',
  showInTree: 'Im Stammbaum zeigen',
  change: 'Ändern',
  swap: 'Tauschen',
};

type Dict = typeof de;

const en: Dict = {
  locale: 'en-GB',
  months: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  longDate: (day, month, year) => (day === undefined ? `${month} ${year}` : `${day} ${month} ${year}`),
  built: (when, commit) => (commit ? `Built ${when} · data ${commit}` : `Built ${when}`),

  description: 'Family tree — who was who again?',
  back: 'Back to the tree',
  search: 'Find a person',
  searchPlaceholder: 'Who is that?',
  hintTouch: 'Drag to move · two fingers to zoom · tap a person',
  hintMouse: 'Drag to move · scroll to zoom · click a person',
  warnings: (count) => `${count} ${count === 1 ? 'note' : 'notes'} on family.md`,
  warningLine: (line, message) => `Line ${line}: ${message}`,
  moreWarnings: (count) => `… and ${count} more`,

  menu: 'Settings',
  iAm: 'I am',
  nobody: 'Nobody chosen',
  iAmHint: 'Everyone is labelled with how they are related to you.',
  whoAreYou: 'Who are you?',
  noneOfThem: 'None of them',
  language: 'Language',
  appearance: 'Appearance',
  modes: { system: 'Automatic', light: 'Light', dark: 'Dark' },
  findRelation: 'Find a relationship',
  pickFirst: 'Whose relationship?',
  pickOther: (name) => `${name} is related to …`,
  close: 'Close',
  pickerPlaceholder: 'Name, place, relationship …',
  noMatches: 'Nobody found.',

  fit: 'Show the whole tree',
  ancestorsOf: (name) => `Ancestors of ${name}`,
  descendantsOf: (name) => `Descendants of ${name}`,

  parents: 'Parents',
  child: 'Child',
  children: 'Children',
  withPartner: (name) => `with ${name}`,
  noRelatives: 'No relatives in the file.',
  nee: (name) => `née ${name}`,
  status: {
    married: 'married',
    together: 'together',
    divorced: 'divorced',
    separated: 'separated',
  },
  since: (year) => `since ${year}`,
  yearsTogether: (years) => `${years} y`,
  inPlace: (place) => `in ${place}`,
  age: (years, isApprox) => `${approx('about ', years, isApprox)} years old`,
  ageAtDeath: (years, isApprox) => `died aged ${approx('about ', years, isApprox)}`,
  birthdayToday: 'Birthday today!',
  lives: (place) => `Lives in ${place}`,
  adopted: 'Adopted',
  photo: (n, of) => `Photo ${n} of ${of}`,
  previousPhoto: 'Previous photo',
  nextPhoto: 'Next photo',
  ancestors: 'Ancestors',
  descendants: 'Descendants',
  relatedTo: 'Related to …',
  howAreWeRelated: 'How are we related?',
  thisIsMe: 'This is me',

  isTo: (from, to) => `To ${from}, ${to} is`,
  noTerm: 'no word of its own',
  samePerson: 'That is the same person twice.',
  notConnected: 'The two are not connected in the tree.',
  path: 'The path',
  pathHint: 'Each step says what that person is to the one before.',
  showInTree: 'Show in the tree',
  change: 'Change',
  swap: 'Swap',
};

const DICTS: Record<Lang, Dict> = { de, en };

let current: Lang = initialLang();

/** The words of the current language: `t().parents`, `t().since('1956')`. */
export function t(): Dict {
  return DICTS[current];
}

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  writeStored('stammbaum-lang', next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** A remembered choice first, then the browser's own language; German is home. */
function initialLang(): Lang {
  const stored = readStored('stammbaum-lang');
  if (stored === 'de' || stored === 'en') return stored;
  if (typeof navigator === 'undefined') return 'de';
  const preferred = navigator.languages?.[0] ?? navigator.language ?? 'de';
  return preferred.toLowerCase().startsWith('de') ? 'de' : 'en';
}
