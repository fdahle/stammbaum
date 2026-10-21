/** A single human being in the tree. */
export interface Person {
  id: string;
  name: string;
  /** Free-form, but ISO-ish (`1956`, `1956-04`, `1956-04-02`) renders best. */
  born?: string;
  died?: string;
  /** File name inside the `photos/` folder next to `family.md`, e.g. `heinrich.jpg`. */
  photo?: string;
  /** Maiden name, shown in the detail view as "geb. Vogt". */
  maiden?: string;
  /** Only used to pick the word for a relation: Onkel or Tante. */
  sex?: Sex;
  /** Nickname — what the family actually calls them. */
  nick?: string;
  note?: string;
  birthplace?: string;
  deathplace?: string;
  /** What they died of — shown only where a viewer has not hidden it (see prefs.ts). */
  deathcause?: string;
  /** Countries as ISO codes (`DE`), or as written when there is none — see countries.ts. */
  birthcountry?: string;
  deathcountry?: string;
  /** The country they live in now, next to `lives`. */
  country?: string;
  /** Their nationalities, comma-separated: `DE, NL`. */
  nationality?: string;
  /** What they do, or did, for a living. */
  job?: string;
  /** Where they live now. */
  lives?: string;
  /** More pictures for the gallery in the detail view, next to `photo`. */
  photos?: string[];
  /** True when the person was only referenced by a relation, never declared. */
  stub?: boolean;
  /** Where the `person` line is in family.md, for warnings about them. */
  line?: number;
}

/** `died=1990`, but also `died=?` or `died=true` when nobody knows when. */
export function isDeceased(person: Person): boolean {
  return person.died !== undefined;
}

export type Sex = 'm' | 'f';

/**
 * A partnership. Divorce and remarriage are modelled as separate unions — even
 * when the same two people marry again, which gives the second one an id of
 * `a+b~2`.
 */
export interface Union {
  id: string;
  /** One or two people. A single partner means "other parent unknown". */
  partners: string[];
  married?: string;
  divorced?: string;
  /** Start of an unmarried relationship — `together` instead of `married`. */
  together?: string;
  /** End of an unmarried relationship — `separated` instead of `divorced`. */
  separated?: string;
  children: string[];
  /** The children who were adopted — every one of them is in `children` too. */
  adopted?: string[];
  /** The family.md lines that make up this partnership, for the writer. */
  lines?: number[];
}

/**
 * A partnership is a start (`married` or `together`) and an optional end
 * (`divorced` or `separated`), which gives four states.
 */
export type UnionStatus = 'married' | 'together' | 'divorced' | 'separated';

/** A bare `a + b` counts as a marriage, the way the file has always meant it. */
export function unionStatus(union: Union): UnionStatus {
  const unmarried = union.married === undefined && union.together !== undefined;
  if (union.separated !== undefined) return unmarried ? 'separated' : 'divorced';
  if (union.divorced !== undefined) return 'divorced';
  return unmarried ? 'together' : 'married';
}

/**
 * `divorced=true`, `died=?`, a bare `married=` — the event is a fact, the date
 * is unknown or beside the point. The state still counts; the date is simply
 * not there, so nothing is printed for it.
 */
const UNDATED = new Set(['', '?', 'true', 'yes', 'ja', 'x']);

/** The date as written, or `undefined` when there is none to print. */
export function knownDate(value: string | undefined): string | undefined {
  return value === undefined || UNDATED.has(value.toLowerCase()) ? undefined : value;
}

/** When the partnership began, whether or not it was a marriage. */
export function unionStart(union: Union): string | undefined {
  return knownDate(union.married) ?? knownDate(union.together);
}

/** When it ended, or `undefined` while it lasts — or while the date is unknown. */
export function unionEnd(union: Union): string | undefined {
  return knownDate(union.divorced) ?? knownDate(union.separated);
}

/** What a warning is about, for the app to say in its own language. */
export type DiagnosticCode =
  | 'me-arity'
  | 'me-unknown'
  | 'unrecognised'
  | 'undeclared'
  | 'person-id'
  | 'duplicate'
  | 'person-key'
  | 'sex'
  | 'relation-start'
  | 'partner-missing'
  | 'relation-ids'
  | 'relation-key'
  | 'key-value'
  | 'died-before-born'
  | 'born-before-parent'
  | 'own-ancestor'
  | 'photo-missing';

export interface Diagnostic {
  line: number;
  /** In English — for the server, the tests, and any warning without a `code`. */
  message: string;
  text: string;
  code?: DiagnosticCode | undefined;
  /** The names and values the message mentions, by name. */
  params?: Record<string, string> | undefined;
}

/** How the parser reports a warning on the line it is reading. */
export type Warn = (message: string, code?: DiagnosticCode, params?: Record<string, string>) => void;

export interface FamilyGraph {
  title: string;
  /** Whose point of view relations are named from — the `me` line. */
  me?: string;
  people: Map<string, Person>;
  unions: Union[];
  warnings: Diagnostic[];
}

/** Stable id for a partnership, independent of the order partners were written. */
export function unionId(partners: string[]): string {
  return [...partners].sort().join('+');
}
