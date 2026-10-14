import { attributeSpans, parseFamily, statementLines, stripComment, tokenize, type Attribute, type Token } from './parse';
import { unionId, type FamilyGraph, type Person, type Union } from './types';

/**
 * Changes family.md the way a careful person would by hand: only the lines an
 * edit is about change, and within a line only the words it is about. Order,
 * alignment, comments and the prose around the ```family blocks stay as they
 * were, so the file still reads well and two versions compare line by line.
 */

export const PERSON_FIELDS = [
  'name', 'nick', 'maiden', 'sex', 'born', 'died', 'birthplace', 'deathplace', 'job', 'lives', 'note', 'login', 'photo', 'photos',
] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

export const UNION_FIELDS = ['married', 'together', 'divorced', 'separated'] as const;
export type UnionField = (typeof UNION_FIELDS)[number];

/** New values by field; `null` takes a field out. */
export type Changes<K extends string> = { [key in K]?: string | null };

/**
 * One change to the family. Ids starting with `$` name someone added earlier
 * in the same batch. `was` holds what the editor saw, so a change made in the
 * meantime by someone else is noticed instead of overwritten.
 */
export type Edit =
  | { kind: 'person'; id: string; set: Changes<PersonField>; was?: Changes<PersonField> }
  | { kind: 'add-person'; ref: string; set: Changes<PersonField>; near?: { id: string; side: 'before' | 'after' } }
  | { kind: 'delete-person'; id: string }
  | { kind: 'add-child'; parents: string[]; child: string; adopted?: boolean }
  | { kind: 'remove-child'; union: string; child: string }
  | { kind: 'add-partnership'; partners: string[]; set: Changes<UnionField> }
  | { kind: 'partnership'; union: string; set: Changes<UnionField>; was?: Changes<UnionField> }
  | { kind: 'delete-partnership'; union: string };

export class EditError extends Error {
  constructor(
    /** `conflict`: the file changed under the editor; `invalid`: the edit makes no sense. */
    readonly reason: 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'EditError';
  }
}

/** Applies `edits` in order; `created` maps each `$ref` to the id it was given. */
export function applyEdits(markdown: string, edits: Edit[]): { markdown: string; created: Record<string, string> } {
  const doc = new Doc(markdown);
  const created: Record<string, string> = {};
  const resolve = (id: string): string => {
    if (!id.startsWith('$')) return id;
    const real = created[id];
    if (!real) throw new EditError('invalid', `"${id}" is not added in this batch`);
    return real;
  };

  for (const edit of edits) {
    switch (edit.kind) {
      case 'person':
        editPerson(doc, resolve(edit.id), edit.set, edit.was);
        break;
      case 'add-person':
        if (!edit.ref.startsWith('$')) throw new EditError('invalid', 'a new person needs a $reference');
        created[edit.ref] = addPerson(doc, edit.set, edit.near && { id: resolve(edit.near.id), side: edit.near.side });
        break;
      case 'delete-person':
        deletePerson(doc, resolve(edit.id));
        break;
      case 'add-child':
        addChild(doc, edit.parents.map(resolve), resolve(edit.child), edit.adopted ?? false);
        break;
      case 'remove-child':
        removeChild(doc, edit.union, resolve(edit.child));
        break;
      case 'add-partnership':
        addPartnership(doc, edit.partners.map(resolve), edit.set);
        break;
      case 'partnership':
        editPartnership(doc, edit.union, edit.set, edit.was);
        break;
      case 'delete-partnership':
        deletePartnership(doc, edit.union);
        break;
      default:
        throw new EditError('invalid', 'unknown edit');
    }
  }
  return { markdown: doc.text(), created };
}

// ---- the document -----------------------------------------------------------

interface Statement {
  /** 0-based line index. */
  index: number;
  raw: string;
  code: string;
  tokens: Token[];
}

class Doc {
  private readonly eol: string;
  private lines: string[];
  private cache: { graph?: FamilyGraph; statements?: Statement[] } = {};

  constructor(markdown: string) {
    this.eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    this.lines = markdown.split(/\r?\n/);
  }

  text(): string {
    return this.lines.join(this.eol);
  }

