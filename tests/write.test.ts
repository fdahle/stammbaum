import { describe, expect, it } from 'vitest';
import { parseFamily } from '../src/parser/parse';
import { applyEdits, EditError, quote, type Edit } from '../src/parser/write';

const FILE = `# Familie Test

Prose stays as it is.

\`\`\`family
me jonas

%% ---- Generation 1
person heinrich  "Heinrich Bauer"   sex=m born=1931-04-02 died=2011  %% der Opa
person elisabeth "Elisabeth Bauer"  sex=f born=1934 nick=Oma

heinrich + elisabeth married=1956 -> klaus, brigitte

%% ---- Generation 2
person klaus    "Klaus Bauer"   sex=m born=1958
person brigitte "Brigitte Keller" sex=f
person sabine   "Sabine Schmitt" sex=f
klaus + sabine married=1984 divorced=1996 -> jonas
person jonas "Jonas Bauer" sex=m
\`\`\`

More prose.
`;

const apply = (...edits: Edit[]) => applyEdits(FILE, edits);
/** The lines that differ, as [before, after] pairs — what a diff would show. */
function changed(after: string, before = FILE): { removed: string[]; added: string[] } {
  const old = before.split('\n');
  const now = after.split('\n');
  return { removed: old.filter((l) => !now.includes(l)), added: now.filter((l) => !old.includes(l)) };
}

describe('quote', () => {
  it('leaves plain words bare and quotes the rest, escaping quotes', () => {
    expect(quote('Lindau')).toBe('Lindau');
    expect(quote('1956-04-02')).toBe('1956-04-02');
    expect(quote('Bad Wörishofen')).toBe('"Bad Wörishofen"');
    expect(quote('a+b')).toBe('"a+b"');
    expect(quote('100%%')).toBe('"100%%"');
    expect(quote('sagte "hallo"')).toBe('"sagte \\"hallo\\""');
  });

  it('round-trips through the parser, quotes and backslashes included', () => {
    const note = 'Er sagte "Moin" \\ und ging, 100%% sicher -> weg';
    const { markdown } = apply({ kind: 'person', id: 'klaus', set: { note } });
    expect(parseFamily(markdown).people.get('klaus')?.note).toBe(note);
  });
});

describe('editing a person', () => {
  it('changes only the words it is about, keeping alignment and comments', () => {
    const { markdown } = apply({ kind: 'person', id: 'heinrich', set: { born: '1931-04-03', job: 'Schreiner' } });
    expect(changed(markdown)).toEqual({
      removed: ['person heinrich  "Heinrich Bauer"   sex=m born=1931-04-02 died=2011  %% der Opa'],
      added: ['person heinrich  "Heinrich Bauer"   sex=m born=1931-04-03 died=2011 job=Schreiner  %% der Opa'],
    });
  });

  it('renames, and takes fields out', () => {
    const { markdown } = apply({ kind: 'person', id: 'elisabeth', set: { name: 'Elisabeth Maria Bauer', nick: null } });
    // The id came from the name, so it follows it.
    expect(changed(markdown).added).toEqual([
      'person elisabeth-maria-bauer "Elisabeth Maria Bauer"  sex=f born=1934',
      'heinrich + elisabeth-maria-bauer married=1956 -> klaus, brigitte',
    ]);
  });

  it('treats an empty value as taking the field out', () => {
    const { markdown } = apply({ kind: 'person', id: 'klaus', set: { born: '  ' } });
    expect(changed(markdown).added).toEqual(['person klaus    "Klaus Bauer"   sex=m']);
  });

  it('notices a change someone else made in the meantime', () => {
    const edit: Edit = { kind: 'person', id: 'klaus', set: { born: '1959' }, was: { born: '1957' } };
    expect(() => apply(edit)).toThrow(EditError);
    expect(apply({ ...edit, was: { born: '1958' } }).markdown).toContain('born=1959');
  });

  it('refuses nonsense', () => {
    expect(() => apply({ kind: 'person', id: 'klaus', set: { sex: 'x' } })).toThrow(/sex/);
    expect(() => apply({ kind: 'person', id: 'klaus', set: { name: '' } })).toThrow(/name/);
    expect(() => apply({ kind: 'person', id: 'klaus', set: { colour: 'blue' } as never })).toThrow(/cannot be changed/);
    expect(() => apply({ kind: 'person', id: 'nobody', set: { job: 'x' } })).toThrow(/no longer/);
  });

  it('gives someone only mentioned in a relation a line of their own', () => {
    const file = FILE.replace('klaus + sabine', 'klaus + sabine -> ghost\nklaus + sabine');
    const { markdown } = applyEdits(file, [{ kind: 'person', id: 'ghost', set: { name: 'Geist Bauer' } }]);
    expect(parseFamily(markdown).people.get('ghost')).toMatchObject({ name: 'Geist Bauer' });
    expect(parseFamily(markdown).people.get('ghost')?.stub).toBeUndefined();
  });

  it('writes a change into the last of several declarations, which is the one that counts', () => {
    const file = FILE.replace('person jonas "Jonas Bauer" sex=m', 'person jonas "Jonas" job=Koch\nperson jonas "Jonas Bauer" sex=m');
    const { markdown } = applyEdits(file, [{ kind: 'person', id: 'jonas', set: { job: 'Architekt' } }]);
    expect(markdown).toContain('person jonas "Jonas"\n');
    expect(markdown).toContain('person jonas "Jonas Bauer" sex=m job=Architekt');
  });
});

