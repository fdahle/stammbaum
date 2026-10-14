import { countryLabel, countryList } from '../countries';
import { placeName } from '../places';
import { galleryUrls } from '../data';
import type { Family } from '../family';
import { lang, t } from '../i18n';
import { relation } from '../kinship';
import {
  isDeceased,
  knownDate,
  unionEnd,
  unionStart,
  unionStatus,
  type Person,
  type Union,
  type UnionStatus,
} from '../parser/types';
import { bubble, tile } from '../ui/tile';
import { ageOf, hasBirthday, longDate, parseDate, shortName, today, year, yearsBetween } from '../ui/format';
import { icon, weddingRings, RINGS, type IconName } from '../ui/icons';
import { openLightbox } from '../ui/lightbox';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PersonContext {
  /** Who is looking: everyone is captioned with what they are to this person. */
  viewer: string | undefined;
  /** Asks who to compare `person` with, then shows how the two are related. */
  pickRelative(person: Person): void;
  /** Opens the editor for `person` — only there when whoever is looking may edit. */
  edit?: ((person: Person) => void) | undefined;
}

/**
 * One person and their first-degree relatives: parents above, partners beside,
 * children below. Connectors are drawn into an SVG overlay after layout, so
 * they stay correct however the rows wrap on a phone.
 */
export function renderPerson(family: Family, person: Person, context: PersonContext): HTMLElement {
  const root = document.createElement('article');
  root.className = 'person-view';

  const wires = document.createElementNS(SVG_NS, 'svg');
  wires.setAttribute('class', 'wires');
  root.append(wires);

  const parents = family.parents(person.id);
  const partnerships = family.partnerships(person.id);
  const broods = family.broods(person.id);
  // Everyone is captioned with what they are to whoever is looking.
  const { viewer } = context;
  const kin = (other: Person) => (viewer ? relation(family, viewer, other.id, lang()) : undefined);

  const parentTiles: HTMLElement[] = [];
  if (parents.length > 0) {
    const tier = section('tier tier-parents', t().parents);
    const row = document.createElement('div');
    row.className = 'row';
    for (const parent of parents) {
      const element = tile(parent, kin(parent));
      parentTiles.push(element);
      row.append(element);
    }
    tier.append(row);
    root.append(tier);
  }

  // Focus row: a three-column grid keeps the focused person dead centre even
  // when there is only one partner.
  const focusTier = document.createElement('section');
  focusTier.className = 'tier tier-focus';
  const left = document.createElement('div');
  left.className = 'partner-slot slot-left';
  const right = document.createElement('div');
  right.className = 'partner-slot slot-right';
  const card = focusCard(family, person, kin(person), context);
  focusTier.append(left, card, right);
  root.append(focusTier);

  // Someone married to the same person twice gets one tile with both pills.
  const byPartner = new Map<string, { partner: Person; unions: Union[] }>();
  for (const { union, partner } of partnerships) {
    if (!partner) continue;
    const entry = byPartner.get(partner.id) ?? { partner, unions: [] };
    entry.unions.push(union);
    byPartner.set(partner.id, entry);
  }
  /** Keyed by union, so a couple married twice shares one element under both ids. */
  const partnerTiles = new Map<string, HTMLElement>();
  [...byPartner.values()].forEach(({ partner, unions }, index) => {
    const element = document.createElement('div');
    element.className = 'partner';
    // The connector is drawn later, from the geometry — it reads the state of
    // the latest partnership here.
    element.dataset.status = unionStatus(unions[unions.length - 1]!);
    element.append(tile(partner, kin(partner)), ...unions.map(relationPill));
    for (const union of unions) partnerTiles.set(union.id, element);
    (index === 0 && byPartner.size > 1 ? left : right).append(element);
  });
  // Narrow screens drop the partners below the card; the CSS needs to know
  // which side is actually occupied to keep a single partner centred.
  focusTier.classList.toggle('has-left', left.childElementCount > 0);
  focusTier.classList.toggle('has-right', right.childElementCount > 0);

  const broodTiles: Array<{ union: Union; tiles: HTMLElement[] }> = [];
  if (broods.length > 0) {
    const tier = section('tier tier-children', broods.flatMap((b) => b.children).length === 1 ? t().child : t().children);
    const groups = document.createElement('div');
    groups.className = 'broods';
    for (const brood of broods) {
      const group = document.createElement('div');
      group.className = 'brood';
      if (broods.length > 1 && brood.partner) {
        const caption = document.createElement('span');
        caption.className = 'brood-label';
        caption.textContent = t().withPartner(shortName(brood.partner));
        group.append(caption);
      }
      const row = document.createElement('div');
      row.className = 'row';
      const tiles = brood.children.map((child) => {
        const element = tile(child, kin(child));
        row.append(element);
        return element as HTMLElement;
      });
      group.append(row);
      groups.append(group);
      broodTiles.push({ union: brood.union, tiles });
    }
    tier.append(groups);
    root.append(tier);
  }

  if (parents.length === 0 && partnerships.length === 0 && broods.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opacity-60';
    empty.textContent = t().noRelatives;
    root.append(empty);
  }

  const draw = () => drawWires(wires, root, card, parentTiles, partnerTiles, broodTiles);
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(root);
  return root;
}