  graph(): FamilyGraph {
    return (this.cache.graph ??= parseFamily(this.text()));
  }

  statements(): Statement[] {
    return (this.cache.statements ??= [...statementLines(this.text())].map(({ line, raw, code }) => ({
      index: line - 1,
      raw,
      code,
      tokens: tokenize(code),
    })));
  }

  statement(index: number): Statement {
    const found = this.statements().find((s) => s.index === index);
    if (!found) throw new EditError('conflict', `line ${index + 1} is no longer a statement`);
    return found;
  }

  set(index: number, text: string): void {
    this.lines[index] = text;
    this.cache = {};
  }

  insert(index: number, text: string): void {
    this.lines.splice(index, 0, text);
    this.cache = {};
  }

  remove(index: number): void {
    this.lines.splice(index, 1);
    this.cache = {};
  }

  /** Where new statements go when nothing says better: the end of the last ```family block. */
  end(): number {
    let inside = false;
    let close = -1;
    this.lines.forEach((line, i) => {
      const fence = /^\s*```+\s*(\w*)/.exec(line);
      if (!fence) return;
      if (inside) close = i;
      inside = inside ? false : fence[1] === 'family';
    });
    if (close !== -1) return close;
    // An empty file: the block is all there is.
    if (this.lines.every((line) => line.trim() === '')) {
      this.lines = ['```family', '```', ''];
      this.cache = {};
      return 1;
    }
    // No block yet: one at the end, before the file's last line break if it has one.
    const at = this.lines.at(-1) === '' ? this.lines.length - 1 : this.lines.length;
    this.lines.splice(at, 0, '', '```family', '```');
    this.cache = {};
    return at + 2;
  }
}

/** Replacements within one line, applied right to left so positions stay true. */
function rewrite(raw: string, changes: Array<{ start: number; end: number; text: string }>): string {
  const ordered = changes.map((change, order) => ({ ...change, order }));
  // At the same spot, what was asked for first ends up first.
  ordered.sort((a, b) => b.start - a.start || b.order - a.order);
  let out = raw;
  for (const { start, end, text } of ordered) out = out.slice(0, start) + text + out.slice(end);
  return out;
}

/** Where to append to a line: after its last word, before any comment. */
function codeEnd(statement: Statement): number {
  return statement.code.trimEnd().length;
}

/** A stretch to delete, with the space in front of it. */
function cut(raw: string, start: number, end: number): { start: number; end: number; text: string } {
  let from = start;
  while (from > 0 && (raw[from - 1] === ' ' || raw[from - 1] === '\t')) from--;
  return { start: from, end, text: '' };
}

function indentOf(raw: string | undefined): string {
  return /^[ \t]*/.exec(raw ?? '')?.[0] ?? '';
}

// ---- writing values ---------------------------------------------------------

/**
 * A value as the file needs it: bare where that is safe, "quoted" otherwise.
 * Bare words must not contain what the tokenizer treats specially — spaces,
 * quotes, `=`, `,`, `+`, `->` and the `%%` that starts a comment.
 */
export function quote(value: string): string {
  if (value !== '' && /^[^\s"\\,=%+]+$/.test(value) && !value.includes('->')) return value;
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

function attribute(key: string, value: string): string {
  return `${key}=${quote(value)}`;
}

/** One line of text, trimmed; empty means "take it out". */
function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length > 500) throw new EditError('invalid', 'a value is longer than 500 characters');
  return text === '' ? null : text;
}

function cleanChanges<K extends string>(set: Changes<K>, allowed: readonly K[]): Array<[K, string | null]> {
  return Object.entries(set).map(([key, value]) => {
    if (!allowed.includes(key as K)) throw new EditError('invalid', `"${key}" cannot be changed here`);
    let text = clean(value as string | null | undefined);
    if (key === 'sex' && text !== null) {
      const sex = { m: 'm', f: 'f', w: 'f' }[text.toLowerCase()];
      if (!sex) throw new EditError('invalid', 'sex must be m or f');
      text = sex;
    }
    return [key as K, text];
  });
}

// ---- people -----------------------------------------------------------------

interface PersonLine {
  statement: Statement;
  /** The second token: the id. */
  id: Token;
  name: Token | undefined;
  attributes: Attribute[];
}

function personLines(doc: Doc, id: string): PersonLine[] {
  return doc.statements().flatMap((statement) => {
    const [first, second, third] = statement.tokens;
    if (!first || first.quoted || first.value !== 'person' || second?.value !== id) return [];
    const name = third && (third.quoted || !third.value.includes('=')) ? third : undefined;
    const rest = statement.tokens.slice(name ? 3 : 2);
    return [{ statement, id: second, name, attributes: attributeSpans(rest).found }];
  });
}

/** A field as the file writes it — `photos` as one comma-separated list. */
export function personValue(person: Person, key: PersonField): string | undefined {
  if (key === 'name') return person.name;
  if (key === 'photos') return person.photos?.length ? person.photos.join(', ') : undefined;
  return person[key];
}

function editPerson(doc: Doc, id: string, set: Changes<PersonField>, was?: Changes<PersonField>): void {
  const person = doc.graph().people.get(id);
  if (!person) throw new EditError('conflict', `"${id}" is no longer in the file`);
  for (const [key, value] of Object.entries(was ?? {}) as Array<[PersonField, string | null]>) {
    if ((personValue(person, key) ?? null) !== (value ?? null)) {
      throw new EditError('conflict', `"${id}" was changed in the meantime`);
    }
  }
  const changes = cleanChanges(set, PERSON_FIELDS);
  if (changes.some(([key, value]) => key === 'name' && value === null)) throw new EditError('invalid', 'a name is needed');

  const lines = personLines(doc, id);
  if (lines.length === 0) {
    // Only mentioned in a relation so far: a line of their own, after that relation.
    const values = Object.fromEntries(changes) as Changes<PersonField>;
    const mention = Math.max(...doc.graph().unions.filter((u) => [...u.partners, ...u.children].includes(id)).flatMap((u) => u.lines ?? []));
    insertPerson(doc, id, { name: person.name, ...values }, Number.isFinite(mention) ? mention : doc.end());
    return;
  }

  // Later declarations win, so the change goes into the last; earlier ones lose the key.
  const target = lines[lines.length - 1]!;
  const edits = new Map<PersonLine, Array<{ start: number; end: number; text: string }>>(lines.map((l) => [l, []]));
  for (const [key, value] of changes) {
    if (key === 'name') {
      const name = target.name;
      edits.get(target)!.push(
        name ? { start: name.start, end: name.end, text: quote(value!) } : { start: target.id.end, end: target.id.end, text: ` ${quote(value!)}` },
      );
      continue;
    }
    for (const line of lines) {
      const found = line.attributes.filter((a) => a.key === key);
      const keep = line === target && value !== null ? found[found.length - 1] : undefined;
      for (const a of found) {
        edits.get(line)!.push(a === keep ? { start: a.start, end: a.end, text: attribute(key, value!) } : cut(line.statement.raw, a.start, a.end));
      }
      if (line === target && value !== null && !keep) {
        const at = codeEnd(line.statement);
        edits.get(line)!.push({ start: at, end: at, text: ` ${attribute(key, value)}` });
      }
    }
  }
  for (const [line, changesOnLine] of edits) {
    if (changesOnLine.length > 0) doc.set(line.statement.index, rewrite(line.statement.raw, changesOnLine));
  }
}

/** The order new person lines list their keys in — the order the sample uses. */
const PERSON_ORDER: PersonField[] = ['sex', 'born', 'died', 'photo', 'photos', 'birthplace', 'deathplace', 'maiden', 'nick', 'job', 'lives', 'login', 'note'];

function insertPerson(doc: Doc, id: string, set: Changes<PersonField>, at: number): void {
  const parts = [`person ${id}`, quote(set.name ?? id)];
  for (const key of PERSON_ORDER) {
    const value = set[key];
    if (value) parts.push(attribute(key, value));
  }
  doc.insert(at, indentOf(doc.statements().find((s) => s.index < at)?.raw) + parts.join(' '));
}

function addPerson(doc: Doc, set: Changes<PersonField>, near?: { id: string; side: 'before' | 'after' }): string {
  const values = Object.fromEntries(cleanChanges(set, PERSON_FIELDS)) as Changes<PersonField>;
  if (!values.name) throw new EditError('invalid', 'a name is needed');
  const id = newId(values.name, doc.graph());
  let at = doc.end();
  if (near) {
    const lines = personLines(doc, near.id);
    if (lines.length > 0) at = near.side === 'before' ? lines[0]!.statement.index : lines[lines.length - 1]!.statement.index + 1;
  }
  insertPerson(doc, id, values, at);
  return id;
}

/**
 * A short, readable, stable id from the name: the first name if it is free,
 * then first and last name, then a number — `klaus`, `klaus-bauer`, `klaus2`.
 */
export function newId(name: string, graph: FamilyGraph): string {
  const fold = (word: string) =>
    word
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const words = name.split(/\s+/).map(fold).filter(Boolean);
  const first = words[0] || 'person';
  const free = (id: string) => !graph.people.has(id);
  if (free(first)) return first;
  const full = words.join('-');
  if (words.length > 1 && free(full)) return full;
  for (let n = 2; ; n++) if (free(`${first}${n}`)) return `${first}${n}`;
}

function deletePerson(doc: Doc, id: string): void {
  if (!doc.graph().people.has(id)) throw new EditError('conflict', `"${id}" is no longer in the file`);

  // Out of every child list first…
  for (let union = childIn(doc, id); union; union = childIn(doc, id)) removeChild(doc, union.id, id);

  // …then out of every partnership: `a + b -> c` becomes `b -> c`, so the
  // children keep their other parent; a lone parent's line goes altogether.
  const lines = doc
    .graph()
    .unions.filter((u) => u.partners.includes(id))
    .flatMap((u) => u.lines ?? [])
    .sort((a, b) => b - a);
  for (const line of lines) {
    const relation = relationLine(doc.statement(line - 1));
    const raw = relation.statement.raw;
    const other = relation.partners.find((p) => p.value !== id);
    if (!other) {
      doc.remove(relation.statement.index);
      continue;
    }
    const changes = [{ start: relation.partners[0]!.start, end: relation.partners[relation.partners.length - 1]!.end, text: other.value }];
    // Married, divorced and the like describe a couple; one person alone has none.
    for (const a of relation.attributes) {
      if ((UNION_FIELDS as readonly string[]).includes(a.key)) changes.push(cut(raw, a.start, a.end));
    }
    const text = rewrite(raw, changes);
    const left = relationLine(reread(relation.statement, text));
    if (!left.arrow && left.attributes.length === 0) doc.remove(relation.statement.index);
    else doc.set(relation.statement.index, text);
  }

  for (const line of personLines(doc, id).reverse()) doc.remove(line.statement.index);
  for (const statement of [...doc.statements()].reverse()) {
    const [first, second] = statement.tokens;
    if (first?.value === 'me' && second?.value === id && statement.tokens.length === 2) doc.remove(statement.index);
  }
}

function childIn(doc: Doc, id: string): Union | undefined {
  return doc.graph().unions.find((u) => u.children.includes(id));
}

// ---- partnerships -----------------------------------------------------------

interface RelationLine {
  statement: Statement;
  partners: Token[];
  arrow: Token | undefined;
  children: Token[];
  attributes: Attribute[];
}

/** A relation statement taken apart the way the parser reads it. */
function relationLine(statement: Statement): RelationLine {
  const tokens = statement.tokens;
  const arrowAt = tokens.findIndex((t) => !t.quoted && t.value === '->');
  const left = arrowAt === -1 ? tokens : tokens.slice(0, arrowAt);
  let right = arrowAt === -1 ? [] : tokens.slice(arrowAt + 1);
  const trailing = right.findIndex((t) => !t.quoted && t.value.includes('='));
  const after = trailing === -1 ? [] : right.slice(trailing);
  if (trailing !== -1) right = right.slice(0, trailing);
  const partners = left.slice(0, 1);
  let rest = left.slice(1);
  if (rest[0]?.value === '+' && rest[1]) {
    partners.push(rest[1]);
    rest = rest.slice(2);
  }
  return {
    statement,
    partners,
    arrow: arrowAt === -1 ? undefined : tokens[arrowAt],
    children: right,
    attributes: attributeSpans([...rest, ...after]).found,
  };
}

function unionLines(doc: Doc, union: Union): RelationLine[] {
  return (union.lines ?? []).map((line) => relationLine(doc.statement(line - 1)));
}

function findUnion(doc: Doc, id: string): Union {
  const union = doc.graph().unions.find((u) => u.id === id);
  if (!union) throw new EditError('conflict', `the partnership "${id}" is no longer in the file`);
  return union;
}

/** The partnership the next statement about these partners would join. */
function currentUnion(doc: Doc, partners: string[]): Union | undefined {
  const pair = unionId(partners);
  return doc
    .graph()
    .unions.filter((u) => unionId(u.partners) === pair)
    .at(-1);
}

function isOver(union: Union): boolean {
  const began = union.married !== undefined || union.together !== undefined;
  return began && (union.divorced !== undefined || union.separated !== undefined);
}

/** After the last statement about these partners, or after their declarations. */
function relationSpot(doc: Doc, partners: string[]): number {
  const graph = doc.graph();
  const about = graph.unions.filter((u) => u.partners.some((p) => partners.includes(p))).flatMap((u) => u.lines ?? []);
  if (about.length > 0) return Math.max(...about);
  const declared = partners.flatMap((p) => personLines(doc, p).map((l) => l.statement.index + 1));
  return declared.length > 0 ? Math.max(...declared) : doc.end();
}

function requirePeople(doc: Doc, ids: string[]): void {
  for (const id of ids) {
    if (!doc.graph().people.has(id)) throw new EditError('conflict', `"${id}" is no longer in the file`);
  }
  if (new Set(ids).size !== ids.length) throw new EditError('invalid', 'the same person twice');
}

function addPartnership(doc: Doc, partners: string[], set: Changes<UnionField>): void {
  if (partners.length !== 2) throw new EditError('invalid', 'a partnership needs two people');
  requirePeople(doc, partners);
  const current = currentUnion(doc, partners);
  if (current && !isOver(current)) throw new EditError('invalid', 'the two already are partners');
  const values = Object.fromEntries(cleanChanges(set, UNION_FIELDS)) as Changes<UnionField>;
  // Without a start the line would join the ended partnership instead of beginning a new one.
  if (!values.married && !values.together) throw new EditError('invalid', 'a partnership needs married= or together=');
  const parts = [partners.join(' + ')];
  for (const key of UNION_FIELDS) if (values[key]) parts.push(attribute(key, values[key]!));
  const at = relationSpot(doc, partners);
  doc.insert(at, indentOf(doc.statements().find((s) => s.index < at)?.raw) + parts.join(' '));
}

function editPartnership(doc: Doc, id: string, set: Changes<UnionField>, was?: Changes<UnionField>): void {
  const union = findUnion(doc, id);
  for (const [key, value] of Object.entries(was ?? {}) as Array<[UnionField, string | null]>) {
    if ((union[key] ?? null) !== (value ?? null)) throw new EditError('conflict', 'the partnership was changed in the meantime');
  }
  const lines = unionLines(doc, union);
  const edits = new Map<RelationLine, Array<{ start: number; end: number; text: string }>>(lines.map((l) => [l, []]));
  for (const [key, value] of cleanChanges(set, UNION_FIELDS)) {
    const found = lines.flatMap((line) => line.attributes.filter((a) => a.key === key).map((a) => ({ line, a })));
    const keep = value === null ? undefined : found[found.length - 1];
    for (const { line, a } of found) {
      edits.get(line)!.push(keep?.a === a ? { start: a.start, end: a.end, text: attribute(key, value!) } : cut(line.statement.raw, a.start, a.end));
    }
    if (value !== null && !keep) {
      // Into the line the partnership begins on — a key on a later line could start a new one.
      const first = lines[0]!;
      const at = first.arrow ? first.arrow.start : codeEnd(first.statement);
      edits.get(first)!.push(first.arrow ? { start: at, end: at, text: `${attribute(key, value)} ` } : { start: at, end: at, text: ` ${attribute(key, value)}` });
    }
  }
  for (const [line, changes] of edits) {
    if (changes.length > 0) doc.set(line.statement.index, rewrite(line.statement.raw, changes));
  }
}

function deletePartnership(doc: Doc, id: string): void {
  const union = findUnion(doc, id);
  if (union.children.length > 0) throw new EditError('invalid', 'a partnership with children cannot be removed');
  for (const line of [...(union.lines ?? [])].sort((a, b) => b - a)) doc.remove(line - 1);
}

// ---- children ---------------------------------------------------------------

function addChild(doc: Doc, parents: string[], child: string, adopted: boolean): void {
  if (parents.length < 1 || parents.length > 2) throw new EditError('invalid', 'a child needs one or two parents');
  requirePeople(doc, [...parents, child]);
  const union = currentUnion(doc, parents);
  if (union?.children.includes(child) && (!adopted || union.adopted?.includes(child))) return;

  if (!union) {
    const statement = `${parents.join(' + ')} ${adopted ? `adopted=${child}` : `-> ${child}`}`;
    const at = relationSpot(doc, parents);
    doc.insert(at, indentOf(doc.statements().find((s) => s.index < at)?.raw) + statement);
    return;
  }

  const lines = unionLines(doc, union);
  if (adopted) {
    // Into the adopted= list there already is, or a new one.
    const line = lines.filter((l) => l.attributes.some((a) => a.key === 'adopted')).at(-1) ?? lines.at(-1)!;
    const list = line.attributes.filter((a) => a.key === 'adopted').at(-1);
    const raw = line.statement.raw;
    const change = list
      ? { start: list.start, end: list.end, text: `adopted=${[...split(list.value), child].join(', ')}` }
      : { start: codeEnd(line.statement), end: codeEnd(line.statement), text: ` adopted=${child}` };
    doc.set(line.statement.index, rewrite(raw, [change]));
    return;
  }

  const line = lines.filter((l) => l.arrow).at(-1) ?? lines.at(-1)!;
  const last = line.children.at(-1);
  const change = last
    ? { start: last.end, end: last.end, text: `, ${child}` }
    : line.arrow
      ? { start: line.arrow.end, end: line.arrow.end, text: ` ${child}` }
      : { start: codeEnd(line.statement), end: codeEnd(line.statement), text: ` -> ${child}` };
  doc.set(line.statement.index, rewrite(line.statement.raw, [change]));
}

function removeChild(doc: Doc, id: string, child: string): void {
  const union = findUnion(doc, id);
  if (!union.children.includes(child)) throw new EditError('conflict', `"${child}" is no longer a child there`);

  const lines = unionLines(doc, union);
  const results = lines.map((line) => {
    const raw = line.statement.raw;
    const changes: Array<{ start: number; end: number; text: string }> = [];
    const listed = split(line.children.map((t) => t.value).join(' '));
    if (listed.includes(child)) {
      const keep = listed.filter((c) => c !== child);
      const first = line.children[0]!;
      const last = line.children.at(-1)!;
      changes.push(keep.length > 0 ? { start: first.start, end: last.end, text: keep.join(', ') } : cut(raw, line.arrow!.start, last.end));
    }
    for (const a of line.attributes) {
      if (a.key !== 'children' && a.key !== 'adopted') continue;
      const keep = split(a.value).filter((c) => c !== child);
      if (keep.length === split(a.value).length) continue;
      changes.push(keep.length > 0 ? { start: a.start, end: a.end, text: `${a.key}=${keep.join(', ')}` } : cut(raw, a.start, a.end));
    }
    const text = changes.length > 0 ? rewrite(raw, changes) : raw;
    const after = relationLine(reread(line.statement, text));
    const empty = !after.arrow && after.attributes.length === 0;
    return { index: line.statement.index, text, empty, alone: after.partners.length < 2 };
  });

  // A lone `a` says nothing and goes. A bare `a + b` still says they are a
  // couple, so it stays unless another line of theirs says so already.
  let left = results.length;
  for (const result of [...results].sort((a, b) => b.index - a.index)) {
    if (result.empty && (result.alone || left > 1)) {
      doc.remove(result.index);
      left--;
    } else doc.set(result.index, result.text);
  }
}

/** A statement read again after its text changed. */
function reread(statement: Statement, raw: string): Statement {
  const code = stripComment(raw);
  return { index: statement.index, raw, code, tokens: tokenize(code) };
}

function split(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
