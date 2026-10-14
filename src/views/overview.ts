import type { Family } from '../family';
import { layoutFamily, METRICS, type Layout, type NodeBox, type UnionEdge } from '../layout/layout';
import { photoUrl } from '../data';
import { familyName, initials, lifespan, shortName, avatarHue, year, buildStamp } from '../ui/format';
import { icon, weddingRings, RINGS } from '../ui/icons';
import { isDeceased, unionEnd, unionStart, unionStatus, type Person } from '../parser/types';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.12;
const MAX_SCALE = 2.5;
/** Below this the labels stop being readable, so a phone starts here instead of fitting. */
const READABLE_SCALE = 0.5;
const DOUBLE_TAP_MS = 320;
const TAP_SLOP = 10;
/** Room under the lowest row for the build stamp. */
const STAMP_SPACE = 32;

interface View {
  k: number;
  x: number;
  y: number;
}

/**
 * The whole tree in one SVG, driven entirely by gestures: drag to pan, pinch to
 * zoom, double-tap to zoom in, flick for momentum. Built once and kept alive,
 * so returning from a person view lands on exactly the spot you left.
 */
export class OverviewView {
  readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private readonly layout: Layout;
  /** The tree plus the build stamp beneath it. */
  private readonly height: number;
  private readonly nodeElements = new Map<string, SVGGElement>();
  private readonly fab: HTMLButtonElement;
  private readonly stamp: SVGTextElement;
  private view: View = { k: 1, x: 0, y: 0 };
  private positioned = false;
  private highlighted: string | undefined;
  private animation = 0;
  private momentum = 0;

  constructor(
    private readonly family: Family,
    private readonly onSelect: (id: string) => void,
  ) {
    this.layout = layoutFamily(family.graph);
    this.height = this.layout.height + STAMP_SPACE;
    this.element = document.createElement('div');
    this.element.className = 'overview';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'tree');
    this.viewport = document.createElementNS(SVG_NS, 'g');
    this.svg.append(this.viewport);
    this.element.append(this.svg);

