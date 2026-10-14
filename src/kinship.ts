import type { Family } from './family';
import type { Lang } from './i18n';
import { unionStatus, type Person, type UnionStatus } from './parser/types';
import { shortName } from './ui/format';

/**
 * What `to` is to `from`: "Tante", "Cousine 2. Grades", "Mann der Cousine" —
 * or "Aunt", "Second cousin", "Cousin's husband". Blood relations are named
 * from the nearest common ancestor; in-laws are one partnership away from a
 * blood relative. Step-siblings and the Schwippschwager have words of their
 * own too. Anyone further out is `undefined`.
 */
export function relation(family: Family, from: string, to: string, lang: Lang = 'de'): string | undefined {
  const target = family.person(to);
  if (!target) return undefined;
  const words = LEXICONS[lang];
  const kin = blood(family, from, to);
  if (kin) return say(words.blood(kin), target);
  return (
    partnerOfRelative(family, from, target, words) ??
    relativeOfPartner(family, from, target, words) ??
    stepSibling(family, from, target, words) ??
    coSiblingInLaw(family, from, target, words)
  );
}

// ---- blood ----------------------------------------------------------------

/** Generations from `from` up to the common ancestor, and from there down to `to`. */
interface Blood {
  up: number;
  down: number;
  half: boolean;
}

function blood(family: Family, from: string, to: string): Blood | undefined {
  const theirs = ancestry(family, to);
  let best: Blood | undefined;
  for (const [id, up] of ancestry(family, from)) {
    const down = theirs.get(id);
    if (down === undefined || (best && best.up + best.down <= up + down)) continue;
    best = { up, down, half: false };
  }
  // Siblings from different partnerships share one parent, not both.
  if (best?.up === 1 && best.down === 1) {
    best.half = family.parentUnion(from) !== family.parentUnion(to);
  }
  return best;
}

/** Everyone above `id`, by how many generations up they are — `id` itself at 0. */
function ancestry(family: Family, id: string): Map<string, number> {
  const depth = new Map([[id, 0]]);
  // A Map iterator also visits entries added while it runs: breadth-first for free.
  for (const [current, generation] of depth) {
    for (const parent of family.parents(current)) {
      if (!depth.has(parent.id)) depth.set(parent.id, generation + 1);
    }
  }
  return depth;
}

// ---- in-laws --------------------------------------------------------------

/** `to` is, or was, the partner of one of `from`'s blood relatives. */
function partnerOfRelative(family: Family, from: string, to: Person, words: Lexicon): string | undefined {
  const link = closest(family.partnerships(to.id), (partner) => blood(family, from, partner.id));
  if (!link) return undefined;
  const { kin, partner: relative, status } = link;
  if (kin.up === 0 && kin.down === 0) return say(status === 'married' ? words.spouse : words.partner[status], to);
  if (!ended(status)) {
    if (kin.up === 1 && kin.down === 0) return say(words.stepParent, to);
    if (kin.up === 0 && kin.down === 1) return say(words.childInLaw, to);
    if (kin.up === 1 && kin.down === 1) return say(words.siblingInLaw, to);
    // The aunt's husband is an uncle too.
    if (kin.down === 1) return say(words.blood(kin), to);
  }
  return words.of(words.partner[status], to, words.blood(kin), relative);
}

/** `to` is a blood relative of `from`'s partner, current or former. */
function relativeOfPartner(family: Family, from: string, to: Person, words: Lexicon): string | undefined {
  const link = closest(family.partnerships(from), (partner) => blood(family, partner.id, to.id));
  if (!link) return undefined;
  const { kin, partner, status } = link;
  const ex = ended(status);
  if (kin.up === 1 && kin.down === 0) return say(ex ? words.ex(words.parentInLaw) : words.parentInLaw, to);
  if (kin.up === 1 && kin.down === 1) return say(ex ? words.ex(words.siblingInLaw) : words.siblingInLaw, to);
  if (kin.up === 0 && kin.down === 1 && !ex) return say(words.stepChild, to);
  return words.of(words.blood(kin), to, words.partner[status], partner);
}

