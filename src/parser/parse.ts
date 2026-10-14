import { type Diagnostic, type FamilyGraph, type Person, type Sex, type Union, unionId } from './types';

/**
 * Parses the mermaid-flavoured family DSL out of a markdown document.
 *
 * The DSL lives in ```family fenced blocks; everything around it is ordinary
 * markdown prose that the parser ignores. Grammar (one statement per line):
 *
 *   person <id> "<Name>" [key=value ...]     born= died= photo= maiden= nick= note= sex=
 *                                            birthplace= deathplace= job= lives= photos= login=
 *   <a> + <b> [key=value ...]                married= divorced= together= separated= adopted=
 *   <a> + <b> -> <child>, <child>            children of that union
 *   <a> -> <child>                           children with an unknown second parent
 *   me <id>                                  whose point of view relations are named from
 *   %% or # ...                              comment
 *
 * Attribute values are bare tokens or "quoted strings". A union may be written
 * across several lines; the statements merge into one union.
 */
export function parseFamily(markdown: string): FamilyGraph {
  const people = new Map<string, Person>();
  const unions = new Unions();
  const warnings: Diagnostic[] = [];

  const graph: FamilyGraph = {
    title: firstHeading(markdown) ?? 'Stammbaum',
    people,
    unions: [],
    warnings,
  };
  let me: { id: string; line: number; text: string } | undefined;

  for (const { text, line } of dslLines(markdown)) {
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    const warn = (message: string) => warnings.push({ line, message, text });

    if (!tokens[0]!.quoted && tokens[0]!.value === 'person') {
      readPerson(tokens, line, people, warn);
    } else if (
      tokens.some(
        (t) =>
          !t.quoted &&
          (t.value === '+' || t.value === '->' || t.value.startsWith('children=') || t.value.startsWith('adopted=')),
      )
    ) {
      readRelation(tokens, unions, warn);
    } else if (!tokens[0]!.quoted && tokens[0]!.value === 'me') {
      if (tokens.length !== 2) warn('"me" needs exactly one person id');
      else me = { id: tokens[1]!.value, line, text };
    } else {
      warn('unrecognised statement');
    }
  }

  // Anyone mentioned only in a relation still gets a bubble, so a half-finished
  // file renders instead of blowing up.
  for (const union of unions.all()) {
    for (const id of [...union.partners, ...union.children]) {
      if (!people.has(id)) {
        people.set(id, { id, name: id, stub: true });
        warnings.push({ line: 0, message: `no "person" declaration for "${id}"`, text: id });
      }
    }
  }

  if (me && people.has(me.id)) graph.me = me.id;
  else if (me) warnings.push({ line: me.line, message: `"me" names unknown person "${me.id}"`, text: me.text });

  graph.unions = unions.all();
  check(graph);
  return graph;
}

/**
 * The partnerships read so far. A couple who divorce and marry each other again
 * have two partnerships, like any remarriage; every other statement about the
 * same two people merges into the one they are in now.
 */
class Unions {
  private readonly byId = new Map<string, Union>();
  private readonly current = new Map<string, Union>();

  /** The partnership a statement is about — a new one when `begins` starts it afresh. */
  get(partners: string[], begins: boolean): Union {
    const pair = unionId(partners);
    const existing = this.current.get(pair);
    if (existing && !(begins && isOver(existing))) return existing;
    const count = this.all().filter((u) => unionId(u.partners) === pair).length;
    const union: Union = { id: count === 0 ? pair : `${pair}~${count + 1}`, partners, children: [] };
    this.byId.set(union.id, union);
    this.current.set(pair, union);
    return union;
  }

  all(): Union[] {
    return [...this.byId.values()];
  }
}

/** Began and ended — so another `married=` or `together=` means they began again. */
function isOver(union: Union): boolean {
  const began = union.married !== undefined || union.together !== undefined;
  const ended = union.divorced !== undefined || union.separated !== undefined;
  return began && ended;
}

interface Token {
  value: string;
  quoted: boolean;
}