describe('adding people and relations', () => {
  it('adds a child next to their siblings and into the parents’ line', () => {
    const { markdown, created } = apply(
      { kind: 'add-person', ref: '$kid', set: { name: 'Nina Bauer', sex: 'f', born: '1986-02-17' }, near: { id: 'jonas', side: 'before' } },
      { kind: 'add-child', parents: ['klaus', 'sabine'], child: '$kid' },
    );
    expect(created).toEqual({ $kid: 'nina-bauer' });
    expect(changed(markdown)).toEqual({
      removed: ['klaus + sabine married=1984 divorced=1996 -> jonas'],
      added: ['klaus + sabine married=1984 divorced=1996 -> jonas, nina-bauer', 'person nina-bauer "Nina Bauer" sex=f born=1986-02-17'],
    });
    expect(markdown.indexOf('person nina-bauer')).toBeLessThan(markdown.indexOf('person jonas'));
  });

  it('starts a new line for a new couple, after what is said about them', () => {
    const lines = apply(
      { kind: 'add-person', ref: '$p', set: { name: 'Petra Lange' }, near: { id: 'jonas', side: 'after' } },
      { kind: 'add-partnership', partners: ['jonas', '$p'], set: { together: '2015' } },
      { kind: 'add-person', ref: '$kid', set: { name: 'Mia Bauer' }, near: { id: '$p', side: 'after' } },
      { kind: 'add-child', parents: ['jonas', '$p'], child: '$kid' },
    ).markdown.split('\n');
    // Jonas is in no partnership yet, so the couple goes after the newest of their person lines.
    const at = lines.indexOf('person petra-lange "Petra Lange"');
    expect(lines.slice(at - 1, at + 3)).toEqual([
      'person jonas "Jonas Bauer" sex=m',
      'person petra-lange "Petra Lange"',
      'person mia-bauer "Mia Bauer"',
      'jonas + petra-lange together=2015 -> mia-bauer',
    ]);
  });

  it('marks adopted children in an adopted= list', () => {
    const once = apply({ kind: 'add-child', parents: ['heinrich', 'elisabeth'], child: 'sabine', adopted: true }).markdown;
    expect(once).toContain('heinrich + elisabeth married=1956 -> klaus, brigitte adopted=sabine');
    const twice = applyEdits(once, [{ kind: 'add-child', parents: ['heinrich', 'elisabeth'], child: 'jonas', adopted: true }]).markdown;
    expect(twice).toContain('adopted=sabine, jonas');
    expect(parseFamily(twice).unions[0]?.adopted).toEqual(['sabine', 'jonas']);
  });

  it('gives a lone parent a line of their own', () => {
    const { markdown } = apply({ kind: 'add-child', parents: ['brigitte'], child: 'jonas' });
    expect(markdown).toContain('brigitte -> jonas');
    expect(parseFamily(markdown).unions.find((u) => u.id === 'brigitte')?.children).toEqual(['jonas']);
  });

  it('picks ids from the whole name, then the year of birth, then a number', () => {
    const { created } = apply(
      { kind: 'add-person', ref: '$a', set: { name: 'Klaus Müller', born: '1958' } },
      { kind: 'add-person', ref: '$b', set: { name: 'Klaus Müller', born: '1987-04-02' } },
      { kind: 'add-person', ref: '$c', set: { name: 'Klaus Müller' } },
      { kind: 'add-person', ref: '$d', set: { name: 'Jürgen Weiß' } },
    );
    expect(created).toEqual({ $a: 'klaus-mueller', $b: 'klaus-mueller-1987', $c: 'klaus-mueller-2', $d: 'juergen-weiss' });
  });

  it('refuses a partnership that already lasts', () => {
    expect(() => apply({ kind: 'add-partnership', partners: ['heinrich', 'elisabeth'], set: { married: '2000' } })).toThrow(/already/);
  });

  it('writes a marriage without a date as the bare couple — unless the two were married before', () => {
    expect(apply({ kind: 'add-partnership', partners: ['klaus', 'brigitte'], set: {} }).markdown).toContain('\nklaus + brigitte\n');
    expect(apply({ kind: 'add-partnership', partners: ['klaus', 'sabine'], set: {} }).markdown).toContain('\nklaus + sabine married=?\n');
  });

  it('lets a divorced couple marry again, as a second partnership', () => {
    const { markdown } = apply({ kind: 'add-partnership', partners: ['klaus', 'sabine'], set: { married: '2005' } });
    expect(markdown).toContain('klaus + sabine married=1984 divorced=1996 -> jonas\nklaus + sabine married=2005');
    expect(parseFamily(markdown).unions.map((u) => u.id)).toContain('klaus+sabine~2');
  });
});

