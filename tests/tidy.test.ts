import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFamily } from '../src/parser/parse';
import { tidyText } from '../src/parser/tidy';
import { unionStatus, type FamilyGraph } from '../src/parser/types';
import { applyEdits } from '../src/parser/write';

const sample = readFileSync(new URL('../sample/family.md', import.meta.url), 'utf8');

// Written the way it grows in the app: in the order things were added.
const grown = readFileSync(new URL('./fixtures/grown.md', import.meta.url), 'utf8');

/** What the file says, independent of how it is written down. */
function meaning(graph: FamilyGraph) {
  return {
    people: [...graph.people.values()].map(({ line: _line, ...person }) => person).sort((a, b) => a.id.localeCompare(b.id)),
    unions: graph.unions
      .map((u) => ({ partners: [...u.partners].sort(), children: [...u.children].sort(), status: unionStatus(u), divorced: u.divorced, adopted: u.adopted }))
      .sort((a, b) => a.partners.join().localeCompare(b.partners.join())),
    me: graph.me,
  };
}

describe('tidying family.md', () => {
  const tidy = tidyText(grown);

  it('says exactly what it said before', () => {
    expect(meaning(parseFamily(tidy))).toEqual(meaning(parseFamily(grown)));
    expect(meaning(parseFamily(tidyText(sample)))).toEqual(meaning(parseFamily(sample)));
  });

  it('changes nothing the second time', () => {
    expect(tidyText(tidy)).toBe(tidy);
    expect(tidyText(tidyText(sample))).toBe(tidyText(sample));
  });

  it('orders by generation, household by household, with the person lines aligned', () => {
    const block = tidy.slice(tidy.indexOf('```family') + 10, tidy.lastIndexOf('```') - 1);
    expect(block).toBe(`%% ---- Generation 1
%% Ernas Eltern kennt noch niemand
person mutter "Mutter von Erna" sex=f
person vater  "Vater von Erna"  sex=m
mutter + vater -> erna

%% ---- Generation 2
person erna    "Erna Tanke"    sex=f
person hermann "Hermann Tanke" sex=m died=?
erna + hermann -> birgit, detlef

person ursula  "Ursula Dahle"  sex=f
person bernd   "Bernd Dahle"   sex=m died=?
ursula + bernd married=? divorced=? -> christian, heiko, henning

%% ---- Generation 3
person birgit          "Birgit Dahle"    sex=f maiden=Tanke
person christian       "Christian Dahle" sex=m
birgit + christian -> felix, carolina

person detlef          "Detlef Tanke"    sex=m
person heiko           "Heiko Dahle"     sex=m
person henning         "Henning Dahle"   sex=m

person elke            "Elke Unger"      sex=f
person christian-unger "Christian Unger" sex=m
elke + christian-unger divorced=? -> anja, alexandra

%% ---- Generation 4
person felix     "Felix Dahle"     sex=m born=1992-05-08 birthplace=Nuremberg lives=Leiden country=NL
person anja      "Anja Unger"      sex=f born=1994-11-29
felix + anja married=2022-07-30 -> leon

person carolina  "Carolina Dahle"  sex=f born=1994-05-11
person alexandra "Alexandra Unger" sex=f nick=Trini

%% ---- Generation 5
person leon "Leon Dahle" sex=m born=2024-12-10  %% der Kleine`);
  });

  it('leaves the prose around the block alone', () => {
    expect(tidy.startsWith('# Familie Dahle\n\n```family\n')).toBe(true);
    expect(tidy.endsWith('```\n\nNotizen unter dem Stammbaum bleiben, wo sie sind.\n')).toBe(true);
  });

  it('keeps the sample’s own comments', () => {
    const tidied = tidyText(sample);
    expect(tidied).toContain('%% Marie was adopted: adopted= makes her their child and marks her as such.\nthomas + petra married=1992 adopted=marie');
    expect(tidied).toContain('me jonas');
  });

  it('is one edit in the app, which also gives app-made ids their present form', () => {
    const { markdown, renamed } = applyEdits(grown, [{ kind: 'tidy' }]);
    expect(renamed).toMatchObject({ felix: 'felix-dahle', ursula: 'ursula-dahle', mutter: 'mutter-von-erna' });
    expect(renamed['christian-unger']).toBeUndefined();
    expect(markdown).toContain('felix-dahle + anja-unger married=2022-07-30 -> leon-dahle');
    expect(tidyText(markdown)).toBe(markdown);
  });
});
