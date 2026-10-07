import './styles/app.css';

import { loadFamily } from './data';
import { Family } from './family';
import { LANGS, lang, setLang, t } from './i18n';
import { relation } from './kinship';
import type { Person } from './parser/types';
import { lifespan } from './ui/format';
import { icon, iconButton, type IconName } from './ui/icons';
import { pickPerson } from './ui/picker';
import { readStored, writeStored } from './ui/storage';
import { bubble } from './ui/tile';
import { OverviewView } from './views/overview';
import { renderPerson } from './views/person';

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
  const login = loginName();
  return (login && family.byLogin(login)?.id) || family.graph.me;
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
  const chosen = await pickPerson(family, { title: t().whoAreYou, none: true });
  if (chosen !== undefined) setViewer(chosen ? chosen.id : null);
}

const overview = new OverviewView(family, (id) => {
  location.hash = `#/p/${encodeURIComponent(id)}`;
});

// ---- routing --------------------------------------------------------------

function route(): void {
  const match = /^#\/p\/(.+)$/.exec(location.hash);
  const person = match ? family.person(decodeURIComponent(match[1]!)) : undefined;
  closeResults();
  closeSearch();

  if (person) {
    view.replaceChildren(renderPerson(family, person, { viewer: viewer(), setViewer }));
    view.scrollTop = 0;
    backButton.hidden = false;
    document.title = `${person.name} — ${family.graph.title}`;
    return;
  }
  if (match) location.replace('#/');

  view.replaceChildren(overview.element);
  overview.markViewer(viewer());
  overview.activate();
  showGestureHint();
  backButton.hidden = true;
  document.title = family.graph.title;
}

window.addEventListener('hashchange', route);
backButton.addEventListener('click', () => {
  location.hash = '#/';
});

// ---- search ---------------------------------------------------------------

let hits: Person[] = [];

function closeResults(): void {
  results.hidden = true;
  results.replaceChildren();
  searchInput.setAttribute('aria-expanded', 'false');
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
  // On the overview a hit centres the bubble instead of leaving the map.
  if (location.hash === '' || location.hash === '#/') overview.highlight(person.id);
  else location.hash = `#/p/${encodeURIComponent(person.id)}`;
}

searchInput.addEventListener('input', () => {
  hits = family.search(searchInput.value, { extra: relationWords });
  if (hits.length === 0) {
    closeResults();
    return;
  }
  results.replaceChildren(
    ...hits.map((person) => {
      const item = document.createElement('li');
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
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && hits[0]) openPerson(hits[0]);
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
  overview.localize();
  route();
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

function showGestureHint(): void {
  if (readStored('stammbaum-hint') === 'seen') return;
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
  for (const warning of family.graph.warnings.slice(0, 8)) {
    const item = document.createElement('li');
    item.textContent = warning.line > 0 ? t().warningLine(warning.line, warning.message) : warning.message;
    list.append(item);
  }
  banner.append(heading, list);
  banner.addEventListener('click', () => banner.remove());
  document.body.append(banner);
}

localize();
route();

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
