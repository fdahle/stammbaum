import { countryList, countryName } from './countries';
import { LANGS } from './i18n';
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

  /**
   * Children grouped by the other parent — one group for a couple who married
   * each other twice, under their latest partnership.
   */
  broods(id: string): Array<{ union: Union; partner: Person | undefined; children: Person[] }> {
    const byPartner = new Map<string, { union: Union; partner: Person | undefined; children: Person[] }>();
    for (const { union, partner } of this.partnerships(id)) {
      const key = partner?.id ?? '';
      const children = [...(byPartner.get(key)?.children ?? [])];
      for (const child of union.children.map((c) => this.person(c)).filter(isPerson)) {
        if (!children.includes(child)) children.push(child);
      }
      byPartner.set(key, { union, partner, children });
    }
    return [...byPartner.values()].filter((brood) => brood.children.length > 0);
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
        const haystacks = [...fields(person), ...(options.extra?.(person) ?? [])].map((h) => spellings(h ?? ''));
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

  // ---- subtrees -----------------------------------------------------------

  /** `id`, everyone above them, and the partnerships those people form. */
  ancestorsGraph(id: string): FamilyGraph {
    const ids = new Set([id]);
    for (const current of ids) for (const parent of this.parents(current)) ids.add(parent.id);
    return this.subgraph(ids, (union) => union.children.some((c) => ids.has(c)));
  }

  /** `id`, everyone below them, and each of their partners. */
  descendantsGraph(id: string): FamilyGraph {
    const blood = new Set([id]);
    for (const current of blood) for (const child of this.children(current)) blood.add(child.id);
    const ids = new Set(blood);
    for (const current of blood) {
      for (const { partner } of this.partnerships(current)) if (partner) ids.add(partner.id);
    }
    return this.subgraph(ids, (union) => union.partners.some((p) => blood.has(p)));
  }

  private subgraph(ids: Set<string>, keep: (union: Union) => boolean): FamilyGraph {
    const people = new Map([...ids].flatMap((id) => {
      const person = this.person(id);
      return person ? [[id, person] as const] : [];
    }));
    const unions = this.graph.unions.filter(keep).map((union) => ({
      ...union,
      partners: union.partners.filter((p) => ids.has(p)),
      children: union.children.filter((c) => ids.has(c)),
    }));
    return {
      title: this.graph.title,
      ...(this.graph.me && ids.has(this.graph.me) ? { me: this.graph.me } : {}),
      people,
      unions: unions.filter((union) => union.partners.length > 0),
      warnings: [],
    };
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
    countries(person),
    person.note,
  ];
}

/** Every country someone is linked to, by name in each language: found as "Norwegen" and "Norway". */
function countries(person: Person): string | undefined {
  const codes = [person.country, person.birthcountry, person.deathcountry, ...countryList(person.nationality)].filter((c): c is string => !!c);
  if (codes.length === 0) return undefined;
  return [...new Set(codes.flatMap((code) => LANGS.map(({ id }) => countryName(code, id))))].join(' ');
}

/** Word starts beat matches inside a word, and earlier fields beat later ones. */
function score(haystacks: string[][], needle: string): number {
  let best = 0;
  for (const [index, values] of haystacks.entries()) {
    for (const value of values) {
      const at = value.indexOf(needle);
      if (at === -1) continue;
      const wordStart = at === 0 || value.includes(` ${needle}`) || value.includes(`-${needle}`);
      best = Math.max(best, (wordStart ? 3 : 1) * 100 - index);
    }
  }
  return best;
}

/** Lower case, ß as ss, accents gone: "Straße" → "strasse", "Müller" → "muller". */
function normalise(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * The ways a field can be typed: "Müller" as "muller", and as "mueller" by
 * anyone without umlauts on their keyboard.
 */
function spellings(value: string): string[] {
  if (value === '') return [];
  const plain = normalise(value);
  const spelled = normalise(value.normalize('NFC').replace(/[äöüÄÖÜ]/g, (u) => `${UMLAUTS[u.toLowerCase()]}e`));
  return spelled === plain ? [plain] : [plain, spelled];
}

const UMLAUTS: Record<string, string> = { ä: 'a', ö: 'o', ü: 'u' };

function isPerson(person: Person | undefined): person is Person {
  return person !== undefined;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