function section(className: string, label: string): HTMLElement {
  const element = document.createElement('section');
  element.className = className;
  const caption = document.createElement('h2');
  caption.className = 'tier-label';
  caption.textContent = label;
  element.append(caption);
  return element;
}

function focusCard(
  family: Family,
  person: Person,
  relation: string | undefined,
  context: PersonContext,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `focus-card card bg-base-100 shadow-sm${isDeceased(person) ? ' is-deceased' : ''}`;
  const portrait = bubble(person);
  card.append(portrait);
  // Editing sits quietly in the corner, for whoever may.
  const { edit } = context;
  if (edit) {
    const pen = document.createElement('button');
    pen.type = 'button';
    pen.className = 'focus-edit btn btn-ghost btn-circle btn-sm';
    pen.title = t().edit;
    pen.setAttribute('aria-label', t().editTitle(person.name));
    pen.append(icon('pencil'));
    pen.addEventListener('click', () => edit(person));
    card.append(pen);
  }

  const name = document.createElement('h1');
  name.className = 'focus-name';
  name.textContent = person.name;
  card.append(name);
  if (relation) card.append(line('focus-relation', relation));

  if (person.nick && person.nick !== shortName(person)) {
    card.append(line('focus-nick', lang() === 'de' ? `„${person.nick}“` : `“${person.nick}”`));
  }
  if (person.maiden) card.append(line('focus-maiden', t().nee(person.maiden)));
  if (person.job) card.append(line('focus-job', person.job));

  const now = today();
  const dates: string[] = [];
  // `* 2. April 1931 in Lindau` — the date, the place, or both. A death with
  // neither still gets its cross.
  const dated = (mark: string, date: string | undefined, where: string | undefined, always = false) => {
    const when = knownDate(date);
    if (!when && !where && !always) return;
    dates.push([mark, longDate(when), where && t().inPlace(where)].filter(Boolean).join(' '));
  };
  // A place and its country: "Lindau, Deutschland", or either alone.
  const where = (place: string | undefined, country: string | undefined) =>
    [place && placeName(place), country && countryLabel(country)].filter(Boolean).join(', ') || undefined;
  dated('*', person.born, where(person.birthplace, person.birthcountry));
  dated('†', person.died, where(person.deathplace, person.deathcountry), isDeceased(person));
  if (dates.length > 0) card.append(line('focus-dates', dates.join('\n')));

  const age = ageOf(person, now);
  if (age) card.append(line('focus-age', age.final ? t().ageAtDeath(age.years, age.approx) : t().age(age.years, age.approx)));
  if (hasBirthday(person, now)) {
    const badge = line('focus-birthday badge badge-accent', t().birthdayToday);
    card.append(badge);
  }
  const home = where(person.lives, person.country);
  if (home) card.append(line('focus-lives', t().lives(home)));
  const nationalities = countryList(person.nationality).map((country) => countryLabel(country));
  if (nationalities.length > 0) card.append(line('focus-lives', t().nationality(nationalities.join(', '))));
  if (family.adopted(person.id)) card.append(line('focus-adopted', t().adopted));
  if (person.note) card.append(line('focus-note', person.note));

  const pictures = galleryUrls(person);
  if (pictures.length > 0) {
    portrait.classList.add('is-zoomable');
    portrait.addEventListener('click', () => openLightbox(pictures, 0, person.name));
  }
  if (pictures.length > 1) {
    const gallery = document.createElement('div');
    gallery.className = 'focus-gallery';
    pictures.forEach((url, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gallery-thumb';
      button.setAttribute('aria-label', t().photo(index + 1, pictures.length));
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      button.append(image);
      button.addEventListener('click', () => openLightbox(pictures, index, person.name));
      gallery.append(button);
    });
    card.append(gallery);
  }

  card.append(actions(family, person, context));
  return card;
}

