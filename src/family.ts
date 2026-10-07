import type { FamilyGraph, Person, Union } from './parser/types';

export interface Partnership {
  union: Union;
  partner: Person | undefined;
}

export interface SearchOptions {
  /** More text to match per person, e.g. what they are to whoever is looking. */
  extra?: ((person: Person) => Array<string | undefined>) | undefined;
  limit?: number;
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

  children(id: string): Person[] {
    const ids = (this.unionsByPartner.get(id) ?? []).flatMap((union) => union.children);
    return [...new Set(ids)].map((c) => this.person(c)).filter(isPerson);
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

  /**
   * Every word of the query has to turn up somewhere — name, nickname, places,
   * job, note, year of birth or whatever `extra` adds — so "klaus lindau" finds
   * the Klaus from Lindau.
   */
  search(query: string, options: SearchOptions = {}): Person[] {
    const words = normalise(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return this.people()
      .map((person) => {
        const haystacks = [...fields(person), ...(options.extra?.(person) ?? [])].map((h) => normalise(h ?? ''));
        let total = 0;
        for (const word of words) {
          const best = score(haystacks, word);
          if (best === 0) return { person, score: 0 };
          total += best;
        }
        return { person, score: total };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name))
      .slice(0, options.limit ?? 8)
      .map((hit) => hit.person);
  }

  // ---- paths --------------------------------------------------------------

  /**
   * The shortest chain of parent, child and partner links from `from` to `to`,
   * both ends included. Blood links are cheaper than partnerships, so cousins
   * are reached through their grandparents rather than through someone's
   * in-laws.
   */
  path(from: string, to: string): string[] | undefined {
    if (!this.person(from) || !this.person(to)) return undefined;
    const cost = new Map([[from, 0]]);
    const previous = new Map<string, string>();
    const open = new Set([from]);
    while (open.size > 0) {
      let current = '';
      let best = Infinity;
      for (const id of open) {
        const c = cost.get(id)!;
        if (c < best) [current, best] = [id, c];
      }
      open.delete(current);
      if (current === to) break;
      const steps: Array<[string, number]> = [
        ...this.parents(current).map((p): [string, number] => [p.id, 1]),
        ...this.children(current).map((c): [string, number] => [c.id, 1]),
        ...this.partnerships(current).flatMap(({ partner }): Array<[string, number]> =>
          partner ? [[partner.id, 1.5]] : [],
        ),
      ];
      for (const [next, weight] of steps) {
        const c = best + weight;
        if (c < (cost.get(next) ?? Infinity)) {
          cost.set(next, c);
          previous.set(next, current);
          open.add(next);
        }
      }
    }
    if (!cost.has(to)) return undefined;
    const chain = [to];
    while (chain[0] !== from) chain.unshift(previous.get(chain[0]!)!);
    return chain;
  }
}


/** What a person can be found by, best match first. */
function fields(person: Person): Array<string | undefined> {
  return [
    person.name,
    person.nick,
    person.maiden,
    person.id,
    person.lives,
    person.birthplace,
    person.job,
    person.born?.slice(0, 4),
    person.deathplace,
    person.note,
  ];
}

/** Word starts beat matches inside a word, and earlier fields beat later ones. */
function score(haystacks: string[], needle: string): number {
  let best = 0;
  for (const [index, value] of haystacks.entries()) {
    if (value === '') continue;
    const at = value.indexOf(needle);
    if (at === -1) continue;
    const wordStart = at === 0 || value.includes(` ${needle}`) || value.includes(`-${needle}`);
    best = Math.max(best, (wordStart ? 3 : 1) * 100 - index);
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
