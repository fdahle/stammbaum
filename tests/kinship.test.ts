import { describe, expect, it } from 'vitest';
import { parseFamily } from '../src/parser/parse';
import { Family } from '../src/family';
import { relation } from '../src/kinship';

const family = new Family(
  parseFamily(`
\`\`\`family
me max
person uropa "Uropa" sex=m
person opa "Opa" sex=m
person oma "Oma" sex=f
uropa -> opa
opa + oma -> vater, tante

person vater "Vater" sex=m
person mutter "Mutter" sex=f
person neue "Neue" sex=f
vater + mutter -> max, bruder
vater + neue together=2010 -> halb

person max "Max" sex=m
person frau "Frau" sex=f
max + frau married=2020
person sv "Schwiegervater" sex=m
sv -> frau

person bruder "Bruder" sex=m
person halb "Halb" sex=f
person schwaegerin "Schwägerin" sex=f
bruder + schwaegerin -> nichte
person nichte "Nichte" sex=f

person tante "Tante" sex=f
person onkel "Onkel" sex=m
tante + onkel -> cousine
person cousine "Cousine" sex=f
person ex "Ex" sex=m
person cousinmann "Mann" sex=m
cousine + ex divorced=?
cousine + cousinmann -> kim
person kim "Kim Keller"
person robin "Robin" sex=m
kim + robin together=?

person fremd "Fremd" sex=m
\`\`\`
`),
);

const as = (from: string, to: string) => relation(family, from, to);

describe('relation', () => {
  it('names direct ancestors and descendants', () => {
    expect(as('max', 'vater')).toBe('Vater');
    expect(as('max', 'mutter')).toBe('Mutter');
    expect(as('max', 'oma')).toBe('Großmutter');
    expect(as('max', 'uropa')).toBe('Urgroßvater');
    expect(as('uropa', 'max')).toBe('Urenkel');
    expect(as('vater', 'bruder')).toBe('Sohn');
  });

  it('tells full siblings from half siblings', () => {
    expect(as('max', 'bruder')).toBe('Bruder');
    expect(as('max', 'halb')).toBe('Halbschwester');
  });

  it('names aunts, uncles, nieces and cousins in both directions', () => {
    expect(as('max', 'tante')).toBe('Tante');
    expect(as('max', 'nichte')).toBe('Nichte');
    expect(as('nichte', 'max')).toBe('Onkel');
    expect(as('max', 'cousine')).toBe('Cousine');
    expect(as('cousine', 'max')).toBe('Cousin');
    expect(as('kim', 'max')).toBe('Großcousin');
    expect(as('kim', 'nichte')).toBe('Cousine 2. Grades');
  });

  it('names both forms when the sex is not given', () => {
    expect(as('max', 'kim')).toBe('Großcousin(e)');
    expect(as('nichte', 'kim')).toBe('Cousin(e) 2. Grades');
  });

  it('names partners of blood relatives', () => {
    expect(as('max', 'frau')).toBe('Ehefrau');
    expect(as('max', 'neue')).toBe('Stiefmutter');
    expect(as('max', 'schwaegerin')).toBe('Schwägerin');
    expect(as('max', 'onkel')).toBe('Onkel');
    expect(as('max', 'cousinmann')).toBe('Mann der Cousine');
    expect(as('max', 'ex')).toBe('Ex-Mann der Cousine');
    expect(as('max', 'robin')).toBe('Partner von Kim');
  });

  it('names blood relatives of the partner', () => {
    expect(as('max', 'sv')).toBe('Schwiegervater');
    expect(as('frau', 'vater')).toBe('Schwiegervater');
    expect(as('frau', 'bruder')).toBe('Schwager');
    expect(as('frau', 'tante')).toBe('Tante des Mannes');
  });

  it('calls the reference person themselves and leaves strangers blank', () => {
    expect(as('max', 'max')).toBe('Ich');
    expect(as('max', 'fremd')).toBeUndefined();
  });
});

describe('me and sex in the file', () => {
  it('reads the me line and m, f and w', () => {
    const graph = parseFamily('```family\nme a\nperson a "A" sex=m\nperson b "B" sex=w\nperson c "C" sex=f\n```');
    expect(graph.me).toBe('a');
    expect(['a', 'b', 'c'].map((id) => graph.people.get(id)?.sex)).toEqual(['m', 'f', 'f']);
    expect(graph.warnings).toEqual([]);
  });

  it('warns about an unknown me and an unknown sex', () => {
    const graph = parseFamily('```family\nme ghost\nperson a "A" sex=x\n```');
    expect(graph.me).toBeUndefined();
    expect(graph.warnings.map((w) => w.message)).toEqual([
      'sex must be m or f, got "x"',
      '"me" names unknown person "ghost"',
    ]);
  });
});

