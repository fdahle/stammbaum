import type { FamilyGraph, Union } from '../parser/types';

export interface NodeBox {
  id: string;
  /** Centre of the bubble. */
  x: number;
  y: number;
  generation: number;
}

export interface UnionEdge extends Union {
  /** Point the children bus hangs from. */
  x: number;
  y: number;
}

export interface Layout {
  nodes: Map<string, NodeBox>;
  unions: UnionEdge[];
  width: number;
  height: number;
  /** Geometry constants the renderer needs to stay in sync with. */
  metrics: typeof METRICS;
}

export const METRICS = {
  nodeWidth: 132,
  nodeGap: 26,
  /** Vertical distance between two generations. */
  rowHeight: 210,
  bubbleRadius: 38,
  /** Gap between two unrelated top-level families. */
  clusterGap: 90,
  padding: 90,
};

/**
 * Tidy generational layout.
 *
 * Generations come from a longest-path relaxation (partners share a row).
 * Horizontal placement is a recursive walk: a person's partners sit next to
 * them, each partnership's children are laid out as a band underneath, and the
 * partner row is then slid to sit above the middle of its children.
 */
export function layoutFamily(graph: FamilyGraph): Layout {
  const generation = assignGenerations(graph);
  const unionsByPerson = new Map<string, Union[]>();
  for (const union of graph.unions) {
    for (const partner of union.partners) {
      const list = unionsByPerson.get(partner) ?? [];
      list.push(union);
      unionsByPerson.set(partner, list);
    }
  }

  // Brothers and sisters who married someone with a family of their own in
  // the file go last: their partner is placed to their right, and that
  // family further right still, so nobody else stands between the two.
  const hasParents = new Set(graph.unions.flatMap((u) => u.children));
  const marriedOut = (id: string) =>
    (unionsByPerson.get(id) ?? []).some((u) => u.partners.some((p) => p !== id && hasParents.has(p)));
  const inOrder = (children: string[]) => [...children].sort((a, b) => Number(marriedOut(a)) - Number(marriedOut(b)));

  const nodes = new Map<string, NodeBox>();
  const placedUnions = new Set<string>();
  const step = METRICS.nodeWidth + METRICS.nodeGap;

  interface Cluster {
    ids: string[];
    min: number;
    max: number;
  }

  const empty = (x: number): Cluster => ({ ids: [], min: x, max: x });

  const place = (id: string, x: number): Cluster => {
    if (nodes.has(id)) return empty(x);
    const gen = generation.get(id) ?? 0;
    nodes.set(id, { id, x, y: gen * METRICS.rowHeight, generation: gen });
    const cluster: Cluster = { ids: [id], min: x, max: x };

    const unions = (unionsByPerson.get(id) ?? []).filter((u) => !placedUnions.has(u.id));
    for (const union of unions) placedUnions.add(union.id);

    // Row of partner bubbles. With two or more partnerships the person sits in
    // the middle so both marriage links stay short.
    const spouses = unions.map((u) => u.partners.find((p) => p !== id));
    const row: Array<string | undefined> = [];
    const firstSpouse = spouses[0];
    if (unions.length >= 2 && firstSpouse && !nodes.has(firstSpouse)) {
      row.push(firstSpouse, id, ...spouses.slice(1));
    } else {
      row.push(id, ...spouses.slice(unions.length >= 2 ? 1 : 0));
    }
    // A couple married twice names the same partner twice; they get one bubble.
    const rowIds = [...new Set(row.filter((r): r is string => r !== undefined && (r === id || !nodes.has(r))))];

    // Children first: they decide how wide this cluster is.
    const groups: Array<{ union: Union; ids: string[]; min: number; max: number }> = [];
    let cursor = x;
    for (const union of unions) {
      const ids: string[] = [];
      let min = Infinity;
      let max = -Infinity;
      for (const child of inOrder(union.children)) {
        if (nodes.has(child)) continue;
        const sub = place(child, cursor);
        if (sub.ids.length === 0) continue;
        ids.push(...sub.ids);
        min = Math.min(min, sub.min);
        max = Math.max(max, sub.max);
        cursor = sub.max + step;
      }
      if (ids.length > 0) groups.push({ union, ids, min, max });
    }

    // Slide the partner row so each marriage sits above its own children.
    const indexOf = new Map(rowIds.map((rid, i) => [rid, i]));
    const offsets: number[] = [];
    for (const group of groups) {
      const slots = group.union.partners.map((p) => indexOf.get(p)).filter((i): i is number => i !== undefined);
      if (slots.length === 0) continue;
      const midSlot = (Math.min(...slots) + Math.max(...slots)) / 2;
      offsets.push((group.min + group.max) / 2 - midSlot * step);
    }
    const rowLeft = offsets.length > 0 ? Math.max(x, average(offsets)) : x;
    rowIds.forEach((rid, i) => {
      const node = nodes.get(rid);
      const rowGen = generation.get(rid) ?? gen;
      if (node && rid !== id) return;
      if (node) node.x = rowLeft + i * step;
      else nodes.set(rid, { id: rid, x: rowLeft + i * step, y: rowGen * METRICS.rowHeight, generation: rowGen });
      if (rid !== id) cluster.ids.push(rid);
    });

    // Re-centre each children band under its marriage, keeping bands in order.
    let guard = -Infinity;
    for (const group of groups) {
      const slots = group.union.partners.map((p) => indexOf.get(p)).filter((i): i is number => i !== undefined);
      const target =
        slots.length > 0
          ? rowLeft + ((Math.min(...slots) + Math.max(...slots)) / 2) * step
          : (group.min + group.max) / 2;
      const shift = Math.max(target - (group.min + group.max) / 2, guard - group.min);
      if (shift !== 0) shiftNodes(nodes, group.ids, shift);
      guard = group.max + shift + step;
      cluster.ids.push(...group.ids);
      cluster.min = Math.min(cluster.min, group.min + shift);
      cluster.max = Math.max(cluster.max, group.max + shift);
    }

    for (const rid of rowIds) {
      const node = nodes.get(rid)!;
      cluster.min = Math.min(cluster.min, node.x);
      cluster.max = Math.max(cluster.max, node.x);
    }
    return cluster;
  };

  // Oldest generation first so the tree grows downwards from its roots — but
  // a family whose child is already on the page, married into it, comes next,
  // right beside that child: in-laws' parents and siblings then stand over
  // them, instead of across someone else's branch.
  const pending = [...graph.people.keys()].sort(
    (a, b) => (generation.get(a) ?? 0) - (generation.get(b) ?? 0),
  );
  const attached = (id: string): number => {
    if (hasParents.has(id)) return -Infinity;
    const placed = (unionsByPerson.get(id) ?? []).flatMap((u) => u.children).map((child) => nodes.get(child)?.x);
    return Math.max(-Infinity, ...placed.filter((x): x is number => x !== undefined));
  };
  let cursor = 0;
  while (pending.length > 0) {
    // The family whose child sits furthest right goes next; with none, the oldest left.
    let next = 0;
    let best = -Infinity;
    pending.forEach((id, i) => {
      const x = nodes.has(id) ? -Infinity : attached(id);
      if (x > best) {
        best = x;
        next = i;
      }
    });
    const id = pending.splice(next, 1)[0]!;
    if (nodes.has(id)) continue;
    const cluster = place(id, cursor);
    if (cluster.ids.length > 0) cursor = cluster.max + METRICS.clusterGap + step;
  }

  refine(nodes, graph.unions);

  const unions: UnionEdge[] = graph.unions.map((union) => {
    const points = union.partners.map((p) => nodes.get(p)).filter((n): n is NodeBox => !!n);
    const x = points.length > 0 ? average(points.map((p) => p.x)) : 0;
    const y = points.length > 0 ? Math.max(...points.map((p) => p.y)) : 0;
    return { ...union, x, y };
  });

  return normalise(nodes, unions);
}

