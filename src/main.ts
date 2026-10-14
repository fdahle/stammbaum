import './styles/app.css';

import { loadFamily } from './data';
import { Family } from './family';
import { LANGS, lang, setLang, t } from './i18n';
import { relation } from './kinship';
import type { Person } from './parser/types';
import { lifespan, shortName } from './ui/format';
import { icon, iconButton, type IconName } from './ui/icons';
import { pickPerson } from './ui/picker';
import { readStored, writeStored } from './ui/storage';
import { bubble } from './ui/tile';
import { OverviewView } from './views/overview';
import { renderPerson } from './views/person';
import { renderRelation, route as relationRoute } from './views/relation';

/**
 * Three-way appearance switch. "system" leaves the choice to the OS: daisyUI's
 * dark theme is registered with --prefersdark, so it applies on its own when no
 * data-theme attribute is set.
 */
const MODES = [
  { id: 'system', icon: 'auto' },
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
] as const satisfies ReadonlyArray<{ id: string; icon: IconName }>;

type Mode = (typeof MODES)[number]['id'];

const family = new Family(loadFamily());
const appBar = must<HTMLElement>('.app-bar');
const actions = must<HTMLElement>('.app-actions');
const view = must<HTMLElement>('#view');
const searchInput = must<HTMLInputElement>('#search');
const results = must<HTMLUListElement>('#results');
const title = must<HTMLAnchorElement>('#family-title');

const backButton = iconButton('back', '');
const searchToggle = iconButton('search', '');
backButton.id = 'back';
searchToggle.id = 'search-toggle';
searchToggle.classList.add('search-toggle');
searchToggle.setAttribute('aria-pressed', 'false');
backButton.hidden = true;

const menu = document.createElement('details');
menu.className = 'dropdown dropdown-end settings-menu';
const menuButton = document.createElement('summary');
menuButton.className = 'btn btn-ghost btn-circle';
menuButton.append(icon('menu'));
const menuPanel = document.createElement('div');
menuPanel.className = 'dropdown-content settings-panel';
menu.append(menuButton, menuPanel);
actions.append(backButton, searchToggle, menu);

must<HTMLElement>('#crest').append(icon('tree'));
title.textContent = family.graph.title;

// ---- who is looking -------------------------------------------------------

/** Stored when someone says they are none of the people in the file. */
const NOBODY = '-';

/**
 * Who the captions are written for: whoever said "this is me" on this device,
 * else the person whose `login=` matches the login in front of the app, else
 * the file's `me` line.
 */
function viewer(): string | undefined {
  const chosen = readStored('stammbaum-me');
  if (chosen === NOBODY) return undefined;
  if (chosen && family.person(chosen)) return chosen;
  return loginViewer() ?? family.graph.me;
}

/** The person who logged in, when the login in front of the app says so. */
function loginViewer(): string | undefined {
  const login = loginName();
  return login ? family.byLogin(login)?.id : undefined;
}

/**
 * The reverse proxy can hand over who logged in — see deploy/ — as a cookie,
 * since a static page never sees the request headers.
 */
function loginName(): string | undefined {
  const match = /(?:^|;\s*)stammbaum_login=([^;]+)/.exec(document.cookie);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1];
  }
}

function setViewer(id: string | null): void {
  writeStored('stammbaum-me', id ?? NOBODY);
  // Someone new is looking: the tree opens on them next time it is shown.
  tree.reframe();
  refresh();
}

/** What someone is to the viewer, in the current language — cached, since search asks a lot. */
const captions = new Map<string, string | undefined>();
function caption(person: Person): string | undefined {
  const me = viewer();
  if (!me) return undefined;
  const key = `${me}|${lang()}|${person.id}`;
  if (!captions.has(key)) captions.set(key, relation(family, me, person.id, lang()));
  return captions.get(key);
}