    this.stamp = this.drawStamp();
    this.viewport.append(this.drawLinks(), this.drawNodes(), this.stamp);
    this.bindGestures();
    this.fab = this.buildFab();
    this.element.append(this.fab);
    this.localize();
  }

  /** Puts the app's own words into the current language. */
  localize(): void {
    this.fab.title = t().fit;
    this.fab.setAttribute('aria-label', t().fit);
    this.stamp.textContent = buildStamp(__BUILD_TIME__, __FAMILY_COMMIT__);
  }

  /** Rings whoever is looking at the tree. */
  markViewer(id: string | undefined): void {
    for (const [nodeId, element] of this.nodeElements) element.classList.toggle('is-me', nodeId === id);
  }

  /**
   * Fades everyone but `ids` and brings them into view — a path between two
   * people, say. `undefined` shows the whole tree evenly again.
   */
  emphasize(ids: string[] | undefined): void {
    const keep = new Set(ids ?? []);
    this.svg.classList.toggle('has-emphasis', keep.size > 0);
    for (const [id, element] of this.nodeElements) element.classList.toggle('is-emphasized', keep.has(id));
    if (keep.size > 0) this.fitTo([...keep]);
  }

  /** Zooms to the smallest view that shows all of `ids`. */
  private fitTo(ids: string[]): void {
    const nodes = ids.map((id) => this.layout.nodes.get(id)).filter((n): n is NodeBox => !!n);
    const box = this.svg.getBoundingClientRect();
    if (nodes.length === 0 || box.width === 0) return;
    const half = METRICS.nodeWidth / 2;
    const left = Math.min(...nodes.map((n) => n.x)) - half;
    const right = Math.max(...nodes.map((n) => n.x)) + half;
    const top = Math.min(...nodes.map((n) => n.y)) - METRICS.bubbleRadius - 12;
    const bottom = Math.max(...nodes.map((n) => n.y)) + METRICS.bubbleRadius + 60;
    const k = clamp(Math.min(box.width / (right - left + 32), box.height / (bottom - top + 32)), MIN_SCALE, 1.1);
    this.positioned = true;
    this.animateTo({
      k,
      x: box.width / 2 - ((left + right) / 2) * k,
      y: box.height / 2 - ((top + bottom) / 2) * k,
    });
  }

  /** Called whenever the view becomes visible. */
  activate(): void {
    if (this.positioned) this.apply();
    else this.frame();
  }

  /** The opening view: readable rather than complete, which matters on a phone. */
  frame(): void {
    const box = this.svg.getBoundingClientRect();
    if (box.width === 0) return;
    const k = clamp(
      Math.min(box.width / this.layout.width, box.height / this.height),
      READABLE_SCALE,
      1,
    );
    this.set({
      k,
      x: (box.width - this.layout.width * k) / 2,
      y: Math.min((box.height - this.height * k) / 2, 24),
    });
    this.positioned = true;
  }

  /** Zooms out until the whole tree is on screen. */
  fit(animate = true): void {
    const box = this.svg.getBoundingClientRect();
    if (box.width === 0) return;
    const k = clamp(
      Math.min(box.width / (this.layout.width + 40), box.height / (this.height + 40)),
      MIN_SCALE,
      1.1,
    );
    const target = {
      k,
      x: (box.width - this.layout.width * k) / 2,
      y: (box.height - this.height * k) / 2,
    };
    this.positioned = true;
    if (animate) this.animateTo(target);
    else this.set(target);
  }

  /** Whether this tree shows `id` at all — an ancestor tree leaves most people out. */
  has(id: string): boolean {
    return this.layout.nodes.has(id);
  }

  /** Centres one bubble and marks it, used by search. */
  highlight(id: string): void {
    const node = this.layout.nodes.get(id);
    if (!node) return;
    const box = this.svg.getBoundingClientRect();
    const k = clamp(Math.max(this.view.k, 0.9), MIN_SCALE, MAX_SCALE);
    this.positioned = true;
    this.animateTo({ k, x: box.width / 2 - node.x * k, y: box.height / 2 - node.y * k });

    if (this.highlighted) this.nodeElements.get(this.highlighted)?.classList.remove('is-focused');
    this.nodeElements.get(id)?.classList.add('is-focused');
    this.highlighted = id;
  }

  // ---- viewport -----------------------------------------------------------

  private set(view: View): void {
    this.view = this.clamped(view);
    this.viewport.setAttribute(
      'transform',
      `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`,
    );
  }

  private apply(): void {
    this.set(this.view);
  }

  /** Keeps a decent part of the tree on screen, however hard it is flung. */
  private clamped(view: View): View {
    const box = this.svg.getBoundingClientRect();
    if (box.width === 0) return view;
    const k = clamp(view.k, MIN_SCALE, MAX_SCALE);
    const width = this.layout.width * k;
    const height = this.height * k;
    return {
      k,
      x: clamp(view.x, box.width * 0.25 - width, box.width * 0.75),
      y: clamp(view.y, box.height * 0.2 - height, box.height * 0.8),
    };
  }

  private zoomAround(factor: number, originX: number, originY: number): void {
    const k = clamp(this.view.k * factor, MIN_SCALE, MAX_SCALE);
    const ratio = k / this.view.k;
    this.set({
      k,
      x: originX - (originX - this.view.x) * ratio,
      y: originY - (originY - this.view.y) * ratio,
    });
  }

  private animateTo(target: View, duration = 260): void {
    cancelAnimationFrame(this.animation);
    this.stopMomentum();
    const from = { ...this.view };
    const to = this.clamped(target);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || duration === 0) {
      this.set(to);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Material's standard easing: quick out, gentle in.
      const e = 1 - Math.pow(1 - t, 3);
      this.set({
        k: from.k + (to.k - from.k) * e,
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
      });
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  private stopMomentum(): void {
    cancelAnimationFrame(this.momentum);
    this.momentum = 0;
  }

  // ---- gestures -----------------------------------------------------------

  private bindGestures(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let centre = { x: 0, y: 0 };
    let travelled = 0;
    let pressed: string | undefined;
    let velocity = { x: 0, y: 0 };
    let lastMove = 0;
    let lastTap = { t: 0, x: 0, y: 0 };

    const local = (event: { clientX: number; clientY: number }) => {
      const box = this.svg.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    this.svg.addEventListener('pointerdown', (event) => {
      this.stopMomentum();
      cancelAnimationFrame(this.animation);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try {
        this.svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured; panning
        // still works through the events themselves.
      }
      travelled = 0;
      velocity = { x: 0, y: 0 };
      lastMove = event.timeStamp;
      if (pointers.size === 2) {
        pinch = spread(pointers);
        centre = local(midpoint(pointers));
      }
      // Pointer capture retargets later events at the <svg>, so remember now
      // what was actually pressed.
      pressed = (event.target as Element | null)?.closest<SVGGElement>('.node')?.dataset.id;
    });

    this.svg.addEventListener('pointermove', (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        // Two fingers pan and zoom at the same time, as everywhere else.
        const next = spread(pointers);
        const nextCentre = local(midpoint(pointers));
        this.set({
          k: this.view.k,
          x: this.view.x + nextCentre.x - centre.x,
          y: this.view.y + nextCentre.y - centre.y,
        });
        if (pinch > 0 && next > 0) this.zoomAround(next / pinch, nextCentre.x, nextCentre.y);
        pinch = next;
        centre = nextCentre;
        travelled = Infinity;
        return;
      }

      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      travelled += Math.hypot(dx, dy);
      const dt = Math.max(event.timeStamp - lastMove, 1);
      lastMove = event.timeStamp;
      velocity = { x: mix(velocity.x, dx / dt, 0.35), y: mix(velocity.y, dy / dt, 0.35) };
      this.element.classList.add('is-panning');
      this.set({ k: this.view.k, x: this.view.x + dx, y: this.view.y + dy });
    });

    const release = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (pointers.size > 0) return;
      this.element.classList.remove('is-panning');

      if (travelled < TAP_SLOP) {
        if (pressed) {
          this.onSelect(pressed);
        } else {
          const point = local(event);
          const isDouble =
            event.timeStamp - lastTap.t < DOUBLE_TAP_MS &&
            Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 40;
          if (isDouble) {
            this.doubleTap(point.x, point.y);
            lastTap = { t: 0, x: 0, y: 0 };
          } else {
            lastTap = { t: event.timeStamp, x: point.x, y: point.y };
          }
        }
      } else if (travelled !== Infinity) {
        this.flick(velocity);
      }
      pressed = undefined;
    };
    this.svg.addEventListener('pointerup', release);
    this.svg.addEventListener('pointercancel', release);

    this.svg.addEventListener(
      'wheel',
      (event) => {
        // Also catches the trackpad pinch, which arrives as ctrl+wheel.
        event.preventDefault();
        this.stopMomentum();
        const point = local(event);
        this.zoomAround(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018)), point.x, point.y);
      },
      { passive: false },
    );

    // Long-press on a bubble should not raise the browser's own menu.
    this.svg.addEventListener('contextmenu', (event) => event.preventDefault());

    this.svg.addEventListener('keydown', (event) => {
      const id = (event.target as Element | null)?.closest<SVGGElement>('.node')?.dataset.id;
      if (id && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        this.onSelect(id);
        return;
      }
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [80, 0],
        ArrowRight: [-80, 0],
        ArrowUp: [0, 80],
        ArrowDown: [0, -80],
      };
      const step = pan[event.key];
      if (step) {
        event.preventDefault();
        this.set({ k: this.view.k, x: this.view.x + step[0], y: this.view.y + step[1] });
      }
      if (event.key === '+' || event.key === '-') {
        event.preventDefault();
        const box = this.svg.getBoundingClientRect();
        this.zoomAround(event.key === '+' ? 1.3 : 1 / 1.3, box.width / 2, box.height / 2);
      }
    });
  }

  private doubleTap(x: number, y: number): void {
    if (this.view.k >= 1.5) {
      this.frameAnimated();
      return;
    }
    const k = clamp(this.view.k * 2, MIN_SCALE, MAX_SCALE);
    const ratio = k / this.view.k;
    this.animateTo({ k, x: x - (x - this.view.x) * ratio, y: y - (y - this.view.y) * ratio });
  }

  private frameAnimated(): void {
    const before = { ...this.view };
    this.frame();
    const target = { ...this.view };
    this.view = before;
    this.animateTo(target);
  }

  /** Keeps the tree gliding after a flick, the way a map does. */
  private flick(velocity: { x: number; y: number }): void {
    let vx = clamp(velocity.x, -4, 4);
    let vy = clamp(velocity.y, -4, 4);
    if (Math.hypot(vx, vy) < 0.15) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 32);
      last = now;
      this.set({ k: this.view.k, x: this.view.x + vx * dt, y: this.view.y + vy * dt });
      const decay = Math.pow(0.94, dt / 16);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) > 0.02) this.momentum = requestAnimationFrame(step);
    };
    this.momentum = requestAnimationFrame(step);
  }

  // ---- drawing ------------------------------------------------------------

  private buildFab(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fab-fit btn btn-primary btn-circle btn-lg shadow-lg';
    button.append(icon('fit'));
    button.addEventListener('click', () => this.fit());
    return button;
  }

  /** When, and from which family commit, this page was built — to spot a stale copy. */
  private drawStamp(): SVGTextElement {
    const text = svgEl('text', {
      class: 'build-stamp',
      x: this.layout.width / 2,
      y: this.layout.height + STAMP_SPACE - 10,
    });
    return text;
  }

  private drawLinks(): SVGGElement {
    const group = svgEl('g', { class: 'links' });
    const lanes = assignLanes(this.layout);

    for (const union of this.layout.unions) {
      const partners = union.partners
        .map((id) => this.layout.nodes.get(id))
        .filter((n): n is NodeBox => !!n)
        .sort((a, b) => a.x - b.x);

      const state = unionStatus(union);
      const [left, right] = partners;
      // Only a real couple gets the rings; a lone parent has no line to hang on.
      const rings = state === 'married' && !!left && !!right;
      if (left && right) {
        const cls = `link link-${state}`;
        const x1 = left.x + METRICS.bubbleRadius;
        const x2 = right.x - METRICS.bubbleRadius;
        if (rings) {
          group.append(
            svgEl('line', { class: cls, x1, y1: left.y, x2: union.x - RINGS.clearance, y2: union.y }),
            svgEl('line', { class: cls, x1: union.x + RINGS.clearance, y1: union.y, x2, y2: right.y }),
            weddingRings(union.x, union.y),
          );
        } else {
          group.append(svgEl('line', { class: cls, x1, y1: left.y, x2, y2: right.y }));
        }
        const label = unionLabel(union);
        if (label) {
          const text = svgEl('text', {
            class: 'union-label',
            x: union.x,
            y: union.y - (rings ? RINGS.radius + 8 : 8),
          });
          text.textContent = label;
          group.append(text);
        }
      }

      const children = union.children
        .map((id) => this.layout.nodes.get(id))
        .filter((n): n is NodeBox => !!n);
      if (children.length === 0) continue;

      const busY = union.y + METRICS.rowHeight - 92 + (lanes.get(union.id) ?? 0) * 15;
      const xs = children.map((c) => c.x);
      group.append(
        svgEl('path', {
          class: 'link link-descent',
          d: [
            // The children hang off the rings when there are any, off the
            // partner line otherwise.
            `M ${union.x} ${union.y + (rings ? RINGS.radius : partners.length > 1 ? 6 : METRICS.bubbleRadius)}`,
            `L ${union.x} ${busY}`,
            `M ${Math.min(...xs, union.x)} ${busY}`,
            `L ${Math.max(...xs, union.x)} ${busY}`,
            ...children.map((c) => `M ${c.x} ${busY} L ${c.x} ${c.y - METRICS.bubbleRadius - 4}`),
          ].join(' '),
        }),
      );
    }
    return group;
  }

  private drawNodes(): SVGGElement {
    const group = svgEl('g', { class: 'nodes' });
    for (const node of [...this.layout.nodes.values()].sort((a, b) => a.y - b.y)) {
      const person = this.family.person(node.id);
      if (!person) continue;
      const element = this.drawNode(person, node);
      this.nodeElements.set(node.id, element);
      group.append(element);
    }
    return group;
  }

  private drawNode(person: Person, node: NodeBox): SVGGElement {
    const r = METRICS.bubbleRadius;
    const group = svgEl('g', {
      class: `node${isDeceased(person) ? ' is-deceased' : ''}`,
      transform: `translate(${node.x} ${node.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': person.name,
    });
    group.dataset.id = person.id;
    group.style.setProperty('--avatar-h', String(avatarHue(person.id)));

    group.append(svgEl('circle', { class: 'bubble-ring', r: r + 3 }));
    group.append(svgEl('circle', { class: 'bubble', r }));

    const url = photoUrl(person);
    if (url) {
      const clipId = `clip-${person.id}`;
      const clip = svgEl('clipPath', { id: clipId });
      clip.append(svgEl('circle', { r }));
      group.append(clip);
      group.append(
        svgEl('image', {
          href: url,
          x: -r,
          y: -r,
          width: r * 2,
          height: r * 2,
          preserveAspectRatio: 'xMidYMid slice',
          'clip-path': `url(#${clipId})`,
        }),
      );
    } else {
      group.append(svgEl('circle', { class: 'bubble-fill', r }));
      const text = svgEl('text', { class: 'bubble-initials', y: 8 });
      text.textContent = initials(person);
      group.append(text);
    }

    const first = svgEl('text', { class: 'node-name', y: r + 22 });
    first.textContent = shortName(person);
    group.append(first);

    const last = familyName(person);
    if (last) {
      const surname = svgEl('text', { class: 'node-surname', y: r + 38 });
      surname.textContent = last;
      group.append(surname);
    }

    const years = lifespan(person);
    if (years) {
      const dates = svgEl('text', { class: 'node-years', y: r + (last ? 54 : 38) });
      dates.textContent = years;
      group.append(dates);
    }
    return group;
  }
}

