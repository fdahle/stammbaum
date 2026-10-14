const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Small stroked icons in the Material Symbols spirit, drawn inline so the
 * offline build stays a single file with no font to load.
 */
const PATHS = {
  back: ['M20 12H4', 'M10 6l-6 6 6 6'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M16.2 16.2 21 21'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  fit: ['M4 9V5a1 1 0 0 1 1-1h4', 'M20 9V5a1 1 0 0 0-1-1h-4', 'M4 15v4a1 1 0 0 0 1 1h4', 'M20 15v4a1 1 0 0 1-1 1h-4'],
  person: ['M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 21a7.5 7.5 0 0 1 15 0'],
  tree: ['M12 21v-6', 'M12 15 8 11', 'M12 13l4-4', 'M12 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
  auto: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 3v18a9 9 0 0 0 0-18z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  me: ['M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M3 21a7 7 0 0 1 11-5.7', 'M15 19l2 2 4-4'],
  swap: ['M7 4 3 8l4 4', 'M3 8h14', 'M17 12l4 4-4 4', 'M21 16H7'],
  next: ['M9 6l6 6-6 6'],
  previous: ['M15 6l-6 6 6 6'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  cake: ['M4 21h16', 'M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7', 'M5 16.5c2.3 1.4 4.7-1.4 7 0s4.7 1.4 7 0', 'M12 12V8', 'M12 3.2c-.9 1-1.3 1.7-1.3 2.3a1.3 1.3 0 0 0 2.6 0c0-.6-.4-1.3-1.3-2.3z'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  chart: ['M3 20h18', 'M6 20v-8', 'M11 20V5', 'M16 20v-5', 'M21 20V9'],
  checklist: ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 6l1.5 1.5L8 5', 'M4 12l1.5 1.5L8 11', 'M4.5 18h2'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2.5v2.5H14z', 'M17.5 17.5H20V20h-2.5z', 'M14 20h1', 'M20 14v1'],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    // The second half of the "auto" glyph is the filled side of the contrast disc.
    if (name === 'auto' && d.startsWith('M12 3v18')) path.setAttribute('class', 'icon-solid');
    svg.append(path);
  }
  return svg;
}

/**
 * Geometry of the marriage glyph: two rings of `radius`, their centres `offset`
 * either side of the middle. `clearance` is where the partner line has to stop.
 */
export const RINGS = { radius: 8, offset: 5, clearance: 15 };

/**
 * Two interlocking rings — the ⚭ that marks a marriage. Open, so both outlines
 * stay visible; the partner line breaks around them rather than crossing them.
 */
export function weddingRings(x: number, y: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'rings');
  for (const dx of [-RINGS.offset, RINGS.offset]) {
    const ring = document.createElementNS(SVG_NS, 'circle');
    // Not "ring": that is a Tailwind utility, and it would win over ours.
    ring.setAttribute('class', 'union-ring');
    ring.setAttribute('cx', String(x + dx));
    ring.setAttribute('cy', String(y));
    ring.setAttribute('r', String(RINGS.radius));
    group.append(ring);
  }
  return group;
}

/** A Material-style icon button with an accessible label. */
export function iconButton(name: IconName, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost btn-circle';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  return button;
}
