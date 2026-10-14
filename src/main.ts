import './styles/app.css';

import { fetchChanges, loadSource, saveEdits, uploadPhoto } from '@source';
import { upcoming } from './calendar';
import { photoUrl, readFamily } from './data';
import { openEditor, openNewPerson, type EditorContext } from './edit/editor';
import { Family } from './family';
import { LANGS, lang, setLang, t } from './i18n';
import { relation } from './kinship';
import { gaps } from './missing';
import type { Person } from './parser/types';
import type { Edit } from './parser/write';
import { SaveConflict, type FamilySource } from './source/types';
import { familyStats } from './stats';
import { lifespan, shortName, today } from './ui/format';
import { icon, iconButton, type IconName } from './ui/icons';
import { closeMenu, openMenu } from './ui/menu';
import { pickPerson } from './ui/picker';
import { canShare, openShare } from './ui/share';
import { readStored, writeStored } from './ui/storage';
import { bubble } from './ui/tile';
import { renderDates } from './views/dates';
import { renderMissing } from './views/missing';
import { OverviewView, type TreeTarget } from './views/overview';
import { renderPerson } from './views/person';
import { renderRelation, route as relationRoute } from './views/relation';
import { renderSource } from './views/source';
import { renderStats } from './views/stats';
import { treeMenu } from './views/tree-menu';

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

// The hosted app asks the server; the single file has the family built in.
let source: FamilySource = await loadSource().catch((error: unknown) => {
  must<HTMLElement>('#view').textContent = t().loadFailed;
  throw error;
});
let family = new Family(readFamily(source));
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
  | { kind: 'tree' | 'dates' | 'stats' | 'missing' | 'file' }
  | { kind: 'up' | 'down' | 'person'; person: Person }
  | { kind: 'relation' | 'path'; a: Person; b: Person };

/** How far ahead the birthday list looks. */
const DATES_SPAN = 30;

/**
 * `#/`, `#/p/klaus`, `#/up/klaus`, `#/down/klaus`, `#/r/jonas/felix`,
 * `#/path/jonas/felix`, `#/dates`, `#/file`.
 */
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
  if ((kind === 'dates' || kind === 'stats' || kind === 'missing' || kind === 'file') && parts.length === 1) return { kind };
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

let tree = new OverviewView(family, openFromTree, openTreeMenu);
/** Ancestor and descendant trees, built the first time they are asked for. */
const subtrees = new Map<string, OverviewView>();
/** The tree on screen, if a tree is on screen. */
let shownTree: OverviewView | undefined;

function openFromTree(id: string): void {
  location.hash = `#/p/${encodeURIComponent(id)}`;
}

/** Right-click or long press on a tree: what can be done right there. */
function openTreeMenu(target: TreeTarget, at: { x: number; y: number }): void {
  const { title, items } = treeMenu(target, {
    family,
    editor: source.editable ? editorContext() : undefined,
    open: openFromTree,
    added: showAdded,
    fit: () => (shownTree ?? tree).fit(),
  });
  openMenu(at, title, items);
}

/** Someone new on the tree: brought into view and ringed, so the next step starts there. */
function showAdded(id: string): void {
  if (shownTree?.has(id)) shownTree.highlight(id);
}

function subtree(kind: 'up' | 'down', person: Person): OverviewView {
  const key = `${kind}/${person.id}`;
  let overview = subtrees.get(key);
  if (!overview) {
    const graph = kind === 'up' ? family.ancestorsGraph(person.id) : family.descendantsGraph(person.id);
    overview = new OverviewView(new Family(graph), openFromTree, openTreeMenu);
    subtrees.set(key, overview);
  }
  return overview;
}