describe('editing a partnership', () => {
  it('changes dates where they are, and adds new ones before the children', () => {
    const { markdown } = apply({ kind: 'partnership', union: 'elisabeth+heinrich', set: { married: '1956-05-19', divorced: '1970' } });
    expect(changed(markdown).added).toEqual(['heinrich + elisabeth married=1956-05-19 divorced=1970 -> klaus, brigitte']);
  });

  it('takes an end out again', () => {
    const { markdown } = apply({ kind: 'partnership', union: 'klaus+sabine', set: { divorced: null } });
    expect(changed(markdown).added).toEqual(['klaus + sabine married=1984 -> jonas']);
  });

  it('notices a change made in the meantime', () => {
    expect(() => apply({ kind: 'partnership', union: 'klaus+sabine', set: { divorced: '1997' }, was: { divorced: '1995' } })).toThrow(EditError);
  });

  it('removes a childless partnership, but not one with children', () => {
    const file = FILE.replace('person jonas', 'brigitte + sabine together=2020\nperson jonas');
    expect(applyEdits(file, [{ kind: 'delete-partnership', union: 'brigitte+sabine' }]).markdown).toBe(FILE);
    expect(() => apply({ kind: 'delete-partnership', union: 'klaus+sabine' })).toThrow(/children/);
  });
});

