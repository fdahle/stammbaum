import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFamily } from '../src/parser/parse';
import { unionEnd, unionId, unionStart, unionStatus, type Union } from '../src/parser/types';

const sample = readFileSync(new URL('../sample/family.md', import.meta.url), 'utf8');

describe('parseFamily', () => {
  it('reads the title from the first markdown heading', () => {
    expect(parseFamily(sample).title).toBe('Familie Bauer');
  });

  it('ignores prose outside the family block', () => {
    const graph = parseFamily('# T\n\nperson ghost "Ghost"\n\n```family\nperson real "Real"\n```\n');
    expect([...graph.people.keys()]).toEqual(['real']);
  });

  it('parses people with quoted names and attributes', () => {
    const graph = parseFamily(sample);
    expect(graph.people.get('heinrich')).toMatchObject({
      name: 'Heinrich Bauer',
      born: '1931-04-02',
      died: '2011-08-17',
      photo: 'heinrich.svg',
      note: 'Baute das Haus in Lindau.',
    });
    expect(graph.people.get('elisabeth')?.maiden).toBe('Vogt');
  });

  it('parses partnerships with children on one line', () => {
    const union = parseFamily(sample).unions.find((u) => u.id === unionId(['klaus', 'sabine']));
    expect(union).toMatchObject({ married: '1984-06-09', divorced: '1996', children: ['nina', 'jonas'] });
  });

  it('models remarriage as a second union', () => {
    const graph = parseFamily(sample);
    const klaus = graph.unions.filter((u) => u.partners.includes('klaus'));
    expect(klaus.map((u) => u.partners)).toEqual([
      ['klaus', 'sabine'],
      ['klaus', 'carmen'],
    ]);
  });

  it('merges statements about the same union, in either partner order', () => {
    const graph = parseFamily('```family\na + b married=1990\nb + a -> c\na + b -> d\n```');
    expect(graph.unions).toHaveLength(1);
    expect(graph.unions[0]).toMatchObject({ married: '1990', children: ['c', 'd'] });
  });

  it('parses an unmarried partnership', () => {
    const graph = parseFamily('```family\na + b together=2015 -> c\nd + e together=2008 separated=2014\n```');
    expect(graph.unions[0]).toMatchObject({ together: '2015', children: ['c'] });
    expect(graph.unions[1]).toMatchObject({ together: '2008', separated: '2014' });
    expect(graph.warnings.filter((w) => w.message.startsWith('unknown'))).toEqual([]);
  });

  it('supports a single parent and the children= attribute', () => {
    const graph = parseFamily('```family\nperson a "A"\na children=b, c\n```');
    expect(graph.unions[0]).toMatchObject({ partners: ['a'], children: ['b', 'c'] });
  });

  it('tolerates missing spaces around + and ->', () => {
    const graph = parseFamily('```family\na+b->c\n```');
    expect(graph.unions[0]).toMatchObject({ partners: ['a', 'b'], children: ['c'] });
  });

  it('creates stubs for undeclared people and warns', () => {
    const graph = parseFamily('```family\nperson a "A"\na + b -> c\n```');
    expect(graph.people.get('b')).toMatchObject({ name: 'b', stub: true });
    expect(graph.warnings.map((w) => w.message)).toContain('no "person" declaration for "b"');
  });

  it('warns about unknown attributes instead of throwing', () => {
    const graph = parseFamily('```family\nperson a "A" height=180\n```');
    expect(graph.warnings[0]?.message).toBe('unknown person attribute "height"');
  });

  it('reads places, job, login and a list of photos', () => {
    const graph = parseFamily(
      '```family\nperson a "A" birthplace=Lindau deathplace="Bad Wörishofen" job="Lehrerin" lives=Lissabon login=anna photos=a.jpg, b.jpg\n```',
    );
    expect(graph.people.get('a')).toMatchObject({
      birthplace: 'Lindau',
      deathplace: 'Bad Wörishofen',
      job: 'Lehrerin',
      lives: 'Lissabon',
      login: 'anna',
      photos: ['a.jpg', 'b.jpg'],
    });
    expect(graph.warnings).toEqual([]);
  });

  it('makes adopted children children of the partnership, and remembers which', () => {
    const graph = parseFamily('```family\na + b -> c adopted=d, e\n```');
    expect(graph.unions[0]).toMatchObject({ children: ['c', 'd', 'e'], adopted: ['d', 'e'] });
    const both = parseFamily('```family\na + b adopted=d -> d\n```');
    expect(both.unions[0]).toMatchObject({ children: ['d'], adopted: ['d'] });
  });

  it('has no warnings for the shipped sample data', () => {
    expect(parseFamily(sample).warnings).toEqual([]);
  });
});