describe('relation in English', () => {
  const en = (from: string, to: string) => relation(family, from, to, 'en');

  it('names ancestors, descendants and siblings', () => {
    expect(en('max', 'vater')).toBe('Father');
    expect(en('max', 'oma')).toBe('Grandmother');
    expect(en('max', 'uropa')).toBe('Great-grandfather');
    expect(en('uropa', 'max')).toBe('Great-grandson');
    expect(en('max', 'halb')).toBe('Half-sister');
  });

  it('names aunts, nieces and cousins with degree and removal', () => {
    expect(en('max', 'tante')).toBe('Aunt');
    expect(en('nichte', 'max')).toBe('Uncle');
    expect(en('max', 'cousine')).toBe('Cousin');
    expect(en('kim', 'max')).toBe('Cousin once removed');
    expect(en('kim', 'nichte')).toBe('Second cousin');
    expect(en('max', 'kim')).toBe('Cousin once removed');
  });

  it('names partners and in-laws', () => {
    expect(en('max', 'frau')).toBe('Wife');
    expect(en('max', 'neue')).toBe('Stepmother');
    expect(en('max', 'schwaegerin')).toBe('Sister-in-law');
    expect(en('max', 'cousinmann')).toBe("Cousin's husband");
    expect(en('max', 'ex')).toBe("Cousin's ex-husband");
    expect(en('max', 'robin')).toBe("Kim's partner");
    expect(en('max', 'sv')).toBe('Father-in-law');
    expect(en('frau', 'tante')).toBe("Husband's aunt");
  });

  it('calls the reference person "Me"', () => {
    expect(en('max', 'max')).toBe('Me');
    expect(en('max', 'fremd')).toBeUndefined();
  });
});

describe('patchwork families', () => {
  const patchwork = new Family(
    parseFamily(`
\`\`\`family
person mama "Mama" sex=f
person papa "Papa" sex=m
person neu "Neu" sex=m
person exfrau "Exfrau" sex=f
person ich "Ich" sex=f
person bruder "Bruder" sex=m
person stief "Stief" sex=m
mama + papa married=1985 divorced=2000 -> ich, bruder
mama + neu married=2005
neu + exfrau married=1990 divorced=2001 -> stief

person ehemann "Ehemann" sex=m
person schwager "Schwager" sex=m
person schwipp "Schwipp" sex=f
person schwiema "Schwiegermutter" sex=f
ich + ehemann married=2015
schwiema -> ehemann, schwager
schwager + schwipp married=2018

person bfrau "Bfrau" sex=f
person bfs "Bfs" sex=f
person bfmama "Bfmama" sex=f
bruder + bfrau married=2019
bfmama -> bfrau, bfs
\`\`\`
`),
  );

  it("names the children of a parent's partner step-siblings", () => {
    expect(relation(patchwork, 'ich', 'stief')).toBe('Stiefbruder');
    expect(relation(patchwork, 'stief', 'ich')).toBe('Stiefschwester');
    expect(relation(patchwork, 'ich', 'stief', 'en')).toBe('Stepbrother');
  });

  it("names a partner's sibling's partner, and a sibling's partner's sibling, Schwippschwager", () => {
    expect(relation(patchwork, 'ich', 'schwipp')).toBe('Schwippschwägerin');
    expect(relation(patchwork, 'schwipp', 'ich')).toBe('Schwippschwägerin');
    expect(relation(patchwork, 'ich', 'bfs')).toBe('Schwippschwägerin');
    expect(relation(patchwork, 'ich', 'schwipp', 'en')).toBe('Sister-in-law');
  });

  it('calls someone who married their ex again a spouse, not an ex', () => {
    const twice = new Family(
      parseFamily('```family\nperson a "A" sex=f\nperson b "B" sex=m\na + b married=1980 divorced=1985\na + b married=1990\n```'),
    );
    expect(relation(twice, 'a', 'b')).toBe('Ehemann');
  });
});

describe('a couple who married each other twice', () => {
  const twice = new Family(
    parseFamily(
      '```family\nperson c "C" sex=f\nperson d "D" sex=m\na + b married=1970 divorced=1975 -> c\na + b married=1980 -> d\n```',
    ),
  );

  it('have full siblings, not half ones, across both marriages', () => {
    expect(relation(twice, 'c', 'd')).toBe('Bruder');
  });
});