/** What can be done from here: other views of this person and their family. */
function actions(family: Family, person: Person, context: PersonContext): HTMLElement {
  const row = document.createElement('div');
  row.className = 'focus-actions';
  // A link where there is a place to go, a button where something happens.
  const add = (iconName: IconName, label: string, target: string | (() => void)) => {
    let element: HTMLElement;
    if (typeof target === 'string') {
      const link = document.createElement('a');
      link.href = target;
      element = link;
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', target);
      element = button;
    }
    element.className = 'btn btn-sm btn-soft btn-primary';
    element.append(icon(iconName), label);
    row.append(element);
  };
  const id = encodeURIComponent(person.id);

  if (context.viewer && context.viewer !== person.id) {
    add('link', t().howAreWeRelated, `#/r/${encodeURIComponent(context.viewer)}/${id}`);
  }
  add('link', t().relatedTo, () => context.pickRelative(person));
  if (family.parents(person.id).length > 0) add('up', t().ancestors, `#/up/${id}`);
  if (family.children(person.id).length > 0) add('down', t().descendants, `#/down/${id}`);
  return row;
}

function line(className: string, text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}

/** How each of the four partnership states is coloured. */
const RELATION: Record<UnionStatus, { badge: string; ended: boolean }> = {
  married: { badge: 'badge-primary', ended: false },
  together: { badge: 'badge-secondary', ended: false },
  divorced: { badge: 'badge-error', ended: true },
  separated: { badge: 'badge-error', ended: true },
};

function relationPill(union: Union): HTMLElement {
  const status = unionStatus(union);
  const { badge, ended } = RELATION[status];
  const label = t().status[status];
  const pill = document.createElement('span');
  pill.className = `relation-pill badge badge-sm badge-soft ${badge}`;
  const from = year(unionStart(union));
  const to = year(unionEnd(union));
  if (ended) {
    pill.textContent = [from, to].filter(Boolean).join(' – ') || label;
    pill.title = `${label}${to ? ` ${to}` : ''}`;
  } else {
    // A lasting partnership also says how long it has lasted.
    const start = parseDate(unionStart(union));
    const lasted = start && yearsBetween(start, today());
    const duration = lasted && lasted.years > 0 ? ` · ${t().yearsTogether(lasted.years)}` : '';
    pill.textContent = from ? `${t().since(from)}${duration}` : label;
    pill.title = `${label}${from ? ` ${t().since(from)}` : ''}`;
  }
  return pill;
}

// ---- connectors -----------------------------------------------------------

