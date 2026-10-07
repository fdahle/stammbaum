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
});

describe('adoption', () => {
  it('makes adopted children children, and marks them', () => {
    expect(family.parents('marie').map((p) => p.id)).toEqual(['thomas', 'petra']);
    expect(family.adopted('marie')).toBe(true);
    expect(family.adopted('nina')).toBe(false);
  });
});