/**
 * Straightens the first pass: rows are swept repeatedly, pulling every couple
 * towards the middle of its children and every child towards its parents. The
 * left-to-right order of a row never changes and couples move as one block, so
 * the tree stays readable — it just stops stretching connectors across the page
 * when two families marry into each other.
 */
function refine(nodes: Map<string, NodeBox>, unions: Union[], passes = 24): void {
  const step = METRICS.nodeWidth + METRICS.nodeGap;
  const parentUnion = new Map<string, Union>();
  const parentIn = new Map<string, Union[]>();
  for (const union of unions) {
    for (const child of union.children) if (!parentUnion.has(child)) parentUnion.set(child, union);
    for (const partner of union.partners) {
      const list = parentIn.get(partner) ?? [];
      list.push(union);
      parentIn.set(partner, list);
    }
  }

  const rows = new Map<number, NodeBox[]>();
  for (const node of nodes.values()) {
    const row = rows.get(node.generation) ?? [];
    row.push(node);
    rows.set(node.generation, row);
  }
  for (const row of rows.values()) row.sort((a, b) => a.x - b.x);
  const generations = [...rows.keys()].sort((a, b) => a - b);

  const mean = (ids: string[]): number | undefined => {
    const xs = ids.map((id) => nodes.get(id)?.x).filter((x): x is number => x !== undefined);
    return xs.length > 0 ? average(xs) : undefined;
  };

  for (let pass = 0; pass < passes; pass++) {
    const order = pass % 2 === 0 ? generations : [...generations].reverse();
    for (const generation of order) {
      const row = rows.get(generation)!;
      for (const block of blocksOf(row, unions)) {
        // A block stands shoulder to shoulder, around where it already is.
        const centre = average(block.map((node) => node.x));
        block.forEach((node, i) => (node.x = centre + (i - (block.length - 1) / 2) * step));
        const shifts: number[] = [];
        for (const node of block) {
          const above = parentUnion.get(node.id);
          if (above) {
            const target = mean(above.partners);
            if (target !== undefined) shifts.push(target - node.x);
          }
          for (const union of parentIn.get(node.id) ?? []) {
            const target = mean(union.children);
            if (target !== undefined) shifts.push(target - node.x);
          }
        }
        if (shifts.length === 0) continue;
        const shift = average(shifts);
        for (const node of block) node.x += shift;
      }
      // Restore the row's minimum spacing without changing anyone's order.
      for (let i = 1; i < row.length; i++) {
        const previous = row[i - 1]!;
        const node = row[i]!;
        if (node.x - previous.x < step) node.x = previous.x + step;
      }
    }
  }
}