/** Search finds people by what they are to you, in either language: "tante", "aunt". */
function relationWords(person: Person): Array<string | undefined> {
  const me = viewer();
  if (!me) return [];
  const key = `${me}|*|${person.id}`;
  if (!captions.has(key)) {
    captions.set(key, LANGS.map(({ id }) => relation(family, me, person.id, id) ?? '').join(' '));
  }
  return [captions.get(key)];
}

async function chooseViewer(): Promise<void> {
  menu.open = false;
  const chosen = await pickPerson(family, { title: t().whoAreYou, hint: t().iAmHint, none: true });
  if (chosen !== undefined) setViewer(chosen ? chosen.id : null);
}

/**
 * A first visit with no login to go by asks who is looking, rather than
 * quietly captioning everything for the file's `me`. Asked once: closing the
 * sheet keeps the `me` line, and the menu can still change it.
 */
function welcome(): void {
  if (readStored('stammbaum-me') !== null || readStored('stammbaum-asked') !== null) return;
  if (loginViewer() || family.people().length < 2) return;
  writeStored('stammbaum-asked', 'yes');
  void chooseViewer();
}

/** Asks who to compare `person` with, then shows how the two are related. */
async function pickRelative(person: Person): Promise<void> {
  const other = await pickPerson(family, {
    title: t().pickOther(shortName(person)),
    caption,
    extra: relationWords,
    exclude: person.id,
  });
  if (other) location.hash = relationRoute(person, other);
}

async function findRelation(): Promise<void> {
  menu.open = false;
  const me = viewer();
  const first = (me && family.person(me)) || (await pickPerson(family, { title: t().pickFirst, caption, extra: relationWords }));
  if (first) await pickRelative(first);
}

// ---- routing --------------------------------------------------------------

type Route =
  | { kind: 'tree' }
  | { kind: 'up' | 'down' | 'person'; person: Person }
  | { kind: 'relation' | 'path'; a: Person; b: Person };

/** `#/`, `#/p/klaus`, `#/up/klaus`, `#/down/klaus`, `#/r/jonas/felix`, `#/path/jonas/felix`. */
function parseRoute(hash: string): Route | undefined {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const people = parts.slice(1).map((part) => {
    try {
      return family.person(decodeURIComponent(part));
    } catch {
      return undefined;
    }
  });
  const [kind] = parts;
  if (kind === undefined) return { kind: 'tree' };
  if (people.some((p) => !p)) return undefined;
  const [a, b] = people as Person[];
  if ((kind === 'p' || kind === 'up' || kind === 'down') && a && !b) {
    return { kind: kind === 'p' ? 'person' : kind, person: a };
  }
  if ((kind === 'r' || kind === 'path') && a && b && people.length === 2) {
    return { kind: kind === 'r' ? 'relation' : 'path', a, b };
  }
  return undefined;
}

const tree = new OverviewView(family, openFromTree);
/** Ancestor and descendant trees, built the first time they are asked for. */
const subtrees = new Map<string, OverviewView>();
/** The tree on screen, if a tree is on screen. */
let shownTree: OverviewView | undefined;

function openFromTree(id: string): void {
  location.hash = `#/p/${encodeURIComponent(id)}`;
}

function subtree(kind: 'up' | 'down', person: Person): OverviewView {
  const key = `${kind}/${person.id}`;
  let overview = subtrees.get(key);
  if (!overview) {
    const graph = kind === 'up' ? family.ancestorsGraph(person.id) : family.descendantsGraph(person.id);
    overview = new OverviewView(new Family(graph), openFromTree);
    subtrees.set(key, overview);
  }
  return overview;
}

