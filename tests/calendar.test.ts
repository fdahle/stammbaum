import { describe, expect, it } from 'vitest';
import { upcoming } from '../src/calendar';
import { Family } from '../src/family';
import { parseFamily } from '../src/parser/parse';

const family = new Family(
  parseFamily(`
\`\`\`family
person oma "Oma" born=1936-10-20
person opa "Opa" born=1930-10-16 died=2010
oma + opa married=1956-10-25
person kid "Kid" born=2020-10-14
person ann "Ann" born=1980
person leap "Leap" born=2000-02-29
person x "X" born=1970-01-05
person y "Y" born=1972-03-03
x + y together=2010-10-30
person p "P" born=1971-05-05
person q "Q" born=1971-06-06
p + q married=2000-10-20 divorced=2010
\`\`\`
`),
);

const summary = (now: { y: number; m: number; d: number }) =>
  upcoming(family, now).map((o) => [o.kind, o.people.map((p) => p.id), o.days, o.years]);

describe('upcoming', () => {
  it('lists the birthdays of the living and lasting anniversaries, soonest first', () => {
    expect(summary({ y: 2026, m: 10, d: 14 })).toEqual([
      ['birthday', ['kid'], 0, 6],
      ['birthday', ['oma'], 6, 90],
      ['together', ['x', 'y'], 16, 16],
    ]);
  });

  it('looks past the end of the year', () => {
    expect(summary({ y: 2026, m: 12, d: 20 })).toEqual([['birthday', ['x'], 16, 57]]);
  });

  it('keeps a 29 February birthday on the 28th in other years', () => {
    expect(summary({ y: 2027, m: 2, d: 20 })).toEqual([
      ['birthday', ['leap'], 8, 27],
      ['birthday', ['y'], 11, 55],
    ]);
  });
});
