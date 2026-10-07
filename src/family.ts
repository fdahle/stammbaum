import type { FamilyGraph, Person, Union } from './parser/types';

export interface Partnership {
  union: Union;
  partner: Person | undefined;
}

/** Derived lookups over the parsed graph — everything the views ask for. */
export class Family {
  readonly graph: FamilyGraph;
  private readonly unionsByPartner = new Map<string, Union[]>();
  private readonly unionsByChild = new Map<string, Union[]>();

  constructor(graph: FamilyGraph) {
    this.graph = graph;
    for (const union of graph.unions) {
      for (const partner of union.partners) push(this.unionsByPartner, partner, union);
      for (const child of union.children) push(this.unionsByChild, child, union);
    }
  }

  person(id: string): Person | undefined {
    return this.graph.people.get(id);
  }

  people(): Person[] {
    return [...this.graph.people.values()];
  }

  /** Partnerships in the order they were written, i.e. chronological. */
  partnerships(id: string): Partnership[] {
    return (this.unionsByPartner.get(id) ?? []).map((union) => ({
      union,
      partner: this.person(union.partners.find((p) => p !== id) ?? ''),
    }));
  }

  /** The person relations are named from, when the file has a `me` line. */
  me(): Person | undefined {
    return this.graph.me === undefined ? undefined : this.person(this.graph.me);
  }

  /** The person whose `login=` is this user name. */
  byLogin(login: string): Person | undefined {
    const wanted = login.toLowerCase();
    return this.people().find((p) => p.login?.toLowerCase() === wanted);
  }

  /** The partnership someone was born into. */
  parentUnion(id: string): Union | undefined {
    return this.unionsByChild.get(id)?.[0];
  }

  /** Birth parents and adoptive parents, when the file has both. */
  parents(id: string): Person[] {
    const ids = (this.unionsByChild.get(id) ?? []).flatMap((union) => union.partners);
    return [...new Set(ids)].map((p) => this.person(p)).filter(isPerson);
  }

  adopted(id: string): boolean {
    return (this.unionsByChild.get(id) ?? []).some((union) => union.adopted?.includes(id));
  }

  /** Children grouped by the partnership they came from. */
  broods(id: string): Array<{ union: Union; partner: Person | undefined; children: Person[] }> {
    return this.partnerships(id)
      .map(({ union, partner }) => ({
        union,
        partner,
        children: union.children.map((c) => this.person(c)).filter(isPerson),
      }))
      .filter((brood) => brood.children.length > 0);
  }

  search(query: string): Person[] {
    const needle = normalise(query);
    if (needle === '') return [];
    return this.people()
      .map((person) => ({ person, score: score(person, needle) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name))
      .slice(0, 8)
      .map((hit) => hit.person);
  }
}

function score(person: Person, needle: string): number {
  const haystacks = [person.name, person.nick ?? '', person.maiden ?? '', person.id];
  let best = 0;
  for (const [index, raw] of haystacks.entries()) {
    const value = normalise(raw);
    if (value === '') continue;
    const at = value.indexOf(needle);
    if (at === -1) continue;
    // Prefer word starts, and the real name over the id.
    const positional = at === 0 || value[at - 1] === ' ' ? 3 : 1;
    best = Math.max(best, positional * 10 - index);
  }
  return best;
}

function normalise(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isPerson(person: Person | undefined): person is Person {
  return person !== undefined;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