/** The partnership whose partner is the nearest blood relative. */
function closest(
  partnerships: ReturnType<Family['partnerships']>,
  kinOf: (partner: Person) => Blood | undefined,
): { kin: Blood; partner: Person; status: UnionStatus } | undefined {
  let best: { kin: Blood; partner: Person; status: UnionStatus } | undefined;
  for (const { union, partner } of partnerships) {
    const kin = partner && kinOf(partner);
    if (!partner || !kin || (best && best.kin.up + best.kin.down <= kin.up + kin.down)) continue;
    best = { kin, partner, status: unionStatus(union) };
  }
  return best;
}

function ended(status: UnionStatus): boolean {
  return status === 'divorced' || status === 'separated';
}

/** The people `id` is with now — partnerships that ended do not count. */
function currentPartners(family: Family, id: string): Person[] {
  return family
    .partnerships(id)
    .flatMap(({ union, partner }) => (partner && !ended(unionStatus(union)) ? [partner] : []));
}

/** Brothers and sisters, half ones included. */
function siblings(family: Family, id: string): Person[] {
  const all = family.parents(id).flatMap((parent) => family.children(parent.id));
  return [...new Set(all)].filter((sibling) => sibling.id !== id);
}

// ---- step and Schwipp -------------------------------------------------------

/** `to` is the child of a parent's partner, with no parent in common: Stiefbruder. */
function stepSibling(family: Family, from: string, to: Person, words: Lexicon): string | undefined {
  const step = family
    .parents(from)
    .flatMap((parent) => currentPartners(family, parent.id))
    .some((partner) => family.children(partner.id).some((child) => child.id === to.id));
  return step ? say(words.stepSibling, to) : undefined;
}

/**
 * The partner of a partner's sibling, or the sibling of a sibling's partner:
 * the Schwippschwager, one step past the Schwager in either direction.
 */
function coSiblingInLaw(family: Family, from: string, to: Person, words: Lexicon): string | undefined {
  if (from === to.id) return undefined;
  const viaPartner = currentPartners(family, from)
    .flatMap((partner) => siblings(family, partner.id))
    .some((sibling) => currentPartners(family, sibling.id).some((p) => p.id === to.id));
  const viaSibling = siblings(family, from)
    .flatMap((sibling) => currentPartners(family, sibling.id))
    .some((partner) => siblings(family, partner.id).some((s) => s.id === to.id));
  return viaPartner || viaSibling ? say(words.coSiblingInLaw, to) : undefined;
}

// ---- words ----------------------------------------------------------------

/** One word for a man and for a woman, plus a neutral one where the language has it. */
interface Term {
  m: string;
  f: string;
  x?: string;
}

/** Everything that differs between the languages; the structure above does not. */
interface Lexicon {
  blood(kin: Blood): Term;
  spouse: Term;
  partner: Record<UnionStatus, Term>;
  stepParent: Term;
  stepChild: Term;
  parentInLaw: Term;
  childInLaw: Term;
  siblingInLaw: Term;
  stepSibling: Term;
  /** Schwippschwager: a partner's sibling's partner, a sibling's partner's sibling. */
  coSiblingInLaw: Term;
  ex(term: Term): Term;
  /** `term` (what `person` is) of `relative`, who is `relativeTerm`: "Mann der Cousine", "Cousin's husband". */
  of(term: Term, person: Person, relativeTerm: Term, relative: Person): string;
}

function say(term: Term, person: Person): string {
  if (person.sex) return term[person.sex];
  // The break opportunity keeps "Großonkel/Großtante" inside a narrow tile.
  return term.x ?? `${term.m}/​${term.f}`;
}

function prefixed(term: Term, prefix: string): Term {
  if (prefix === '') return term;
  // "Ex-Schwager" keeps its capital; "Großonkel" does not.
  const join = (word: string) => prefix + (prefix.endsWith('-') ? word : word.charAt(0).toLowerCase() + word.slice(1));
  return map(term, join);
}

function suffixed(term: Term, suffix: string): Term {
  return map(term, (word) => word + suffix);
}