describe('unionStatus', () => {
  const union = (fields: Partial<Union>): Union => ({ id: 'a+b', partners: ['a', 'b'], children: [], ...fields });

  it('treats a partnership without any date as a marriage', () => {
    expect(unionStatus(union({}))).toBe('married');
  });

  it('reads together= as an unmarried couple', () => {
    expect(unionStatus(union({ together: '2015' }))).toBe('together');
    expect(unionStatus(union({ together: '?' }))).toBe('together');
  });

  it('ends a marriage with divorced= and a relationship with separated=', () => {
    expect(unionStatus(union({ married: '1984', divorced: '1996' }))).toBe('divorced');
    expect(unionStatus(union({ together: '2008', separated: '2014' }))).toBe('separated');
  });

  it('stays divorced when a marriage followed the relationship', () => {
    expect(unionStatus(union({ together: '2005', married: '2008', separated: '2014' }))).toBe('divorced');
  });

  it('reports start and end whichever keys were used', () => {
    expect(unionStart(union({ together: '2015' }))).toBe('2015');
    expect(unionStart(union({ married: '1956' }))).toBe('1956');
    expect(unionEnd(union({ separated: '2014' }))).toBe('2014');
    expect(unionEnd(union({}))).toBeUndefined();
  });

  it('keeps the state but drops the date when there is none to show', () => {
    for (const value of ['?', 'true', 'True', 'yes', '']) {
      expect(unionStatus(union({ together: value }))).toBe('together');
      expect(unionStart(union({ together: value }))).toBeUndefined();
      expect(unionStatus(union({ divorced: value }))).toBe('divorced');
      expect(unionEnd(union({ divorced: value }))).toBeUndefined();
    }
  });
});

const block = (lines: string) => parseFamily(`\`\`\`family\n${lines}\n\`\`\``);
const messages = (lines: string) => block(lines).warnings.map((w) => w.message);

describe('mistakes in the file', () => {
  it('warns about a relation with nobody in front of it instead of failing', () => {
    const graph = block('person anna "Anna"\n-> anna\n+ anna');
    expect([...graph.people.keys()]).toEqual(['anna']);
    expect(graph.warnings.map((w) => w.line)).toEqual([3, 4]);
  });

  it('keeps %% inside quotes and still strips the comment after them', () => {
    expect(block('person a "A" note="100%% sicher" %% a comment').people.get('a')?.note).toBe('100%% sicher');
  });

  it('warns when a person is declared twice', () => {
    expect(messages('person a "A"\nperson a "Anna"')).toEqual(['"a" was already declared on line 2 — the later values win']);
  });

  it('warns about a child older than its parent, a death before the birth, and a loop', () => {
    const found = messages(
      'person p "P" born=1990\nperson c "C" born=1980 died=1970\np -> c\nperson x "X"\nperson y "Y"\nx -> y\ny -> x',
    );
    expect(found).toContain('"c" died before they were born');
    expect(found).toContain('"c" is born no later than their parent "p"');
    expect(found).toContain('"x" ends up among their own ancestors');
    expect(found).toContain('"y" ends up among their own ancestors');
  });

  it('does not mind an adopted child older than a young adoptive parent', () => {
    expect(messages('person p "P" born=1990\nperson c "C" born=1985\np adopted=c')).toEqual([]);
  });

  it('has nothing to say about the sample', () => {
    expect(parseFamily(sample).warnings).toEqual([]);
  });
});

describe('remarriage to the same person', () => {
  it('gives a couple who married each other again a second partnership', () => {
    const graph = block('a + b married=1980 divorced=1985 -> c\na + b married=1990 -> d\nb + a -> e');
    expect(graph.unions.map((u) => [u.id, u.married, u.divorced, u.children])).toEqual([
      ['a+b', '1980', '1985', ['c']],
      ['a+b~2', '1990', undefined, ['d', 'e']],
    ]);
  });

  it('still merges an end written on a line of its own', () => {
    expect(block('a + b married=1980\na + b divorced=1985').unions).toHaveLength(1);
  });
});