/**
 * Splits a statement into tokens. A token runs to the next space, except that
 * "quoted sections" may contain spaces — so `note="Wohnt in Lissabon."` stays
 * one token. `+` and `->` are always separate tokens.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const [raw] of text.matchAll(/(?:"[^"]*"|[^\s"]+)+/g)) {
    const fullyQuoted = /^"[^"]*"$/.test(raw);
    if (fullyQuoted) {
      tokens.push({ value: raw.slice(1, -1), quoted: true });
    } else if (raw.includes('"')) {
      tokens.push({ value: raw.replace(/"/g, ''), quoted: false });
    } else {
      // `a+b` and `a->b` are legal without surrounding spaces.
      for (const piece of raw.split(/(->|\+)/g)) {
        if (piece !== '') tokens.push({ value: piece, quoted: false });
      }
    }
  }
  return tokens;
}

const PERSON_KEYS = new Set([
  'born', 'died', 'photo', 'maiden', 'nick', 'note', 'sex',
  'birthplace', 'deathplace', 'job', 'lives', 'photos', 'login',
]);
/** `w` for weiblich, since the people writing the file speak German. */
const SEXES = new Map<string, Sex>([
  ['m', 'm'],
  ['f', 'f'],
  ['w', 'f'],
]);
const UNION_KEYS = new Set(['married', 'divorced', 'together', 'separated', 'children', 'adopted']);

function readPerson(tokens: Token[], line: number, people: Map<string, Person>, warn: (m: string) => void): void {
  const id = tokens[1]?.value;
  if (!id) {
    warn('person needs an id');
    return;
  }
  const earlier = people.get(id);
  if (earlier) warn(`"${id}" was already declared on line ${earlier.line ?? '?'} — the later values win`);
  const person: Person = earlier ?? { id, name: id, line };
  people.set(id, person);

  let rest = tokens.slice(2);
  // The display name is the first token, unless it is already a key=value pair.
  const first = rest[0];
  if (first && (first.quoted || !first.value.includes('='))) {
    person.name = first.value;
    rest = rest.slice(1);
  }
  for (const [key, value] of attributes(rest, warn)) {
    if (!PERSON_KEYS.has(key)) {
      warn(`unknown person attribute "${key}"`);
      continue;
    }
    if (key === 'sex') {
      const sex = SEXES.get(value.toLowerCase());
      if (sex) person.sex = sex;
      else warn(`sex must be m or f, got "${value}"`);
      continue;
    }
    if (key === 'photos') {
      person.photos = list(value);
      continue;
    }
    person[key as 'born'] = value;
  }
}

function readRelation(tokens: Token[], unions: Unions, warn: (m: string) => void): void {
  const arrow = tokens.findIndex((t) => !t.quoted && t.value === '->');
  const left = arrow === -1 ? tokens : tokens.slice(0, arrow);
  let right = arrow === -1 ? [] : tokens.slice(arrow + 1);
  // `a + b -> c adopted=d` — attributes may also follow the children.
  const trailing = right.findIndex((t) => !t.quoted && t.value.includes('='));
  const after = trailing === -1 ? [] : right.slice(trailing);
  if (trailing !== -1) right = right.slice(0, trailing);

  const first = left[0];
  if (!first || (!first.quoted && first.value === '+')) {
    warn('relation needs a person before "+" or "->"');
    return;
  }
  const partners: string[] = [first.value];
  let rest = left.slice(1);
  if (rest[0] && !rest[0].quoted && rest[0].value === '+') {
    const second = rest[1];
    if (!second) {
      warn('"+" without a second partner');
      return;
    }
    partners.push(second.value);
    rest = rest.slice(2);
  }
  if (partners.some((p) => p === '' || p === '+' || p.includes('='))) {
    warn('relation needs plain person ids on the left');
    return;
  }

  const pairs = attributes([...rest, ...after], warn);
  const union = unions.get(partners, pairs.some(([key]) => key === 'married' || key === 'together'));

  const children = right
    .map((t) => t.value)
    .join(' ')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');

  for (const [key, value] of pairs) {
    if (!UNION_KEYS.has(key)) {
      warn(`unknown relation attribute "${key}"`);
      continue;
    }
    if (key === 'children') children.push(...list(value));
    else if (key === 'adopted') {
      // Adopted children are children like any other, just marked.
      const adopted = list(value);
      children.push(...adopted);
      union.adopted = [...new Set([...(union.adopted ?? []), ...adopted])];
    } else union[key as 'married'] = value;
  }

  for (const child of children) {
    if (!union.children.includes(child)) union.children.push(child);
  }
}

