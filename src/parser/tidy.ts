import { assignGenerations } from '../layout/layout';
import { attributeSpans, parseFamily, stripComment, tokenize } from './parse';
import { unionStart, type FamilyGraph, type Union } from './types';

/**
 * family.md in a fixed order, the way the tree reads: one section per
 * generation, oldest first, and within it household by household — a person,
 * their partner, the line about the two of them — with the person lines
 * aligned. The order comes from the family itself (who descends from whom,
 * birthdays, the order children are listed in), never from where lines
 * happened to be, so tidying a tidy file changes nothing.
 *
 * Nothing is lost: every statement and comment stays, a comment on a line of
 * its own going along with the statement below it. Prose outside the
 * ```family block is not touched. Only the generation headings are made
 * anew, and a bare `married=?` goes — `a + b` says the same.
 */
export function tidyText(markdown: string): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);

  // Where the ```family blocks are, and what is inside them.
  const blocks: Array<{ open: number; close: number }> = [];
  let open = -1;
  lines.forEach((line, i) => {
    const fence = /^\s*```+\s*(\w*)/.exec(line);
    if (!fence) return;
    if (open === -1) {
      if (fence[1] === 'family') open = i;
    } else {
      blocks.push({ open, close: i });
      open = -1;
    }
  });
  if (blocks.length === 0) return markdown;

  interface Entry {
    /** The line as written, without indentation. */
    text: string;
    /** Comment lines that stood right above it. */
    notes: string[];
  }
  const people = new Map<string, Entry[]>();
  const relations: Entry[] = [];
  const others: Entry[] = [];
  let me: Entry | undefined;
  let notes: string[] = [];
  for (const { open: from, close: to } of blocks) {
    for (const raw of lines.slice(from + 1, to)) {
      const text = raw.trim();
      if (text === '') continue;
      const code = text.startsWith('#') ? '' : stripComment(text).trim();
      if (code === '') {
        if (!GENERATION.test(text)) notes.push(text);
        continue;
      }
      const entry = { text, notes };
      notes = [];
      const [first, second] = tokenize(code);
      if (first && !first.quoted && first.value === 'person' && second) {
        people.set(second.value, [...(people.get(second.value) ?? []), entry]);
      } else if (first && !first.quoted && first.value === 'me') {
        me = entry;
      } else if (tokenize(code).some((t) => !t.quoted && (t.value === '+' || t.value === '->' || /^(children|adopted)=/.test(t.value)))) {
        relations.push(entry);
      } else {
        others.push(entry);
      }
    }
  }

  // Which relation lines belong to which partnership: parse them alone, in order.
  const graph = parseFamily(['```family', ...[...people.values()].flat().map((e) => e.text), ...relations.map((e) => e.text), '```'].join('\n'));
  const firstRelationLine = [...people.values()].flat().length + 2;
  const linesOf = new Map<string, Entry[]>();
  for (const union of graph.unions) {
    linesOf.set(union.id, (union.lines ?? []).sort((a, b) => a - b).map((line) => relations[line - firstRelationLine]!));
  }

  const order = familyOrder(graph);
  const generation = assignGenerations(graph);
  const written = new Set<Entry>();
  const out: string[] = [];
  const emit = (entry: Entry, text = entry.text) => {
    if (written.has(entry)) return;
    written.add(entry);
    out.push(...entry.notes, text);
  };

  if (me) {
    emit(me);
    out.push('');
  }
  const rows = [...new Set(order.map((id) => generation.get(id) ?? 0))].sort((a, b) => a - b);
  for (const row of rows) {
    const ids = order.filter((id) => (generation.get(id) ?? 0) === row);
    const width = (pick: (entry: Entry) => string) =>
      Math.max(0, ...ids.flatMap((id) => (people.get(id) ?? []).map(pick)).map((s) => s.length));
    const parts = (entry: Entry) => personParts(entry.text);
    const idWidth = width((e) => parts(e).id);
    const nameWidth = width((e) => parts(e).name);
    const personLine = (entry: Entry) => {
      const { id, name, rest } = parts(entry);
      return `person ${id.padEnd(idWidth)} ${name.padEnd(nameWidth)} ${rest}`.trimEnd();
    };

    out.push(`%% ---- Generation ${rows.indexOf(row) + 1}`);
    const done = new Set<string>();
    let single = false;
    for (const id of ids) {
      if (done.has(id)) continue;
      // A household: this person, the partners on the same row, then what is said about them.
      const unions = unionsOf(graph, id);
      const here = (p: string) => (generation.get(p) ?? 0) === row && !done.has(p);
      // A couple in the order their own line names them: `ursula + bernd`.
      const couple = unions.find((u) => u.partners.length === 2 && u.partners.every(here));
      const household = [...new Set([...(couple?.partners ?? [id]), id, ...unions.flatMap((u) => u.partners).filter(here)])];
      const lone = household.length === 1 && unions.every((u) => (linesOf.get(u.id) ?? []).every((e) => written.has(e)));
      if (!(lone && single) && out.at(-1) !== `%% ---- Generation ${rows.indexOf(row) + 1}`) out.push('');
      single = lone;
      for (const member of household) {
        done.add(member);
        for (const entry of people.get(member) ?? []) emit(entry, personLine(entry));
      }
      for (const member of household) {
        for (const union of unionsOf(graph, member)) {
          for (const entry of linesOf.get(union.id) ?? []) emit(entry, withoutBareMarriage(entry.text, union, graph));
        }
      }
    }
    out.push('');
  }
  // Anything the order did not reach — it should all be reached, but nothing may go missing.
  for (const entry of [...people.values()].flat()) emit(entry);
  for (const entry of relations) emit(entry);
  for (const entry of others) emit(entry);
  out.push(...notes);
  while (out.at(-1) === '') out.pop();

  // The first block gets everything; any later ones go, with the blank line before them.
  const { open: start, close: end } = blocks[0]!;
  const result = [...lines.slice(0, start + 1), ...out, ...lines.slice(end, blocks[1]?.open ?? lines.length)];
  for (let b = 1; b < blocks.length; b++) {
    const after = lines.slice(blocks[b]!.close + 1, blocks[b + 1]?.open ?? lines.length);
    while (result.at(-1)?.trim() === '' && after.length > 0) result.pop();
    if (after.length > 0 && result.length > 0) result.push('');
    result.push(...after.slice(after[0]?.trim() === '' ? 1 : 0));
  }
  return result.join(eol);
}

/** A generation heading this file makes — the only lines it writes itself. */
const GENERATION = /^%%\s*-+\s*Generation\s+\d+/i;

/**
 * Everyone, in the order the tree reads: from the oldest, each person's
 * partnerships (earliest first) and then the children as the file lists
 * them. Who comes first among people without parents goes by birth, then id —
 * never by where their line happens to stand.
 */
function familyOrder(graph: FamilyGraph): string[] {
  const generation = assignGenerations(graph);
  const hasParents = new Set(graph.unions.flatMap((u) => u.children));
  const born = (id: string) => graph.people.get(id)?.born ?? '9999';
  const roots = [...graph.people.keys()]
    .filter((id) => !hasParents.has(id))
    .sort((a, b) => (generation.get(a) ?? 0) - (generation.get(b) ?? 0) || born(a).localeCompare(born(b)) || a.localeCompare(b));
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const unions = unionsOf(graph, id);
    for (const union of unions) for (const partner of union.partners) visit(partner);
    for (const union of unions) for (const child of union.children) visit(child);
  };
  for (const root of roots) visit(root);
  // People in a loop of their own (no one without parents above them) still belong somewhere.
  for (const id of [...graph.people.keys()].sort()) visit(id);
  return order;
}

/** Someone's partnerships, the earliest first; lone-parent lines last. */
function unionsOf(graph: FamilyGraph, id: string): Union[] {
  const other = (u: Union) => u.partners.find((p) => p !== id) ?? '';
  return graph.unions
    .filter((u) => u.partners.includes(id))
    .sort(
      (a, b) =>
        Number(a.partners.length === 1) - Number(b.partners.length === 1) ||
        (unionStart(a) ?? '9999').localeCompare(unionStart(b) ?? '9999') ||
        other(a).localeCompare(other(b)) ||
        a.id.localeCompare(b.id),
    );
}

/** `person <id> "<Name>" <the rest>`, split so the columns can line up. */
function personParts(text: string): { id: string; name: string; rest: string } {
  const code = stripComment(text);
  const tokens = tokenize(code);
  const id = tokens[1]!;
  const third = tokens[2];
  const named = third && (third.quoted || !third.value.includes('='));
  const name = named ? code.slice(third.start, third.end) : '';
  const restStart = named ? third.end : id.end;
  return { id: code.slice(id.start, id.end), name, rest: text.slice(restStart).trim() };
}

/** `married=?` on a couple's only partnership says nothing a bare `a + b` does not. */
function withoutBareMarriage(text: string, union: Union, graph: FamilyGraph): string {
  const pair = [...union.partners].sort().join('+');
  const again = graph.unions.some((u) => u !== union && [...u.partners].sort().join('+') === pair);
  // An ended one keeps it: without a start, a remarriage later would join it instead of beginning anew.
  const ended = union.divorced !== undefined || union.separated !== undefined;
  if (again || ended || union.together !== undefined || (union.married !== '?' && union.married !== 'true')) return text;
  const code = stripComment(text);
  const married = attributeSpans(tokenize(code)).found.filter((a) => a.key === 'married');
  let out = text;
  for (const a of married.reverse()) {
    let from = a.start;
    while (from > 0 && out[from - 1] === ' ') from--;
    out = out.slice(0, from) + out.slice(a.end);
  }
  return out;
}