describe('removing', () => {
  it('takes a child out of a list, and a list that empties out of its line', () => {
    const one = apply({ kind: 'remove-child', union: 'elisabeth+heinrich', child: 'klaus' }).markdown;
    expect(changed(one).added).toEqual(['heinrich + elisabeth married=1956 -> brigitte']);
    const both = applyEdits(one, [{ kind: 'remove-child', union: 'elisabeth+heinrich', child: 'brigitte' }]).markdown;
    expect(changed(both).added).toEqual(['heinrich + elisabeth married=1956']);
  });

  it('drops the line of a lone parent whose only child goes', () => {
    const file = FILE.replace('person jonas', 'brigitte -> jonas\nperson jonas');
    expect(applyEdits(file, [{ kind: 'remove-child', union: 'brigitte', child: 'jonas' }]).markdown).toBe(FILE);
  });

  it('deletes a person with every mention, the children keeping their other parent', () => {
    const { markdown } = apply({ kind: 'delete-person', id: 'klaus' });
    expect(changed(markdown)).toEqual({
      removed: [
        'heinrich + elisabeth married=1956 -> klaus, brigitte',
        'person klaus    "Klaus Bauer"   sex=m born=1958',
        'klaus + sabine married=1984 divorced=1996 -> jonas',
      ],
      added: ['heinrich + elisabeth married=1956 -> brigitte', 'sabine -> jonas'],
    });
    const graph = parseFamily(markdown);
    expect(graph.warnings).toEqual([]);
    expect(graph.people.has('klaus')).toBe(false);
  });

  it('takes the me line out with its person', () => {
    expect(apply({ kind: 'delete-person', id: 'jonas' }).markdown).not.toContain('me jonas');
  });

  it('leaves everything outside the ```family block alone', () => {
    const { markdown } = apply({ kind: 'delete-person', id: 'sabine' }, { kind: 'person', id: 'klaus', set: { job: 'Lehrer' } });
    expect(markdown.startsWith('# Familie Test\n\nProse stays as it is.\n')).toBe(true);
    expect(markdown.endsWith('```\n\nMore prose.\n')).toBe(true);
  });

  it('keeps Windows line ends', () => {
    const { markdown } = applyEdits(FILE.replace(/\n/g, '\r\n'), [{ kind: 'person', id: 'klaus', set: { job: 'Lehrer' } }]);
    expect(markdown.split('\r\n')).toHaveLength(FILE.split('\n').length);
  });
});

describe('a file that only exists once it is written to', () => {
  it('gets a ```family block of its own', () => {
    const { markdown } = applyEdits('# Neu\n', [{ kind: 'add-person', ref: '$a', set: { name: 'Anna' } }]);
    expect(markdown).toBe('# Neu\n\n```family\nperson anna Anna\n```\n');
    expect(parseFamily(markdown).people.get('anna')?.name).toBe('Anna');
  });

  it('starts an empty file with the block and nothing before it', () => {
    const { markdown } = applyEdits('', [{ kind: 'add-person', ref: '$a', set: { name: 'Anna' } }]);
    expect(markdown).toBe('```family\nperson anna Anna\n```\n');
  });
});

describe('pictures', () => {
  it('writes a portrait and a gallery list the parser reads back', () => {
    const { markdown } = apply({ kind: 'person', id: 'klaus', set: { photo: 'klaus.jpg', photos: 'klaus-2.jpg, klaus 3.jpg' } });
    expect(changed(markdown).added).toEqual(['person klaus    "Klaus Bauer"   sex=m born=1958 photo=klaus.jpg photos="klaus-2.jpg, klaus 3.jpg"']);
    const klaus = parseFamily(markdown).people.get('klaus')!;
    expect(klaus.photo).toBe('klaus.jpg');
    expect(klaus.photos).toEqual(['klaus-2.jpg', 'klaus 3.jpg']);
  });

  it('notices a gallery that changed in the meantime', () => {
    const { markdown } = apply({ kind: 'person', id: 'klaus', set: { photos: 'a.jpg, b.jpg' } });
    const stale: Edit = { kind: 'person', id: 'klaus', set: { photos: 'a.jpg' }, was: { photos: 'a.jpg, c.jpg' } };
    expect(() => applyEdits(markdown, [stale])).toThrow(EditError);
    const fresh: Edit = { kind: 'person', id: 'klaus', set: { photos: 'a.jpg' }, was: { photos: 'a.jpg, b.jpg' } };
    expect(applyEdits(markdown, [fresh]).markdown).toContain('photos=a.jpg');
  });
});