function render(): void {
  closeResults();
  closeSearch();
  closeMenu();
  const route = parseRoute(location.hash);
  if (!route) {
    location.replace('#/');
    return;
  }
  backButton.hidden = route.kind === 'tree';
  shownTree = undefined;
  // A ring from the last search would read as part of whatever comes next.
  for (const overview of [tree, ...subtrees.values()]) overview.unhighlight();

  switch (route.kind) {
    case 'person': {
      const { person } = route;
      view.replaceChildren(
        renderPerson(family, person, {
          viewer: viewer(),
          pickRelative,
          setViewer,
          chooseViewer: () => void chooseViewer(),
          edit: source.editable ? (someone) => openEditor(someone, editorContext()) : undefined,
        }),
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
    case 'dates':
      showPage(renderDates(upcoming(family, today(), DATES_SPAN), DATES_SPAN, caption), t().datesTitle);
      return;
    case 'stats':
      showPage(renderStats(familyStats(family, today())), t().stats);
      return;
    case 'missing':
      // The page lists the file's warnings itself.
      document.querySelector('.warnings')?.remove();
      showPage(renderMissing(gaps(family, (p) => !!photoUrl(p), today()), family.graph.warnings), t().missing);
      return;
    case 'file':
      showPage(renderSource(source.markdown), 'family.md');
      return;
    case 'tree':
      if (family.people().length === 0) {
        view.replaceChildren(renderEmpty());
        document.title = family.graph.title;
        // A family that does not exist yet starts with its first person.
        if (source.editable && !offeredStart && !document.querySelector('dialog[open]')) {
          offeredStart = true;
          startFamily();
        }
        return;
      }
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

/** Whether the first person has been asked for once already — closing the sheet means "not now". */
let offeredStart = false;

function startFamily(): void {
  // Whoever starts the family is likely its first person: their login comes filled in.
  openNewPerson(editorContext(), showAdded, loginName());
}

/** The tree before there is anyone in it. */
function renderEmpty(): HTMLElement {
  const root = document.createElement('article');
  root.className = 'empty-view';
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = t().emptyTitle;
  const text = document.createElement('p');
  text.className = 'page-hint';
  text.textContent = source.editable ? t().emptyText : t().emptyReadOnly;
  root.append(icon('tree'), heading, text);
  if (source.editable) {
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn btn-primary';
    start.append(icon('plus'), t().emptyStart);
    start.addEventListener('click', startFamily);
    root.append(start);
  }
  return root;
}

/** Puts one of the list pages on screen. */
function showPage(page: HTMLElement, title: string): void {
  view.replaceChildren(page);
  view.scrollTop = 0;
  document.title = `${title} — ${family.graph.title}`;
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

  // Where to go and what to do: a link where there is a place, a button where
  // something happens.
  const more = document.createElement('div');
  more.className = 'settings-links';
  const entry = (glyph: IconName, label: string, target: string | (() => void)) => {
    let element: HTMLElement;
    if (typeof target === 'string') {
      const link = document.createElement('a');
      link.href = target;
      element = link;
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      element = button;
    }
    element.className = 'btn btn-ghost btn-sm w-full justify-start';
    element.append(icon(glyph), label);
    element.addEventListener('click', () => {
      menu.open = false;
      if (typeof target !== 'string') target();
    });
    more.append(element);
  };
  entry('link', t().findRelation, () => void findRelation());
  entry('cake', t().datesTitle, '#/dates');
  entry('chart', t().stats, '#/stats');
  entry('checklist', t().missing, '#/missing');
  entry('file', t().viewFile, '#/file');
  if (source.editable) {
    entry('plus', t().addPerson, () =>
      openNewPerson(editorContext(), (id) => (location.hash = `#/p/${encodeURIComponent(id)}`)),
    );
  }
  if (canShare()) entry('qr', t().share, () => openShare(location.href));

  const save = document.createElement('div');
  save.className = 'join w-full';
  for (const [format, label] of [
    ['png', t().savePng],
    ['svg', t().saveSvg],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm join-item flex-1 btn-ghost bg-base-200';
    button.append(icon('download'), label);
    button.addEventListener('click', () => void saveTree(format));
    save.append(button);
  }

  const mode = (readStored('stammbaum-mode') ?? 'system') as Mode;
  menuPanel.replaceChildren(
    group(t().iAm, who, hint(t().iAmHint)),
    group(t().more, more),
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
    group(t().saveTree, save, hint(t().saveHint)),
  );
}

/** Downloads the tree on screen — or the whole family, from any other screen. */
async function saveTree(format: 'png' | 'svg'): Promise<void> {
  menu.open = false;
  const overview = shownTree ?? tree;
  const heading = shownTree ? document.title : family.graph.title;
  try {
    const blob = await overview.exportImage(format, heading);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName(heading)}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  } catch (error) {
    console.error(error);
    toast(t().saveFailed);
  }
}

/** "Vorfahren von Nina — Familie Bauer" → "vorfahren-von-nina-familie-bauer". */
function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'stammbaum';
}

/** A short message at the bottom of the screen that goes away on its own. */
function toast(text: string, kind: 'error' | 'success' | 'info' = 'error'): void {
  // One at a time: "uploading" gives way to "saved".
  for (const earlier of document.querySelectorAll('.toast-note')) earlier.remove();
  const element = document.createElement('div');
  element.className = `toast-note alert alert-${kind} shadow-lg`;
  element.setAttribute('role', 'status');
  element.textContent = text;
  document.body.append(element);
  setTimeout(() => element.remove(), kind === 'error' ? 6000 : 2500);
}

// ---- editing ----------------------------------------------------------------

function editorContext(): EditorContext {
  return {
    // Read at the moment it is needed: after a save, the new family.
    get family() {
      return family;
    },
    save,
    upload,
    caption,
  };
}

async function upload(image: Blob, name: string): Promise<string | undefined> {
  toast(t().uploading, 'info');
  try {
    return await uploadPhoto(image, name);
  } catch (error) {
    console.error(error);
    toast(t().uploadError);
    return undefined;
  }
}

/**
 * Sends edits to the server and shows the family as it is afterwards. When
 * someone else got there first, their version is shown instead and nothing of
 * this edit is lost silently — it just has to be made again.
 */
async function save(edits: Edit[], message: string): Promise<Record<string, string> | undefined> {
  try {
    const saved = await saveEdits(edits, message);
    useSource(saved.source);
    toast(t().saved, 'success');
    return saved.created;
  } catch (error) {
    if (error instanceof SaveConflict) {
      // Any open form still holds the old values; it has to start again from the new ones.
      for (const dialog of document.querySelectorAll('dialog[open]')) (dialog as HTMLDialogElement).close();
      useSource(error.source);
      toast(t().saveConflict);
    } else {
      console.error(error);
      toast(t().saveError);
    }
    return undefined;
  }
}

/** Puts a new version of the family on screen, wherever one was looking. */
function useSource(next: FamilySource): void {
  source = next;
  family = new Family(readFamily(next));
  title.textContent = family.graph.title;
  const before = tree;
  tree = new OverviewView(family, openFromTree, openTreeMenu);
  // The same family a moment later: stay where one was looking.
  tree.keepViewOf(before);
  subtrees.clear();
  refresh();
}

// Someone else may have saved while this tab was in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  fetchChanges()
    .then((next) => {
      if (next && (next.version !== source.version || next.editable !== source.editable)) useSource(next);
    })
    .catch(() => undefined);
});

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
  // The whole list, with everything else the file is missing, has a page.
  const more = document.createElement('a');
  more.href = '#/missing';
  more.className = 'link font-semibold';
  more.textContent = `${t().missing} →`;
  banner.append(heading, list, more);
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