function drawWires(
  svg: SVGSVGElement,
  root: HTMLElement,
  focus: HTMLElement,
  parents: HTMLElement[],
  partners: Map<string, HTMLElement>,
  broods: Array<{ union: Union; tiles: HTMLElement[] }>,
): void {
  const base = root.getBoundingClientRect();
  if (base.width === 0) return;
  svg.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
  svg.setAttribute('width', String(base.width));
  svg.setAttribute('height', String(base.height));
  svg.replaceChildren();

  const box = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return {
      cx: rect.left - base.left + rect.width / 2,
      top: rect.top - base.top,
      bottom: rect.top - base.top + rect.height,
      left: rect.left - base.left,
      right: rect.right - base.left,
    };
  };
  const bubbleOf = (element: Element) => box(element.querySelector('.bubble-html') ?? element);

  const path = (d: string, className: string) => {
    const element = document.createElementNS(SVG_NS, 'path');
    element.setAttribute('class', className);
    element.setAttribute('d', d);
    svg.append(element);
  };
  /**
   * Where a married wire has to break to make room for the rings — or nothing,
   * when the span between the two tiles is too short to hold them.
   */
  const ringGap = (from: number, to: number): [number, number] | undefined => {
    if (Math.abs(to - from) < RINGS.clearance * 2 + 8) return undefined;
    const middle = (from + to) / 2;
    const step = Math.sign(to - from) * RINGS.clearance;
    return [middle - step, middle + step];
  };

  const focusBubble = bubbleOf(focus);

  const card = box(focus);
  if (parents.length > 0) {
    // Leave from the bottom of the whole tile so the wire clears the captions.
    const tiles = parents.map(box);
    const bubbles = parents.map(bubbleOf);
    const busY = (Math.max(...tiles.map((p) => p.bottom)) + card.top) / 2;
    const xs = [...bubbles.map((p) => p.cx), focusBubble.cx];
    path(
      [
        ...tiles.map((p, i) => `M ${bubbles[i]!.cx} ${p.bottom} L ${bubbles[i]!.cx} ${busY}`),
        `M ${Math.min(...xs)} ${busY} L ${Math.max(...xs)} ${busY}`,
        `M ${focusBubble.cx} ${busY} L ${focusBubble.cx} ${card.top}`,
      ].join(' '),
      'wire wire-descent',
    );
  }

  // A partner sits beside the card on a wide screen and below it on a phone.
  const partnerGeometry = new Map<string, { bubble: ReturnType<typeof box>; outer: ReturnType<typeof box>; below: boolean }>();
  const wired = new Set<HTMLElement>();
  for (const [unionId, element] of partners) {
    const bubble = bubbleOf(element);
    const outer = box(element);
    const below = bubble.top > card.bottom - 4;
    partnerGeometry.set(unionId, { bubble, outer, below });
    // One wire per partner, however often the two married.
    if (wired.has(element)) continue;
    wired.add(element);

    const status = element.dataset.status ?? 'married';
    const kind = `wire wire-${status}`;
    if (below) {
      const midY = (card.bottom + bubble.top) / 2;
      const gap = status === 'married' ? ringGap(focusBubble.cx, bubble.cx) : undefined;
      if (gap) {
        path(`M ${focusBubble.cx} ${card.bottom} L ${focusBubble.cx} ${midY} L ${gap[0]} ${midY}`, kind);
        path(`M ${gap[1]} ${midY} L ${bubble.cx} ${midY} L ${bubble.cx} ${bubble.top}`, kind);
        svg.append(weddingRings((focusBubble.cx + bubble.cx) / 2, midY));
      } else {
        path(
          `M ${focusBubble.cx} ${card.bottom} L ${focusBubble.cx} ${midY} L ${bubble.cx} ${midY} L ${bubble.cx} ${bubble.top}`,
          kind,
        );
      }
      continue;
    }
    const y = (bubble.top + bubble.bottom) / 2;
    const [from, to] =
      bubble.cx < focusBubble.cx ? [bubble.right, card.left] : [card.right, bubble.left];
    const gap = status === 'married' ? ringGap(from, to) : undefined;
    if (gap) {
      path(`M ${from} ${y} L ${gap[0]} ${y}`, kind);
      path(`M ${gap[1]} ${y} L ${to} ${y}`, kind);
      svg.append(weddingRings((from + to) / 2, y));
    } else {
      path(`M ${from} ${y} L ${to} ${y}`, kind);
    }
  }

  for (const { union, tiles } of broods) {
    if (tiles.length === 0) continue;
    const partner = partnerGeometry.get(union.id);
    // Stacked below the card, the children hang off the partner instead.
    const originX = partner ? (partner.below ? partner.bubble.cx : (partner.bubble.cx + focusBubble.cx) / 2) : focusBubble.cx;
    const originY = partner
      ? partner.below
        ? partner.outer.bottom
        : Math.max(partner.bubble.bottom, card.bottom) - 8
      : card.bottom;
    const children = tiles.map(bubbleOf);
    const busY = Math.max(
      originY + 10,
      Math.min(...children.map((c) => c.top)) - 22,
    );
    const xs = [...children.map((c) => c.cx), originX];
    path(
      [
        `M ${originX} ${originY} L ${originX} ${busY}`,
        `M ${Math.min(...xs)} ${busY} L ${Math.max(...xs)} ${busY}`,
        ...children.map((c) => `M ${c.cx} ${busY} L ${c.cx} ${c.top}`),
      ].join(' '),
      'wire wire-descent',
    );
  }
}
