import { describe, expect, it } from 'vitest';
import { Family } from '../src/family';
import { duplicates, gaps } from '../src/missing';
import { parseFamily } from '../src/parser/parse';

const family = new Family(
  parseFamily(`
\`\`\`family
person a "A" sex=f born=1950-01-01 photo=a.jpg
person b "B" sex=m born=1952
a + b -> c
person c "C" born=1980-02-02 photo=missing.jpg
person d "D" sex=m born=1900
person e "E" sex=f born=1930-03-03 died=?
a -> e
person loner "Loner" sex=f born=1990-04-04
\`\`\`
`),
);
const found = gaps(family, (p) => p.photo === 'a.jpg', { y: 2026, m: 10, d: 14 });
const summary = Object.fromEntries(
  found.map((gap) => [gap.kind, gap.people.map(({ person, detail }) => (detail ? `${person.id}:${detail}` : person.id))]),
);

describe('gaps', () => {
  it('lists what each person is missing, worst first and in file order', () => {
    expect(found.map((gap) => gap.kind)).toEqual([
      'disconnected',
      'noSex',
      'partialBirth',
      'probablyDeceased',
      'undatedDeath',
      'noPhoto',
    ]);
  });

  it('finds whoever is not linked to the biggest branch', () => {
    expect(summary.disconnected).toEqual(['d', 'loner']);
  });

  it('says what the file has so far', () => {
    expect(summary.partialBirth).toEqual(['b:1952', 'd:1900']);
    expect(summary.probablyDeceased).toEqual(['d:1900']);
    expect(summary.noPhoto).toEqual(['b', 'c:missing.jpg', 'd', 'e', 'loner']);
  });

  it('knows people mentioned only in a relation', () => {
    const stub = gaps(new Family(parseFamily('```family\nperson a "A"\na -> ghost\n```')), () => true, { y: 2026 });
    expect(stub[0]).toMatchObject({ kind: 'undeclared', people: [{ person: { id: 'ghost' } }] });
  });
});

describe('people entered twice', () => {
  it('pairs the same name, or a birth name, unless something tells them apart', () => {
    const family = new Family(
      parseFamily(`\`\`\`family
person erna "Erna Tanke" sex=f born=1940
person erna2 "Erna Tanke"
person birgit "Birgit Dahle" maiden=Tanke
person birgit2 "Birgit Tanke" born=1965
person klaus "Klaus Bauer" born=1958
person klaus2 "Klaus Bauer" born=1987
person mutter "Mutter von Erna"
person mutter2 "Mutter von Erna"
\`\`\``),
    );
    expect(duplicates(family).map(([a, b]) => `${a.id}=${b.id}`)).toEqual(['erna=erna2', 'birgit=birgit2']);
  });
});