describe('siblings', () => {
  it('without parents yet, gives both a stand-in parent to share', () => {
    const file = '```family\nperson felix "Felix Dahle"\nperson carolina "Carolina Dahle"\n```\n';
    const { markdown, created } = applyEdits(file, [
      { kind: 'add-person', ref: '$parent0', set: { name: 'Eltern von Felix' }, near: { id: 'felix', side: 'before' } },
      { kind: 'add-child', parents: ['$parent0'], child: 'felix' },
      { kind: 'add-child', parents: ['$parent0'], child: 'carolina' },
    ]);
    expect(created).toEqual({ $parent0: 'eltern-von-felix' });
    expect(markdown).toBe('```family\nperson eltern-von-felix "Eltern von Felix"\neltern-von-felix -> felix, carolina\nperson felix "Felix Dahle"\nperson carolina "Carolina Dahle"\n```\n');
  });
});

describe('one parent known, then both', () => {
  const file = '```family\nperson christian "Christian Dahle"\nperson birgit "Birgit Dahle"\nchristian -> felix, carolina\nchristian + birgit married=?\nperson felix "Felix Dahle"\nperson carolina "Carolina Dahle"\n```\n';

  it('moves a child of one parent to the couple instead of listing them twice', () => {
    const { markdown } = applyEdits(file, [
      { kind: 'add-child', parents: ['birgit', 'christian'], child: 'felix' },
      { kind: 'add-child', parents: ['birgit', 'christian'], child: 'carolina' },
    ]);
    expect(markdown).toBe('```family\nperson christian "Christian Dahle"\nperson birgit "Birgit Dahle"\nchristian + birgit married=? -> felix, carolina\nperson felix "Felix Dahle"\nperson carolina "Carolina Dahle"\n```\n');
    const graph = parseFamily(markdown);
    expect(graph.unions.filter((u) => u.children.includes('felix'))).toHaveLength(1);
  });

  it('adds nothing for one parent when the child already has them through a couple', () => {
    const both = applyEdits(file, [{ kind: 'add-child', parents: ['christian', 'birgit'], child: 'felix' }]).markdown;
    expect(applyEdits(both, [{ kind: 'add-child', parents: ['birgit'], child: 'felix' }]).markdown).toBe(both);
  });
});

describe('ids that follow the name', () => {
  const file = '```family\nme eltern\nperson eltern "Eltern von Felix"\neltern -> felix, carolina\nperson oma "Gisela Bauer"\noma + eltern adopted=felix, carolina\nperson felix "Felix Dahle"\nperson carolina "Carolina Dahle"\n```\n';

  it('renames an id everywhere the file names it', () => {
    const { markdown, renamed } = applyEdits(file, [{ kind: 'rename-id', id: 'carolina', to: 'caro' }]);
    expect(renamed).toEqual({ carolina: 'caro' });
    expect(markdown).toBe(file.replace(/carolina/g, 'caro').replace('person caro "Caro Dahle"', 'person caro "Carolina Dahle"'));
  });

  it('gives a stand-in an id from its real name once it has one', () => {
    const { markdown, renamed } = applyEdits(file, [{ kind: 'person', id: 'eltern', set: { name: 'Christian Dahle' } }]);
    expect(renamed).toEqual({ eltern: 'christian-dahle' });
    expect(markdown).not.toMatch(/\beltern\b/);
    expect(markdown).toContain('me christian-dahle\nperson christian-dahle "Christian Dahle"\nchristian-dahle -> felix, carolina');
    expect(markdown).toContain('oma + christian-dahle adopted=felix, carolina');
  });

  it('keeps an id written by hand', () => {
    expect(applyEdits(file, [{ kind: 'person', id: 'oma', set: { name: 'Gisela Vogt' } }]).renamed).toEqual({});
  });

  it('refuses an id that is taken or could not be read back', () => {
    expect(() => applyEdits(file, [{ kind: 'rename-id', id: 'felix', to: 'oma' }])).toThrow(EditError);
    expect(() => applyEdits(file, [{ kind: 'rename-id', id: 'felix', to: 'a b' }])).toThrow(EditError);
  });
});

