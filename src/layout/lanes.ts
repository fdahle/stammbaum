import type { Layout } from './layout';

/** Half the width of the bridge a line makes over another family's. */
export const HOP = 6;

/**
 * Two families in the same generation whose children sit side by side would
 * otherwise draw their horizontal bus at exactly the same height and read as a
 * single line. Overlapping buses get their own lane — and which one runs
 * higher decides whether their lines cross, so a few overlapping buses are
 * tried in every order, and the one with the fewest crossings wins.
 */
export function assignLanes(layout: Layout): Map<string, number> {
  const xOf = (id: string) => layout.nodes.get(id)?.x;
  const buses = layout.unions
    .flatMap((union) => {
      const children = union.children.map(xOf).filter((x): x is number => x !== undefined);
      if (children.length === 0) return [];
      const xs = [...children, ...union.partners.map(xOf).filter((x): x is number => x !== undefined)];
      return [{
        union,
        couple: [...union.partners].sort().join('+'),
        children,
        from: Math.min(...xs),
        to: Math.max(...xs),
        // Where the line is actually drawn.
        left: Math.min(...children, union.x),
        right: Math.max(...children, union.x),
      }];
    })
    .sort((a, b) => a.from - b.from);
  type Bus = (typeof buses)[number];

  // Side by side on one height only with a clear gap between, or they read as one line.
  const overlap = (a: Bus, b: Bus) => a.from < b.to + 40 && b.from < a.to + 40;
  const across = (x: number, bus: Bus) => x > bus.left + HOP && x < bus.right - HOP;
  // With `high` above `low`, its children's lines cross the lower one, and
  // the line down to the lower one crosses it.
  const crossings = (high: Bus, low: Bus) =>
    high.couple === low.couple ? 0 : high.children.filter((x) => across(x, low)).length + (across(low.union.x, high) ? 1 : 0);

  const lanes = new Map<string, number>();
  const settle = (order: Bus[]) => {
    const lane = new Map<Bus, number>();
    let cost = 0;
    order.forEach((bus, i) => {
      const above = order.slice(0, i).filter((other) => overlap(other, bus));
      lane.set(bus, above.length === 0 ? 0 : Math.max(...above.map((other) => lane.get(other)!)) + 1);
      for (const other of above) cost += crossings(other, bus);
    });
    return { lane, cost, height: Math.max(...lane.values()) };
  };
  const rows = new Map<number, Bus[]>();
  for (const bus of buses) rows.set(bus.union.y, [...(rows.get(bus.union.y) ?? []), bus]);
  for (const row of rows.values()) {
    // Buses that overlap one another, directly or through others, share their lanes.
    const groups: Bus[][] = [];
    let reach = -Infinity;
    for (const bus of row) {
      const last = groups[groups.length - 1];
      if (last && bus.from < reach + 40) {
        last.push(bus);
      } else {
        groups.push([bus]);
        reach = -Infinity;
      }
      reach = Math.max(reach, bus.to);
    }
    for (const group of groups) {
      // A few are tried in every order; left to right wins a tie.
      const orders = group.length <= 6 ? permutations(group) : [group];
      let best = settle(group);
      for (const order of orders) {
        const tried = settle(order);
        if (tried.cost < best.cost || (tried.cost === best.cost && tried.height < best.height)) best = tried;
      }
      for (const [bus, lane] of best.lane) lanes.set(bus.union.id, lane);
    }
  }
  return lanes;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}
