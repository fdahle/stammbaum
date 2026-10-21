import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFamily } from '../src/parser/parse';
import { assignLanes } from '../src/layout/lanes';
import { assignGenerations, layoutFamily, METRICS } from '../src/layout/layout';

const sample = readFileSync(new URL('../sample/family.md', import.meta.url), 'utf8');
const graph = parseFamily(sample);
const layout = layoutFamily(graph);

describe('layoutFamily', () => {
  it('places every person exactly once', () => {
    expect(layout.nodes.size).toBe(graph.people.size);
  });

  it('puts children strictly below both of their parents', () => {
    for (const union of layout.unions) {
      const parentY = Math.max(...union.partners.map((p) => layout.nodes.get(p)!.y));
      for (const child of union.children) {
        expect(layout.nodes.get(child)!.y).toBeGreaterThan(parentY);
      }
    }
  });

  it('keeps partners on the same row', () => {
    for (const union of layout.unions) {
      const rows = new Set(union.partners.map((p) => layout.nodes.get(p)!.generation));
      expect(rows.size).toBe(1);
    }
  });

  it('never overlaps two bubbles on the same row', () => {
    const rows = new Map<number, number[]>();
    for (const node of layout.nodes.values()) {
      rows.set(node.generation, [...(rows.get(node.generation) ?? []), node.x]);
    }
    for (const xs of rows.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(METRICS.nodeWidth);
      }
    }
  });

  it('reports bounds that contain every bubble', () => {
    for (const node of layout.nodes.values()) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(layout.width);
      expect(node.y).toBeLessThan(layout.height);
    }
  });

  it('is deterministic', () => {
    const again = layoutFamily(parseFamily(sample));
    for (const [id, node] of layout.nodes) expect(again.nodes.get(id)!.x).toBe(node.x);
  });
});

describe('a couple who married twice', () => {
  it('get one bubble each, side by side', () => {
    const twice = layoutFamily(parseFamily('```family\na + b married=1980 divorced=1985 -> c\na + b married=1990 -> d\n```'));
    expect(twice.nodes.size).toBe(4);
    const [a, b] = ['a', 'b'].map((id) => twice.nodes.get(id)!);
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThanOrEqual(METRICS.nodeWidth);
  });
});

describe('rows for families that marry into each other', () => {
  // Christian married into a younger generation than his brothers'; Anja's
  // parents and Erna's have no parents of their own in the file.
  const family = layoutFamily(
    parseFamily(`\`\`\`family
eltern -> christian, heiko, henning
mutter + vater -> erna, lisellotte
erna + hermann -> birgit
birgit + christian -> felix, carolina
elke + unger -> anja, trini
felix + anja -> leon
\`\`\``),
  );
  const row = (id: string) => family.nodes.get(id)!.generation;

  it('keeps brothers and sisters on one row', () => {
    expect(row('heiko')).toBe(row('christian'));
    expect(row('henning')).toBe(row('christian'));
    expect(row('trini')).toBe(row('anja'));
    expect(row('carolina')).toBe(row('felix'));
  });

  it('puts parents with no parents of their own right above their children', () => {
    expect(row('elke')).toBe(row('anja') - 1);
    expect(row('unger')).toBe(row('anja') - 1);
    expect(row('eltern')).toBe(row('christian') - 1);
    expect(row('mutter')).toBe(row('erna') - 1);
  });

  it('still keeps every child below its parents and partners side by side', () => {
    expect(row('leon')).toBe(row('felix') + 1);
    expect(row('felix')).toBe(row('anja'));
    expect(row('birgit')).toBe(row('christian'));
  });
});

describe('a family married into another, with a branch beside it', () => {
  // Henning's son must not end up between Anja and Trini, whose parents
  // married into the tree through Felix and Anja.
  const family = parseFamily(`\`\`\`family
mutter + vater -> erna, lisellotte
erna + hermann -> birgit, detlef
ursula + bernd -> christian, heiko, henning
birgit + christian -> felix, carolina
detlef + petra -> julian, simon
henning -> hans
elke + unger -> anja, trini
felix + anja -> leon
trini + luan together=?
\`\`\``);
  const layout = layoutFamily(family);

  it('draws no line across another', () => {
    const x = (id: string) => layout.nodes.get(id)!.x;
    const row = (id: string) => layout.nodes.get(id)!.generation;
    // Every line from a couple down to one of their children, between neighbouring rows.
    const lines = layout.unions.flatMap((u) =>
      u.children.filter((c) => row(c) === row(u.partners[0]!) + 1).map((c) => ({ union: u.id, top: u.x, bottom: x(c), row: row(c) })),
    );
    const crossings = lines.flatMap((a, i) =>
      lines.slice(i + 1).filter((b) => b.union !== a.union && b.row === a.row && (a.top - b.top) * (a.bottom - b.bottom) < 0),
    );
    expect(crossings).toEqual([]);
  });
});