describe('ids made when the short one was taken', () => {
  it('follow the name too', () => {
    const file = '```family\nperson eltern-von-christian "Eltern von Christian"\nperson eltern2 "Eltern von Heiko"\neltern-von-christian -> christian\n```\n';
    expect(applyEdits(file, [{ kind: 'person', id: 'eltern-von-christian', set: { name: 'Ursula Dahle' } }]).renamed).toEqual({ 'eltern-von-christian': 'ursula-dahle' });
    expect(applyEdits(file, [{ kind: 'person', id: 'eltern2', set: { name: 'Bernd Dahle' } }]).renamed).toEqual({ eltern2: 'bernd-dahle' });
  });
});

describe('one person entered twice', () => {
  const file = '```family\nme erna2\nperson erna "Erna Tanke" sex=f\nperson erna2 "Erna Tanke" born=1940 birthplace=Lindau\nerna + hermann -> birgit\nerna2 -> birgit, detlef\nperson hermann "Hermann Tanke"\n```\n';

  it('becomes one: the details joined, every link moved, nothing listed twice', () => {
    const { markdown, renamed } = applyEdits(file, [{ kind: 'merge', keep: 'erna', drop: 'erna2' }]);
    expect(renamed).toEqual({ erna2: 'erna' });
    expect(markdown).toBe('```family\nme erna\nperson erna "Erna Tanke" sex=f born=1940 birthplace=Lindau\nerna + hermann -> birgit\nerna -> birgit, detlef\nperson hermann "Hermann Tanke"\n```\n');
    const graph = parseFamily(markdown);
    expect(graph.people.has('erna2')).toBe(false);
    expect(graph.people.get('erna')).toMatchObject({ sex: 'f', born: '1940', birthplace: 'Lindau' });
  });

  it('lists a child once when both had them on the same line', () => {
    const twice = '```family\nperson a "A"\nperson a2 "A"\na + b -> c, d\nb + a2 -> c\n```\n';
    const { markdown } = applyEdits(twice, [{ kind: 'merge', keep: 'a', drop: 'a2' }]);
    expect(markdown).toBe('```family\nperson a "A"\na + b -> c, d\nb + a -> c\n```\n');
    expect(parseFamily(markdown).unions.find((u) => u.partners.includes('a') && u.partners.includes('b'))?.children).toEqual(['c', 'd']);
  });
});

describe('names that give no id of their own', () => {
  it('never makes an id that reads as a keyword, and spells out Cyrillic and Greek', () => {
    const { created, markdown } = apply(
      { kind: 'add-person', ref: '$a', set: { name: 'Person' } },
      { kind: 'add-person', ref: '$b', set: { name: 'Me' } },
      { kind: 'add-person', ref: '$c', set: { name: 'Анна Иванова' } },
      { kind: 'add-person', ref: '$d', set: { name: 'Νίκος Παπαδόπουλος' } },
      { kind: 'add-person', ref: '$e', set: { name: '李明', born: '1990' } },
      { kind: 'add-person', ref: '$f', set: { name: '王芳' } },
      { kind: 'add-partnership', partners: ['$a', '$b'], set: {} },
    );
    expect(created).toEqual({ $a: 'person-2', $b: 'me-2', $c: 'anna-ivanova', $d: 'nikos-papadopoulos', $e: 'person-1990', $f: 'person-3' });
    expect(parseFamily(markdown).unions.at(-1)?.partners).toEqual(['person-2', 'me-2']);
  });

  it('refuses an id the parser would read as a keyword or a comment', () => {
    for (const to of ['person', 'me', '#felix', '%%felix']) {
      expect(() => apply({ kind: 'rename-id', id: 'jonas', to })).toThrow(EditError);
    }
  });

  it('gives the `person` an earlier version made a proper id when tidying', () => {
    const file = '```family\nperson person "Анна Иванова"\nperson b "B"\nperson + b -> kind\n```\n';
    const { markdown, renamed } = applyEdits(file, [{ kind: 'tidy' }]);
    expect(renamed).toMatchObject({ person: 'anna-ivanova' });
    expect(parseFamily(markdown).unions[0]?.partners).toEqual(['anna-ivanova', 'b']);
  });
});