/** `1956` for a partnership, `1984–1996` once it ended. */
function unionLabel(union: UnionEdge): string {
  const from = year(unionStart(union));
  const to = year(unionEnd(union));
  if (from && to) return `${from}–${to}`;
  return to ? `–${to}` : from;
}

/**
 * Two families in the same generation whose children sit side by side would
 * otherwise draw their horizontal bus at exactly the same height and read as a
 * single line. Overlapping buses get their own lane.
 */
function assignLanes(layout: Layout): Map<string, number> {
  const spans = layout.unions
    .map((union) => {
      const xs = [...union.children, ...union.partners]
        .map((id) => layout.nodes.get(id)?.x)
        .filter((x): x is number => x !== undefined);
      return { union, from: Math.min(...xs), to: Math.max(...xs) };
    })
    .filter((span) => span.union.children.length > 0)
    .sort((a, b) => a.from - b.from);

  const lanes = new Map<string, number>();
  const ends = new Map<string, number[]>();
  for (const span of spans) {
    const row = String(span.union.y);
    const taken = ends.get(row) ?? [];
    let lane = taken.findIndex((end) => end < span.from - 10);
    if (lane === -1) lane = taken.length;
    taken[lane] = span.to;
    ends.set(row, taken);
    lanes.set(span.union.id, lane);
  }
  return lanes;
}

type Point = { x: number; y: number };

function spread(pointers: Map<number, Point>): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function midpoint(pointers: Map<number, Point>): { clientX: number; clientY: number } {
  const [a, b] = [...pointers.values()];
  return a && b
    ? { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }
    : { clientX: 0, clientY: 0 };
}

function mix(previous: number, next: number, weight: number): number {
  return previous * (1 - weight) + next * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
