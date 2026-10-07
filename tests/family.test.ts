import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFamily } from '../src/parser/parse';
import { Family } from '../src/family';

const family = new Family(parseFamily(readFileSync(new URL('../sample/family.md', import.meta.url), 'utf8')));

describe('Family', () => {
  it('lists both parents', () => {
    expect(family.parents('nina').map((p) => p.id)).toEqual(['klaus', 'sabine']);
  });

  it('lists partnerships oldest first, with the other partner resolved', () => {
    expect(family.partnerships('klaus').map((p) => p.partner?.id)).toEqual(['sabine', 'carmen']);
  });

  it('groups children by the partnership they came from', () => {
    const broods = family.broods('klaus');
    expect(broods.map((b) => [b.partner?.id, b.children.map((c) => c.id)])).toEqual([
      ['sabine', ['nina', 'jonas']],
      ['carmen', ['luca']],
    ]);
  });

  it('leaves childless partnerships out of the broods', () => {
    expect(family.broods('elisabeth').every((b) => b.children.length > 0)).toBe(true);
  });

  it('finds people by nickname and maiden name', () => {
    expect(family.search('oma')[0]?.id).toBe('elisabeth');
    expect(family.search('vogt')[0]?.id).toBe('elisabeth');
    expect(family.search('tommy')[0]?.id).toBe('thomas');
  });

  it('ignores case and accents', () => {
    expect(family.search('AYLA')[0]?.id).toBe('ayla');
    expect(family.search('kaeller')).toEqual([]);
    expect(family.search('këller').length).toBeGreaterThan(0);
  });

  it('ranks name-start matches above matches inside a word', () => {
    const ranked = family.search('el').map((p) => p.id);
    // Elisabeth starts with "el"; the Kellers only contain it.
    expect(ranked[0]).toBe('elisabeth');
    expect(ranked.indexOf('felix')).toBeGreaterThan(0);
  });

  it('returns nothing for a blank query', () => {
    expect(family.search('   ')).toEqual([]);
  });

  it('finds people by place, job and year of birth', () => {
    expect(family.search('lissabon')[0]?.id).toBe('jonas');
    expect(family.search('schreiner')[0]?.id).toBe('heinrich');
    expect(family.search('1989')[0]?.id).toBe('jonas');
  });

  it('needs every word of the query to match', () => {
    expect(family.search('bauer lindau').map((p) => p.id).sort()).toEqual(['elisabeth', 'heinrich', 'klaus']);
    expect(family.search('klaus lissabon')).toEqual([]);
  });

  it('searches extra words, such as what someone is to the viewer', () => {
    const extra = (p: { id: string }) => [p.id === 'brigitte' ? 'Tante' : undefined];
    expect(family.search('tante', { extra }).map((p) => p.id)).toEqual(['brigitte']);
  });
});

describe('adoption', () => {
  it('makes adopted children children, and marks them', () => {
    expect(family.parents('marie').map((p) => p.id)).toEqual(['thomas', 'petra']);
    expect(family.adopted('marie')).toBe(true);
    expect(family.adopted('nina')).toBe(false);
  });
});

describe('paths', () => {
  it('goes through the common ancestors between blood relatives', () => {
    expect(family.path('jonas', 'felix')).toEqual(['jonas', 'klaus', 'heinrich', 'brigitte', 'felix']);
  });

  it('crosses a partnership to reach in-laws', () => {
    expect(family.path('emil', 'ayla')).toEqual(['emil', 'ayla']);
    expect(family.path('tim', 'jonas')).toEqual(['tim', 'nina', 'klaus', 'jonas']);
  });

  it('is the person alone for a path to themselves, and nothing for strangers', () => {
    expect(family.path('mia', 'mia')).toEqual(['mia']);
    expect(family.path('mia', 'nobody')).toBeUndefined();
  });
});

describe('subtrees', () => {
  it('keeps only the ancestors, and the partnerships between them', () => {
    const graph = family.ancestorsGraph('nina');
    expect([...graph.people.keys()].sort()).toEqual(['elisabeth', 'heinrich', 'ingrid', 'klaus', 'nina', 'sabine', 'werner']);
    expect(graph.unions.map((u) => [u.partners, u.children])).toEqual([
      [['heinrich', 'elisabeth'], ['klaus']],
      [['werner', 'ingrid'], ['sabine']],
      [['klaus', 'sabine'], ['nina']],
    ]);
  });

  it("keeps the descendants and their partners, but not the partners' other families", () => {
    const graph = family.descendantsGraph('klaus');
    expect([...graph.people.keys()].sort()).toEqual(['ben', 'carmen', 'jonas', 'klaus', 'luca', 'mia', 'nina', 'sabine', 'tim']);
    expect(new Family(graph).children('klaus').map((p) => p.id)).toEqual(['nina', 'jonas', 'luca']);
  });
});