/** `a, b,c` → `['a', 'b', 'c']`. */
function list(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function attributes(tokens: Token[], warn: (m: string) => void): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const eq = token.quoted ? -1 : token.value.indexOf('=');
    if (eq <= 0) {
      // `children=a, b` — a list continued after a space.
      const previous = pairs[pairs.length - 1];
      if (previous && previous[1].endsWith(',')) previous[1] += token.value;
      else warn(`expected key=value, got "${token.value}"`);
      continue;
    }
    const key = token.value.slice(0, eq);
    let value = token.value.slice(eq + 1);
    // `note= "..."` — the quoted value landed in the next token.
    if (value === '' && tokens[i + 1]?.quoted) {
      value = tokens[i + 1]!.value;
      i++;
    }
    pairs.push([key, value]);
  }
  return pairs;
}

/** Yields the statement lines of every ```family block, with 1-based line numbers. */
function* dslLines(markdown: string): Generator<{ text: string; line: number }> {
  const lines = markdown.split(/\r?\n/);
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const fence = /^\s*```+\s*(\w*)/.exec(raw);
    if (fence) {
      inside = inside ? false : fence[1] === 'family';
      continue;
    }
    if (!inside) continue;
    const text = stripComment(raw).replace(/^\s*#.*$/, '').trim();
    if (text !== '') yield { text, line: i + 1 };
  }
}

/** Cuts a `%%` comment off a line — unless the `%%` is inside quotes, as in `note="100%%"`. */
function stripComment(raw: string): string {
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') quoted = !quoted;
    else if (!quoted && raw.startsWith('%%', i)) return raw.slice(0, i);
  }
  return raw;
}

function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
}

// ---- plausibility -----------------------------------------------------------

/**
 * Mistakes that parse fine but cannot be true: a child older than its parent,
 * a death before the birth, someone who ends up their own ancestor. Usually a
 * typo in a date or an id.
 */
function check(graph: FamilyGraph): void {
  const warn = (person: Person, message: string) =>
    graph.warnings.push({ line: person.line ?? 0, message, text: person.id });

  for (const person of graph.people.values()) {
    const born = yearOf(person.born);
    const died = yearOf(person.died);
    if (born !== undefined && died !== undefined && died < born) warn(person, `"${person.id}" died before they were born`);
  }

  const parentsOf = new Map<string, string[]>();
  for (const union of graph.unions) {
    for (const child of union.children) {
      parentsOf.set(child, [...(parentsOf.get(child) ?? []), ...union.partners]);
      // An adopted child may well be older than a young adoptive parent.
      const person = graph.people.get(child);
      const born = yearOf(person?.born);
      if (!person || born === undefined || union.adopted?.includes(child)) continue;
      for (const parent of union.partners) {
        const parentBorn = yearOf(graph.people.get(parent)?.born);
        if (parentBorn !== undefined && born <= parentBorn) {
          warn(person, `"${child}" is born no later than their parent "${parent}"`);
        }
      }
    }
  }

  for (const person of graph.people.values()) {
    const seen = new Set<string>();
    const queue = [...(parentsOf.get(person.id) ?? [])];
    for (const id of queue) {
      if (id === person.id) {
        warn(person, `"${person.id}" ends up among their own ancestors`);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(parentsOf.get(id) ?? []));
    }
  }
}

function yearOf(date: string | undefined): number | undefined {
  const match = date ? /^(\d{4})/.exec(date) : null;
  return match ? Number(match[1]) : undefined;
}
