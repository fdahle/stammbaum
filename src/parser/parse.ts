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
  const unions = new Map<string, Union>();
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
      readPerson(tokens, people, warn);
    } else if (
      tokens.some(
        (t) => !t.quoted && (t.value === '+' || t.value === '->' || t.value.startsWith('children=')),
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
  for (const union of unions.values()) {
    for (const id of [...union.partners, ...union.children]) {
      if (!people.has(id)) {
        people.set(id, { id, name: id, stub: true });
        warnings.push({ line: 0, message: `no "person" declaration for "${id}"`, text: id });
      }
    }
  }

  if (me && people.has(me.id)) graph.me = me.id;
  else if (me) warnings.push({ line: me.line, message: `"me" names unknown person "${me.id}"`, text: me.text });

  graph.unions = [...unions.values()];
  return graph;
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

function readPerson(tokens: Token[], people: Map<string, Person>, warn: (m: string) => void): void {
  const id = tokens[1]?.value;
  if (!id) {
    warn('person needs an id');
    return;
  }
  const person: Person = people.get(id) ?? { id, name: id };
  delete person.stub;
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

function readRelation(tokens: Token[], unions: Map<string, Union>, warn: (m: string) => void): void {
  const arrow = tokens.findIndex((t) => !t.quoted && t.value === '->');
  const left = arrow === -1 ? tokens : tokens.slice(0, arrow);
  let right = arrow === -1 ? [] : tokens.slice(arrow + 1);
  // `a + b -> c adopted=d` — attributes may also follow the children.
  const trailing = right.findIndex((t) => !t.quoted && t.value.includes('='));
  const after = trailing === -1 ? [] : right.slice(trailing);
  if (trailing !== -1) right = right.slice(0, trailing);

  const partners: string[] = [left[0]!.value];
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
  if (partners.some((p) => p === '' || p.includes('='))) {
    warn('relation needs plain person ids on the left');
    return;
  }

  const id = unionId(partners);
  const union: Union = unions.get(id) ?? { id, partners, children: [] };
  unions.set(id, union);

  const children = right
    .map((t) => t.value)
    .join(' ')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');

  for (const [key, value] of attributes([...rest, ...after], warn)) {
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
    const text = raw.replace(/%%.*$/, '').replace(/^\s*#.*$/, '').trim();
    if (text !== '') yield { text, line: i + 1 };
  }
}

function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
}
