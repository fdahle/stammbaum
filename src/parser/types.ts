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
  /** What they do, or did, for a living. */
  job?: string;
  /** Where they live now. */
  lives?: string;
  /** More pictures for the gallery in the detail view, next to `photo`. */
  photos?: string[];
  /** True when the person was only referenced by a relation, never declared. */
  stub?: boolean;
}

export type Sex = 'm' | 'f';

/** A partnership. Divorce and remarriage are modelled as separate unions. */
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
 * `divorced=true`, `together=?`, a bare `married=` — the partnership is a fact,
 * the date is unknown or beside the point. The state still counts; the date is
 * simply not there, so nothing is printed for it.
 */
const UNDATED = new Set(['', '?', 'true', 'yes', 'ja', 'x']);

function date(value: string | undefined): string | undefined {
  return value === undefined || UNDATED.has(value.toLowerCase()) ? undefined : value;
}

/** When the partnership began, whether or not it was a marriage. */
export function unionStart(union: Union): string | undefined {
  return date(union.married) ?? date(union.together);
}

/** When it ended, or `undefined` while it lasts — or while the date is unknown. */
export function unionEnd(union: Union): string | undefined {
  return date(union.divorced) ?? date(union.separated);
}

export interface Diagnostic {
  line: number;
  message: string;
  text: string;
}

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
