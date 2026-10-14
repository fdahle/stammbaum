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
    expect(changed(markdown).added).toEqual(['person elisabeth "Elisabeth Maria Bauer"  sex=f born=1934']);
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
    expect(created).toEqual({ $kid: 'nina' });
    expect(changed(markdown)).toEqual({
      removed: ['klaus + sabine married=1984 divorced=1996 -> jonas'],
      added: ['klaus + sabine married=1984 divorced=1996 -> jonas, nina', 'person nina "Nina Bauer" sex=f born=1986-02-17'],
    });
    expect(markdown.indexOf('person nina')).toBeLessThan(markdown.indexOf('person jonas'));
  });

  it('starts a new line for a new couple, after what is said about them', () => {
    const lines = apply(
      { kind: 'add-person', ref: '$p', set: { name: 'Petra Lange' }, near: { id: 'jonas', side: 'after' } },
      { kind: 'add-partnership', partners: ['jonas', '$p'], set: { together: '2015' } },
      { kind: 'add-person', ref: '$kid', set: { name: 'Mia Bauer' }, near: { id: '$p', side: 'after' } },
      { kind: 'add-child', parents: ['jonas', '$p'], child: '$kid' },
    ).markdown.split('\n');
    // Jonas is in no partnership yet, so the couple goes after the newest of their person lines.
    const at = lines.indexOf('person petra "Petra Lange"');
    expect(lines.slice(at - 1, at + 3)).toEqual([
      'person jonas "Jonas Bauer" sex=m',
      'person petra "Petra Lange"',
      'person mia "Mia Bauer"',
      'jonas + petra together=2015 -> mia',
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

  it('picks ids that are short, free and readable', () => {
    const { created } = apply(
      { kind: 'add-person', ref: '$a', set: { name: 'Klaus Müller' } },
      { kind: 'add-person', ref: '$b', set: { name: 'Klaus Müller' } },
      { kind: 'add-person', ref: '$c', set: { name: 'Jürgen Weiß' } },
    );
    expect(created).toEqual({ $a: 'klaus-mueller', $b: 'klaus2', $c: 'juergen' });
  });

  it('refuses a partnership that already lasts, and one without a start', () => {
    expect(() => apply({ kind: 'add-partnership', partners: ['heinrich', 'elisabeth'], set: { married: '2000' } })).toThrow(/already/);
    expect(() => apply({ kind: 'add-partnership', partners: ['klaus', 'brigitte'], set: {} })).toThrow(/married= or together=/);
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
    expect(created).toEqual({ $parent0: 'eltern' });
    expect(markdown).toBe('```family\nperson eltern "Eltern von Felix"\neltern -> felix, carolina\nperson felix "Felix Dahle"\nperson carolina "Carolina Dahle"\n```\n');
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