function render(): void {
  closeResults();
  closeSearch();
  const route = parseRoute(location.hash);
  if (!route) {
    location.replace('#/');
    return;
  }
  backButton.hidden = route.kind === 'tree';
  shownTree = undefined;

  switch (route.kind) {
    case 'person': {
      const { person } = route;
      view.replaceChildren(
        renderPerson(family, person, { viewer: viewer(), pickRelative, setViewer, chooseViewer: () => void chooseViewer() }),
      );
      view.scrollTop = 0;
      document.title = `${person.name} — ${family.graph.title}`;
      return;
    }
    case 'relation': {
      const { a, b } = route;
      view.replaceChildren(
        renderRelation(family, a, b, {
          change: async (which) => {
            const keep = which === 'a' ? b : a;
            const other = await pickPerson(family, { title: t().pickOther(shortName(keep)), caption, extra: relationWords });
            if (other) location.hash = which === 'a' ? relationRoute(other, b) : relationRoute(a, other);
          },
        }),
      );
      view.scrollTop = 0;
      document.title = `${shortName(a)} & ${shortName(b)} — ${family.graph.title}`;
      return;
    }
    case 'tree':
      showTree(tree, undefined, undefined, viewer());
      tree.emphasize(undefined);
      document.title = family.graph.title;
      return;
    case 'path': {
      const { a, b } = route;
      showTree(tree, `${shortName(a)} ↔ ${shortName(b)}`, relationRoute(a, b));
      tree.emphasize(family.path(a.id, b.id));
      document.title = `${shortName(a)} ↔ ${shortName(b)} — ${family.graph.title}`;
      return;
    }
    case 'up':
    case 'down': {
      const { person } = route;
      const label = route.kind === 'up' ? t().ancestorsOf(shortName(person)) : t().descendantsOf(shortName(person));
      showTree(subtree(route.kind, person), label, `#/p/${encodeURIComponent(person.id)}`, person.id);
      document.title = `${label} — ${family.graph.title}`;
      return;
    }
  }
}

/**
 * Puts a tree on screen, with a chip naming what it shows when it is not the
 * whole family. The first time, it opens on `focus` if the tree is too big.
 */
function showTree(overview: OverviewView, label?: string, closeTo = '#/', focus?: string): void {
  overview.element.querySelector('.tree-chip')?.remove();
  if (label) {
    const chip = document.createElement('div');
    chip.className = 'tree-chip badge badge-lg bg-base-100 shadow-md';
    const text = document.createElement('span');
    text.textContent = label;
    const close = document.createElement('a');
    close.className = 'tree-chip-close';
    close.href = closeTo;
    close.title = t().close;
    close.setAttribute('aria-label', t().close);
    close.append(icon('close'));
    chip.append(text, close);
    overview.element.append(chip);
  }
  view.replaceChildren(overview.element);
  overview.markViewer(viewer());
  overview.activate(focus);
  showGestureHint(overview);
  shownTree = overview;
}

window.addEventListener('hashchange', render);
backButton.addEventListener('click', () => {
  location.hash = '#/';
});

// ---- search ---------------------------------------------------------------

let hits: Person[] = [];
/** The hit Enter opens, moved with the arrow keys. */
let active = 0;

function closeResults(): void {
  results.hidden = true;
  results.replaceChildren();
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
}