function map(term: Term, change: (word: string) => string): Term {
  const changed: Term = { m: change(term.m), f: change(term.f) };
  if (term.x !== undefined) changed.x = change(term.x);
  return changed;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---- German ---------------------------------------------------------------

const DE = {
  self: { m: 'Ich', f: 'Ich', x: 'Ich' },
  parent: { m: 'Vater', f: 'Mutter', x: 'Elternteil' },
  child: { m: 'Sohn', f: 'Tochter', x: 'Kind' },
  grandchild: { m: 'Enkel', f: 'Enkelin', x: 'Enkelkind' },
  sibling: { m: 'Bruder', f: 'Schwester', x: 'Geschwister' },
  uncle: { m: 'Onkel', f: 'Tante' },
  nephew: { m: 'Neffe', f: 'Nichte' },
  cousin: { m: 'Cousin', f: 'Cousine', x: 'Cousin(e)' },
} satisfies Record<string, Term>;

/** Groß, Urgroß, Ururgroß — one step per generation. */
function greatPrefix(steps: number): string {
  return steps === 0 ? '' : capitalize(`${'ur'.repeat(steps - 1)}groß`);
}

/** "der Cousine", "des Onkels" — or "von Quin" when the file does not say which. */
function genitivePhrase(term: Term, person: Person): string {
  if (person.sex === 'f') return `der ${term.f}`;
  if (person.sex === 'm') return `des ${genitive(term.m)}`;
  return `von ${shortName(person)}`;
}

/** Inflects the first word: Onkel → Onkels, Neffe → Neffen, Mann → Mannes. */
function genitive(phrase: string): string {
  const [head = '', ...rest] = phrase.split(' ');
  const inflected = head.endsWith('e') ? `${head}n` : /mann$/i.test(head) ? `${head}es` : `${head}s`;
  return [inflected, ...rest].join(' ');
}

const GERMAN: Lexicon = {
  blood({ up, down, half }) {
    if (up === 0 && down === 0) return DE.self;
    if (down === 0) return prefixed(DE.parent, greatPrefix(up - 1));
    if (up === 0) return down === 1 ? DE.child : prefixed(DE.grandchild, capitalize('ur'.repeat(down - 2)));
    if (up === 1 && down === 1) return half ? prefixed(DE.sibling, 'Halb') : DE.sibling;
    if (down === 1) return prefixed(DE.uncle, greatPrefix(up - 2));
    if (up === 1) return prefixed(DE.nephew, greatPrefix(down - 2));
    const degree = Math.min(up, down) - 1;
    const removed = Math.abs(up - down);
    if (degree === 1 && removed === 0) return DE.cousin;
    // A cousin's child and a parent's cousin — the colloquial word for both.
    if (degree === 1 && removed === 1) return prefixed(DE.cousin, 'Groß');
    return suffixed(DE.cousin, ` ${degree}. Grades${removed > 0 ? `, ${removed}× entfernt` : ''}`);
  },
  spouse: { m: 'Ehemann', f: 'Ehefrau', x: 'Ehepartner(in)' },
  partner: {
    married: { m: 'Mann', f: 'Frau', x: 'Ehepartner(in)' },
    together: { m: 'Partner', f: 'Partnerin', x: 'Partner(in)' },
    divorced: { m: 'Ex-Mann', f: 'Ex-Frau', x: 'Ex-Partner(in)' },
    separated: { m: 'Ex-Partner', f: 'Ex-Partnerin', x: 'Ex-Partner(in)' },
  },
  stepParent: { m: 'Stiefvater', f: 'Stiefmutter', x: 'Stiefelternteil' },
  stepChild: { m: 'Stiefsohn', f: 'Stieftochter', x: 'Stiefkind' },
  parentInLaw: { m: 'Schwiegervater', f: 'Schwiegermutter', x: 'Schwiegerelternteil' },
  childInLaw: { m: 'Schwiegersohn', f: 'Schwiegertochter', x: 'Schwiegerkind' },
  siblingInLaw: { m: 'Schwager', f: 'Schwägerin' },
  stepSibling: { m: 'Stiefbruder', f: 'Stiefschwester', x: 'Stiefgeschwister' },
  coSiblingInLaw: { m: 'Schwippschwager', f: 'Schwippschwägerin' },
  ex: (term) => prefixed(term, 'Ex-'),
  of: (term, person, relativeTerm, relative) => `${say(term, person)} ${genitivePhrase(relativeTerm, relative)}`,
};

// ---- English --------------------------------------------------------------

const EN = {
  self: { m: 'Me', f: 'Me', x: 'Me' },
  parent: { m: 'Father', f: 'Mother', x: 'Parent' },
  child: { m: 'Son', f: 'Daughter', x: 'Child' },
  sibling: { m: 'Brother', f: 'Sister', x: 'Sibling' },
  uncle: { m: 'Uncle', f: 'Aunt' },
  nephew: { m: 'Nephew', f: 'Niece' },
  cousin: { m: 'Cousin', f: 'Cousin', x: 'Cousin' },
} satisfies Record<string, Term>;

/** grand, great-grand, great-great-grand — for grandparents and grandchildren. */
function grand(steps: number): string {
  return steps === 0 ? '' : `${'great-'.repeat(steps - 1)}grand`;
}

/** great-, great-great- — for uncles and nephews, which skip the "grand". */
function great(steps: number): string {
  return 'great-'.repeat(steps);
}

function englishPrefixed(term: Term, prefix: string): Term {
  return prefix === '' ? term : map(term, (word) => capitalize(prefix + word.toLowerCase()));
}

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
const TIMES = ['', 'once', 'twice', 'three times', 'four times'];

/** "Cousin's husband", "Husband's aunt" — or "Kim's partner" when the file does not say which. */
function possessive(term: Term, person: Person): string {
  const owner = person.sex ? term[person.sex] : shortName(person);
  return `${owner}${owner.endsWith('s') ? "'" : "'s"}`;
}

const ENGLISH: Lexicon = {
  blood({ up, down, half }) {
    if (up === 0 && down === 0) return EN.self;
    if (down === 0) return englishPrefixed(EN.parent, grand(up - 1));
    if (up === 0) return englishPrefixed(EN.child, grand(down - 1));
    if (up === 1 && down === 1) return half ? englishPrefixed(EN.sibling, 'half-') : EN.sibling;
    if (down === 1) return englishPrefixed(EN.uncle, great(up - 2));
    if (up === 1) return englishPrefixed(EN.nephew, great(down - 2));
    const degree = Math.min(up, down) - 1;
    const removed = Math.abs(up - down);
    const ordinal = degree === 1 ? '' : `${ORDINALS[degree] ?? `${degree}th`} `;
    const distance = removed === 0 ? '' : ` ${TIMES[removed] ?? `${removed} times`} removed`;
    return map(EN.cousin, (word) => capitalize(`${ordinal}${ordinal ? word.toLowerCase() : word}${distance}`));
  },
  spouse: { m: 'Husband', f: 'Wife', x: 'Spouse' },
  partner: {
    married: { m: 'Husband', f: 'Wife', x: 'Spouse' },
    together: { m: 'Partner', f: 'Partner', x: 'Partner' },
    divorced: { m: 'Ex-husband', f: 'Ex-wife', x: 'Ex-spouse' },
    separated: { m: 'Ex-partner', f: 'Ex-partner', x: 'Ex-partner' },
  },
  stepParent: { m: 'Stepfather', f: 'Stepmother', x: 'Step-parent' },
  stepChild: { m: 'Stepson', f: 'Stepdaughter', x: 'Stepchild' },
  parentInLaw: { m: 'Father-in-law', f: 'Mother-in-law', x: 'Parent-in-law' },
  childInLaw: { m: 'Son-in-law', f: 'Daughter-in-law', x: 'Child-in-law' },
  siblingInLaw: { m: 'Brother-in-law', f: 'Sister-in-law', x: 'Sibling-in-law' },
  stepSibling: { m: 'Stepbrother', f: 'Stepsister', x: 'Step-sibling' },
  // English has no word of its own and stretches "in-law" this far too.
  coSiblingInLaw: { m: 'Brother-in-law', f: 'Sister-in-law', x: 'Sibling-in-law' },
  ex: (term) => map(term, (word) => `Ex-${word.toLowerCase()}`),
  of: (term, person, relativeTerm, relative) =>
    `${possessive(relativeTerm, relative)} ${say(term, person).toLowerCase()}`,
};

const LEXICONS: Record<Lang, Lexicon> = { de: GERMAN, en: ENGLISH };
