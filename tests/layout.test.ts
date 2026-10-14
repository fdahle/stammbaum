import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFamily } from '../src/parser/parse';
import { layoutFamily, METRICS } from '../src/layout/layout';

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