function markActive(index: number): void {
  active = (index + hits.length) % hits.length;
  [...results.children].forEach((item, i) => {
    item.setAttribute('aria-selected', String(i === active));
    item.querySelector('.result')?.classList.toggle('is-active', i === active);
    if (i === active) {
      searchInput.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

/** On a phone the field lives under the bar and is opened by the search icon. */
function openSearch(): void {
  appBar.classList.add('is-searching');
  searchToggle.setAttribute('aria-pressed', 'true');
  searchInput.focus();
}

function closeSearch(): void {
  appBar.classList.remove('is-searching');
  searchToggle.setAttribute('aria-pressed', 'false');
  searchInput.value = '';
}

searchToggle.addEventListener('click', () => {
  if (appBar.classList.contains('is-searching')) {
    closeResults();
    closeSearch();
  } else {
    openSearch();
  }
});

function openPerson(person: Person): void {
  closeResults();
  closeSearch();
  searchInput.blur();
  // On a tree a hit centres the bubble instead of leaving the map.
  if (shownTree?.has(person.id)) shownTree.highlight(person.id);
  else location.hash = `#/p/${encodeURIComponent(person.id)}`;
}

searchInput.addEventListener('input', () => {
  hits = family.search(searchInput.value, { extra: relationWords });
  if (hits.length === 0) {
    closeResults();
    return;
  }
  results.replaceChildren(
    ...hits.map((person, index) => {
      const item = document.createElement('li');
      item.id = `result-${index}`;
      item.setAttribute('role', 'option');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result flex w-full items-baseline justify-between gap-3';
      const name = document.createElement('span');
      name.textContent = person.name;
      const detail = document.createElement('small');
      detail.className = 'opacity-60 tabular-nums text-right';
      detail.textContent = [caption(person), lifespan(person)].filter(Boolean).join(' · ');
      button.append(name, detail);
      button.addEventListener('click', () => openPerson(person));
      item.append(button);
      return item;
    }),
  );
  results.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
  markActive(0);
});

searchInput.addEventListener('keydown', (event) => {
  const open = !results.hidden && hits.length > 0;
  if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    markActive(active + (event.key === 'ArrowDown' ? 1 : -1));
  }
  const hit = hits[active];
  if (event.key === 'Enter' && open && hit) openPerson(hit);
  if (event.key === 'Escape') {
    closeResults();
    closeSearch();
  }
});

document.addEventListener('pointerdown', (event) => {
  const target = event.target as Element | null;
  if (!target?.closest('.settings-menu')) menu.open = false;
  if (target?.closest('.search') || target?.closest('.search-toggle')) return;
  closeResults();
  if (searchInput.value === '') closeSearch();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') menu.open = false;
});

// ---- settings -------------------------------------------------------------

menu.addEventListener('toggle', () => {
  if (menu.open) renderMenu();
});

function renderMenu(): void {
  const me = viewer();
  const person = me ? family.person(me) : undefined;

  const who = document.createElement('button');
  who.type = 'button';
  who.className = 'settings-viewer';
  const name = document.createElement('span');
  name.textContent = person ? person.name : t().nobody;
  if (person) who.append(bubble(person));
  who.append(name);
  who.addEventListener('click', () => void chooseViewer());

  const find = document.createElement('button');
  find.type = 'button';
  find.className = 'btn btn-soft btn-primary btn-sm w-full';
  find.append(icon('link'), t().findRelation);
  find.addEventListener('click', () => void findRelation());

  const mode = (readStored('stammbaum-mode') ?? 'system') as Mode;
  menuPanel.replaceChildren(
    group(t().iAm, who, hint(t().iAmHint)),
    group(
      t().language,
      segmented(
        LANGS.map(({ id, label }) => ({ id, label })),
        lang(),
        (id) => {
          setLang(id);
          refresh();
        },
      ),
    ),
    group(
      t().appearance,
      segmented(
        MODES.map(({ id, icon: glyph }) => ({ id, label: t().modes[id], icon: glyph })),
        mode,
        (id) => {
          applyMode(id);
          renderMenu();
        },
      ),
    ),
    find,
  );
}

function group(label: string, ...content: HTMLElement[]): HTMLElement {
  const element = document.createElement('section');
  element.className = 'settings-group';
  const heading = document.createElement('h2');
  heading.className = 'settings-label';
  heading.textContent = label;
  element.append(heading, ...content);
  return element;
}

function hint(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'settings-hint';
  element.textContent = text;
  return element;
}

/** A row of buttons of which exactly one is pressed. */
function segmented<T extends string>(
  options: Array<{ id: T; label: string; icon?: IconName }>,
  selected: T,
  choose: (id: T) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'join w-full';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    const active = option.id === selected;
    button.className = `btn btn-sm join-item flex-1 ${active ? 'btn-primary' : 'btn-ghost bg-base-200'}`;
    button.setAttribute('aria-pressed', String(active));
    if (option.icon) button.append(icon(option.icon));
    button.append(option.label);
    button.addEventListener('click', () => choose(option.id));
    row.append(button);
  }
  return row;
}

/** After the language or the viewer changed: every word and every caption again. */
function refresh(): void {
  captions.clear();
  localize();
  tree.localize();
  for (const overview of subtrees.values()) overview.localize();
  render();
  if (menu.open) renderMenu();
}

/** The words that live in index.html and the app bar rather than in a view. */
function localize(): void {
  document.documentElement.lang = lang();
  document.querySelector('meta[name="description"]')?.setAttribute('content', t().description);
  searchInput.placeholder = t().searchPlaceholder;
  searchInput.setAttribute('aria-label', t().search);
  for (const [element, text] of [
    [backButton, t().back],
    [searchToggle, t().search],
    [menuButton, t().menu],
  ] as const) {
    element.title = text;
    element.setAttribute('aria-label', text);
  }
}

// ---- appearance -----------------------------------------------------------

function applyMode(id: string): void {
  const mode = MODES.find((m) => m.id === id) ?? MODES[0];

  // No attribute means "let daisyUI follow prefers-color-scheme".
  if (mode.id === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode.id;

  // daisyUI sets color-scheme from inside a cascade layer, which any unlayered
  // rule on a host page would win against. Setting it inline keeps scrollbars
  // and form controls in step wherever the page is embedded.
  document.documentElement.style.colorScheme = mode.id === 'system' ? 'light dark' : mode.id;

  writeStored('stammbaum-mode', mode.id);
  paintThemeColor();
}

/** Keeps the phone's status bar in step with the theme. */
function paintThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('#theme-color');
  if (!meta) return;
  const shell = document.querySelector('.app-shell');
  const surface = shell ? getComputedStyle(shell).backgroundColor : '';
  if (surface) meta.content = toHex(surface) ?? surface;
}

/**
 * daisyUI's palette is oklch, which older browsers will not parse in a
 * theme-color tag. Painting one pixel and reading it back gives plain sRGB.
 */
function toHex(color: string): string | undefined {
  try {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return undefined;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return undefined;
  }
}

applyMode(readStored('stammbaum-mode') ?? 'system');
// Following the system means reacting when it changes.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeColor);

// ---- one-off gesture hint -------------------------------------------------

function showGestureHint(overview: OverviewView): void {
  if (readStored('stammbaum-hint') === 'seen') return;
  // Not behind the "who are you?" sheet, where it would time out unread.
  if (document.querySelector('dialog[open]')) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  const hint = document.createElement('div');
  hint.className = 'hint alert border-0 bg-neutral text-neutral-content shadow-lg';
  hint.textContent = touch ? t().hintTouch : t().hintMouse;
  overview.element.append(hint);
  writeStored('stammbaum-hint', 'seen');

  const dismiss = () => {
    hint.classList.add('is-leaving');
    setTimeout(() => hint.remove(), 400);
  };
  setTimeout(dismiss, 6000);
  overview.element.addEventListener('pointerdown', dismiss, { once: true });
}

// ---- parse warnings -------------------------------------------------------

if (family.graph.warnings.length > 0) {
  const banner = document.createElement('div');
  banner.className = 'warnings alert alert-warning shadow-lg flex-col items-start gap-1';
  const heading = document.createElement('strong');
  heading.textContent = t().warnings(family.graph.warnings.length);
  const list = document.createElement('ul');
  const shown = 8;
  for (const warning of family.graph.warnings.slice(0, shown)) {
    const item = document.createElement('li');
    item.textContent = warning.line > 0 ? t().warningLine(warning.line, warning.message) : warning.message;
    list.append(item);
  }
  const rest = family.graph.warnings.length - shown;
  if (rest > 0) {
    const item = document.createElement('li');
    item.textContent = t().moreWarnings(rest);
    list.append(item);
  }
  banner.append(heading, list);
  banner.addEventListener('click', () => banner.remove());
  document.body.append(banner);
}

localize();
welcome();
render();

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