/**
 * Splits a row into blocks that move together: couples side by side, and a
 * brother or sister with no family of their own next to the sibling beside
 * them — so they stay together instead of drifting off towards their parents
 * when that sibling has married into another family.
 */
function blocksOf(row: NodeBox[], unions: Union[]): NodeBox[][] {
  const married = new Set(
    unions.flatMap((u) => (u.partners.length === 2 ? [u.partners.slice().sort().join('+')] : [])),
  );
  const parentsOf = new Map<string, string>();
  for (const union of unions) for (const child of union.children) parentsOf.set(child, union.id);
  const ownFamily = new Set(unions.flatMap((u) => u.partners));
  const together = (a: string, b: string) =>
    married.has([a, b].sort().join('+')) ||
    (parentsOf.get(a) !== undefined && parentsOf.get(a) === parentsOf.get(b) && (!ownFamily.has(a) || !ownFamily.has(b)));
  const blocks: NodeBox[][] = [];
  let current: NodeBox[] = [];
  for (const node of row) {
    const previous = current[current.length - 1];
    if (previous && together(previous.id, node.id)) current.push(node);
    else {
      if (current.length > 0) blocks.push(current);
      current = [node];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function shiftNodes(nodes: Map<string, NodeBox>, ids: string[], dx: number): void {
  for (const id of ids) {
    const node = nodes.get(id);
    if (node) node.x += dx;
  }
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Generation numbering. Rows only ever move down, until nothing changes:
 *
 * - every child sits at least one row below both of its parents,
 * - partners share a row,
 * - brothers and sisters share a row — one who married into a younger
 *   generation takes the others along, rather than leaving them stranded
 *   rows above,
 * - and people with no parents in the file sit right above their children
 *   instead of up on the first row: someone's in-laws belong over them, not
 *   at the top of the page with a line running down past everyone between.
 */
export function assignGenerations(graph: FamilyGraph): Map<string, number> {
  const generation = new Map<string, number>();
  for (const id of graph.people.keys()) generation.set(id, 0);
  const gen = (id: string) => generation.get(id) ?? 0;
  const hasParents = new Set(graph.unions.flatMap((u) => u.children));

  let changed = false;
  const lower = (id: string, to: number) => {
    if (gen(id) < to) {
      generation.set(id, to);
      changed = true;
    }
  };

  const limit = graph.people.size * 2 + 10;
  for (let pass = 0; pass < limit; pass++) {
    changed = false;
    for (const union of graph.unions) {
      const partnerGen = Math.max(...union.partners.map(gen));
      for (const partner of union.partners) lower(partner, partnerGen);
      const childGen = Math.max(partnerGen + 1, ...union.children.map(gen));
      for (const child of union.children) lower(child, childGen);
    }
    // Parents of their own nobody knows: down to just above their nearest children.
    for (const id of graph.people.keys()) {
      if (hasParents.has(id)) continue;
      const own = graph.unions.filter((u) => u.partners.includes(id) && u.children.length > 0);
      // A partner with parents in the file keeps the couple where it is.
      if (own.length === 0 || own.some((u) => u.partners.some((p) => hasParents.has(p)))) continue;
      lower(id, Math.min(...own.flatMap((u) => u.children.map(gen))) - 1);
    }
    if (!changed) break;
  }
  return generation;
}

/** Moves everything into positive space and pads the edges. */
function normalise(nodes: Map<string, NodeBox>, unions: UnionEdge[]): Layout {
  const boxes = [...nodes.values()];
  const minX = boxes.length > 0 ? Math.min(...boxes.map((n) => n.x)) : 0;
  const minY = boxes.length > 0 ? Math.min(...boxes.map((n) => n.y)) : 0;
  const dx = METRICS.padding - minX;
  const dy = METRICS.padding - minY;
  for (const node of boxes) {
    node.x += dx;
    node.y += dy;
  }
  for (const union of unions) {
    const points = union.partners.map((p) => nodes.get(p)).filter((n): n is NodeBox => !!n);
    if (points.length > 0) {
      union.x = average(points.map((p) => p.x));
      union.y = Math.max(...points.map((p) => p.y));
    }
  }
  return {
    nodes,
    unions,
    width: Math.max(...boxes.map((n) => n.x), 0) + METRICS.padding,
    height: Math.max(...boxes.map((n) => n.y), 0) + METRICS.padding,
    metrics: METRICS,
  };
}