describe('a family in which someone ends up their own ancestor', () => {
  // 2000 people, two children to every couple, and one typo that closes a loop.
  const lines: string[] = [];
  const queue = ['p0'];
  let count = 1;
  let last = 'p0';
  for (const parent of queue) {
    if (count >= 1340) break;
    const kids = [`p${count++}`, `p${count++}`];
    lines.push(`person ${parent} "${parent}" sex=m`, `person w${parent} "Frau von ${parent}"`, `${parent} + w${parent} -> ${kids.join(', ')}`);
    queue.push(...kids);
    last = kids[1]!;
  }
  lines.push(`${last} -> p0`);
  const graph = parseFamily(['```family', ...lines, '```'].join('\n'));

  it('still numbers the rows quickly, and keeps them few', () => {
    expect(graph.people.size).toBeGreaterThan(1900);
    const started = performance.now();
    const generation = assignGenerations(graph);
    expect(performance.now() - started).toBeLessThan(200);
    expect(Math.max(...generation.values())).toBeLessThan(12);
    // Only the link that closes the loop is left out.
    expect(generation.get('p1')).toBe(generation.get('p0')! + 1);
    expect(generation.get(last)).toBeGreaterThan(generation.get('p0')!);
  });

  it('keeps a couple of an aunt and her nephew on one row, and bounded', () => {
    const generation = assignGenerations(parseFamily('```family\nopa + oma -> tante, vater\nvater + mutter -> neffe\ntante + neffe\n```'));
    expect(generation.get('tante')).toBe(generation.get('neffe'));
    expect(Math.max(...generation.values())).toBeLessThan(4);
  });
});

describe('whose family goes where', () => {
  // Her family is written first; his comes further down the file.
  const graph = parseFamily(
    [
      '```family',
      'oma-s + opa-s -> mutter-s, tante-s',
      'mutter-s + vater-s divorced=? -> sie, schwester',
      'tante-s -> cousin-s',
      'oma-e + opa-e -> mutter-e',
      'mutter-e + vater-e -> er, bruder',
      'bruder + frau-b',
      'er + sie married=2022 -> kind',
      '```',
    ].join('\n'),
  );
  const x = (layout: ReturnType<typeof layoutFamily>, id: string) => layout.nodes.get(id)!.x;

  it('starts with the own family of whoever is looking, and puts their partner’s to the right', () => {
    const his = layoutFamily(graph, 'er');
    expect(x(his, 'oma-e')).toBeLessThan(x(his, 'oma-s'));
    expect(x(his, 'er')).toBeLessThan(x(his, 'sie'));
    const hers = layoutFamily(graph, 'sie');
    expect(x(hers, 'oma-s')).toBeLessThan(x(hers, 'oma-e'));
  });

  it('keeps the sides however the file is ordered', () => {
    const shuffled = parseFamily(
      '```family\noma-e + opa-e -> mutter-e\nmutter-e + vater-e -> er, bruder\nbruder + frau-b\noma-s + opa-s -> mutter-s, tante-s\nmutter-s + vater-s divorced=? -> sie, schwester\ntante-s -> cousin-s\ner + sie married=2022 -> kind\n```',
    );
    const before = layoutFamily(graph, 'er');
    const after = layoutFamily(shuffled, 'er');
    expect(x(after, 'oma-e') < x(after, 'oma-s')).toBe(x(before, 'oma-e') < x(before, 'oma-s'));
  });

  it('puts an only child right in the middle of the couple, from either side', () => {
    for (const anchor of ['er', 'sie', undefined]) {
      const layout = layoutFamily(graph, anchor);
      const couple = layout.unions.find((u) => u.children.includes('kind'))!;
      expect(x(layout, 'kind')).toBeCloseTo(couple.x, 5);
    }
  });
});

describe('lines that would read as one', () => {
  const step = METRICS.nodeWidth + METRICS.nodeGap;

  it('keeps everyone’s own line away from where another couple’s line ends', () => {
    // In the sample, Jonas would land right under his father's second marriage.
    for (const anchor of [undefined, 'heinrich', 'jonas']) {
      const { nodes, unions } = layoutFamily(graph, anchor);
      const hasParents = new Set(unions.flatMap((u) => u.children));
      for (const union of unions) {
        if (union.children.length === 0) continue;
        const row = Math.max(...union.partners.map((p) => nodes.get(p)!.generation));
        for (const node of nodes.values()) {
          if (union.children.includes(node.id) || !hasParents.has(node.id) || node.generation !== row + 1) continue;
          expect(Math.abs(node.x - union.x), `${node.id} under ${union.partners.join(' + ')}`).toBeGreaterThanOrEqual(0.3 * step);
        }
      }
    }
  });

  it('runs the line that would be crossed higher, so neither crosses the other', () => {
    const node = (id: string, x: number, generation: number) => [id, { id, x, y: generation * METRICS.rowHeight, generation }] as const;
    const nodes = new Map([
      node('detlef', 460, 0), node('petra', 570, 0), node('birgit', 680, 0), node('christian', 790, 0),
      node('julian', 515, 1), node('simon', 793, 1), node('carolina', 1069, 1), node('felix', 1290, 1),
    ]);
    const unions = [
      { id: 'u1', partners: ['detlef', 'petra'], children: ['julian', 'simon'], x: 515, y: 0 },
      { id: 'u2', partners: ['birgit', 'christian'], children: ['carolina', 'felix'], x: 735, y: 0 },
    ];
    const lanes = assignLanes({ nodes, unions, width: 0, height: 0, metrics: METRICS });
    // Left to right would put Detlef's line on top: Birgit's line would come
    // down through it, and Simon's line down through hers.
    expect(lanes.get('u2')!).toBeLessThan(lanes.get('u1')!);
  });
});
