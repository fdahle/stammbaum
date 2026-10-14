import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Family } from '../src/family';
import { parseFamily } from '../src/parser/parse';
import { familyStats } from '../src/stats';

const sample = new Family(parseFamily(readFileSync(new URL('../sample/family.md', import.meta.url), 'utf8')));
const stats = familyStats(sample, { y: 2026, m: 10, d: 14 });
const ids = (people: Array<{ id: string }>) => people.map((p) => p.id);

describe('familyStats', () => {
  it('counts the people, the living, the generations and the couples that last', () => {
    expect(stats).toMatchObject({ people: 22, living: 20, deceased: 2, generations: 4, couples: 5 });
  });

  it('finds the oldest, the youngest and who lived longest', () => {
    expect(stats.oldestLiving).toMatchObject({ person: { id: 'elisabeth' }, years: 91, approx: false });
    expect(stats.youngest?.id).toBe('emil');
    expect(stats.oldestEver).toMatchObject({ person: { id: 'werner' }, years: 83 });
  });

  it('measures a marriage up to the first death', () => {
    // Werner and Ingrid, 1960 until Werner died in 2019 — longer than Heinrich and Elisabeth's 55 years.
    expect(stats.longestMarriage && ids(stats.longestMarriage.people)).toEqual(['werner', 'ingrid']);
    expect(stats.longestMarriage).toMatchObject({ years: 59, lasting: false });
  });

  it('names every winner of a tie', () => {
    expect(stats.surname).toEqual({ values: ['Bauer', 'Schmitt', 'Keller'], count: 6 });
    expect(stats.birthMonth).toEqual({ values: [4], count: 3 });
  });

  it('leaves a record out when nothing occurs twice', () => {
    expect(stats.birthplace).toBeUndefined();
  });

  it('measures a lasting marriage to today, and survives a family that loops', () => {
    const family = new Family(
      parseFamily('```family\nperson a "A"\nperson b "B"\na + b married=2000-06-01\na -> b\nb -> a\n```'),
    );
    const looped = familyStats(family, { y: 2026, m: 10, d: 14 });
    expect(looped.longestMarriage).toMatchObject({ years: 26, lasting: true });
    expect(looped.generations).toBe(2);
  });
});

describe('most children', () => {
  it('keeps every couple on a tie, and names a single winner', () => {
    expect(stats.mostChildren?.count).toBe(2);
    expect(stats.mostChildren?.couples.map(ids)).toEqual([
      ['heinrich', 'elisabeth'],
      ['werner', 'ingrid'],
      ['klaus', 'sabine'],
      ['brigitte', 'martin'],
      ['nina', 'tim'],
    ]);
    const one = familyStats(new Family(parseFamily('```family\na + b -> c, d, e\nc -> f\n```')), { y: 2026 });
    expect(one.mostChildren).toMatchObject({ count: 3, couples: [[{ id: 'a' }, { id: 'b' }]] });
  });
});