describe('a couple who were partners twice, edited', () => {
  const file = '```family\nperson a "A"\nperson b "B"\na + b married=1980 divorced=1990 -> c\na + b married=2000 -> d\n```\n';
  const unions = (markdown: string) => parseFamily(markdown).unions.map((u) => [u.id, u.married, u.divorced, u.children]);

  it('refuses to take the end out of the first, which would make the two one', () => {
    expect(() => applyEdits(file, [{ kind: 'partnership', union: 'a+b', set: { divorced: null } }])).toThrow(/end/);
  });

  it('keeps a marriage without a date apart from the other', () => {
    const first = applyEdits(file, [{ kind: 'partnership', union: 'a+b', set: { married: null } }]).markdown;
    expect(unions(first)).toEqual([['a+b', '?', '1990', ['c']], ['a+b~2', '2000', undefined, ['d']]]);
    const second = applyEdits(file, [{ kind: 'partnership', union: 'a+b~2', set: { married: null } }]).markdown;
    expect(unions(second)).toEqual([['a+b', '1980', '1990', ['c']], ['a+b~2', '?', undefined, ['d']]]);
  });

  it('removes either one, leaving the other as it was', () => {
    const childless = '```family\na + b married=1980 divorced=1990\na + b married=2000 divorced=2001\na + b married=2010\n```\n';
    expect(unions(applyEdits(childless, [{ kind: 'delete-partnership', union: 'a+b' }]).markdown)).toEqual([
      ['a+b', '2000', '2001', []],
      ['a+b~2', '2010', undefined, []],
    ]);
    expect(unions(applyEdits(childless, [{ kind: 'delete-partnership', union: 'a+b~2' }]).markdown)).toEqual([
      ['a+b', '1980', '1990', []],
      ['a+b~2', '2010', undefined, []],
    ]);
  });

  it('cannot make two partners, or a parent and child, one person', () => {
    expect(() => applyEdits(file, [{ kind: 'merge', keep: 'a', drop: 'b' }])).toThrow(/partners/);
    expect(() => applyEdits(file, [{ kind: 'merge', keep: 'c', drop: 'a' }])).toThrow(/parent/);
  });
});

describe('tidying ids', () => {
  it('passes an id on when its owner moves to a new one, in one go', () => {
    // Klaus Bauer takes `klaus-bauer`, which frees `klaus` for nobody; the old `klaus-bauer` is someone else.
    const file = '```family\nperson klaus "Klaus Bauer" born=1958\nperson klaus-bauer "Klaus Bauer"\nperson anna "Anna Bauer"\nperson anna2 "Anna Bauer"\nklaus + anna -> klaus-bauer, anna2\n```\n';
    const { markdown, renamed } = applyEdits(file, [{ kind: 'tidy' }]);
    expect(renamed).toEqual({ klaus: 'klaus-bauer-1958', anna: 'anna-bauer', anna2: 'anna-bauer-2' });
    expect(parseFamily(markdown).unions[0]).toMatchObject({ partners: ['klaus-bauer-1958', 'anna-bauer'], children: ['klaus-bauer', 'anna-bauer-2'] });
  });

  it('renames 500 people in one go, not one file at a time', () => {
    const lines = ['```family'];
    for (let i = 0; i < 500; i++) lines.push(`person p${i} "P${i} Bauer"`, ...(i > 0 ? [`p${i - 1} -> p${i}`] : []));
    lines.push('```');
    const started = performance.now();
    const { renamed } = applyEdits(lines.join('\n'), [{ kind: 'tidy' }]);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(Object.keys(renamed)).toHaveLength(500);
    expect(renamed.p499).toBe('p499-bauer');
  });
});
