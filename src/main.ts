import './styles/app.css';

import { fetchChanges, loadSource, saveEdits, uploadPhoto, uploadThumb } from '@source';
import { upcoming } from './calendar';
import { photosWithoutThumb, photoUrl, readFamily } from './data';
import { makeThumb } from './edit/photos';
import { confirmMerge, openEditor, openNewPerson, type EditorContext } from './edit/editor';
import { Family } from './family';
import { LANGS, lang, setLang, t, warningText } from './i18n';
import { relation } from './kinship';
import { duplicates, gaps } from './missing';
import type { Person } from './parser/types';
import type { Edit } from './parser/write';
import { SaveConflict, UnsupportedImage, type FamilySource } from './source/types';
import { familyStats } from './stats';
import { navigate } from './ui/back';
import { displayName, lifespan, nameStandIns, shortName, today } from './ui/format';
import { icon, iconButton, type IconName } from './ui/icons';
import { closeMenu, openMenu } from './ui/menu';
import { pickPerson } from './ui/picker';
import { setShowsCauses, showsCauses } from './ui/prefs';
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
import { treeBar } from './views/tree-bar';
import { treeMenu } from './views/tree-menu';

/**
 * Three-way appearance switch. "system" leaves the choice to the OS: daisyUI's
 * dark theme is registered with --prefersdark, so it applies on its own when no
 * data-theme attribute is set.
 */
// Flags next to countries, unless the build left them out (STAMMBAUM_FLAGS=off).
// A chunk of its own; the font is only fetched where the system draws no flags.
if (__FLAGS__) void import('./flags');

const MODES = [
  { id: 'system', icon: 'auto' },
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
] as const satisfies ReadonlyArray<{ id: string; icon: IconName }>;

type Mode = (typeof MODES)[number]['id'];

// The hosted app asks the server; the single file has the family built in.
let source: FamilySource = await firstSource();
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
// Who is looking, and the one place to change it: their bubble, next to search.
const viewerButton = document.createElement('button');
viewerButton.type = 'button';
viewerButton.className = 'btn btn-ghost btn-circle viewer-button';
viewerButton.addEventListener('click', () => void chooseViewer());
actions.append(backButton, searchToggle, viewerButton, menu);

must<HTMLElement>('#crest').append(icon('tree'));

/** The heading of family.md — without one, the app's own name, in the language on screen. */
function familyTitle(): string {
  return /^#\s+\S/m.test(source.markdown) ? family.graph.title : t().appName;
}

// ---- who is looking -------------------------------------------------------

/** Stored when someone says they are none of the people in the file. */
const NOBODY = '-';

/** Who the captions are written for: whoever was chosen on this device, else the file's `me` line. */
function viewer(): string | undefined {
  const chosen = readStored('stammbaum-me');
  if (chosen === NOBODY) return undefined;
  if (chosen && family.person(chosen)) return chosen;
  return family.graph.me;
}

function setViewer(id: string | null): void {
  writeStored('stammbaum-me', id ?? NOBODY);
  // Someone new is looking: the tree is theirs, and opens on them.
  tree = makeTree();
  // Stand-ins in every tree are named for whoever looks.
  subtrees.clear();
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

// A parent nobody has named yet goes by what they are to whoever is looking.
nameStandIns((person) => caption(person));

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
 * A first visit asks who is looking, rather than quietly captioning
 * everything for the file's `me`. Asked once: closing the sheet keeps the
 * `me` line, and the bubble next to search can still change it.
 */
function welcome(): void {
  if (readStored('stammbaum-me') !== null || readStored('stammbaum-asked') !== null) return;
  if (family.people().length < 2) return;
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
  if (other) navigate(relationRoute(person, other));
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

/**
 * The whole family, or only whoever is looking's own: everyone they share an
 * ancestor with, and those people's partners — a partner's family stays out.
 */
let scope: 'all' | 'kin' = readStored('stammbaum-scope') === 'kin' ? 'kin' : 'all';

/** The tree for the overview, as wide as `scope` says. */
function makeTree(): OverviewView {
  const me = viewer();
  const shown = scope === 'kin' && me ? new Family(family.kinGraph(me)) : family;
  return new OverviewView(shown, openFromTree, openTreeMenu, pickOnTree);
}

/** Everyone, whatever the overview shows — a path between two people may run through anybody. */
function wholeTree(): OverviewView {
  if (scope === 'all' || !viewer()) return tree;
  let whole = subtrees.get('all');
  if (!whole) {
    whole = new OverviewView(family, openFromTree, openTreeMenu, pickOnTree);
    subtrees.set('all', whole);
  }
  return whole;
}

let tree = makeTree();
/** Ancestor and descendant trees, built the first time they are asked for. */
const subtrees = new Map<string, OverviewView>();
/** The tree on screen, if a tree is on screen. */
let shownTree: OverviewView | undefined;

function openFromTree(id: string): void {
  navigate(`#/p/${encodeURIComponent(id)}`);
}

/** What can be done about `target` on a tree. */
function treeChoices(target: TreeTarget): ReturnType<typeof treeMenu> {
  return treeMenu(target, {
    family,
    editor: source.editable ? editorContext() : undefined,
    open: openFromTree,
    added: showAdded,
    fit: () => (shownTree ?? tree).fit(),
  });
}

/** Right-click or long press on a tree: what can be done right there — for a finger, as a sheet. */
function openTreeMenu(target: TreeTarget, at: { x: number; y: number }, touch: boolean): void {
  const { title, items } = treeChoices(target);
  openMenu(touch ? undefined : at, title, items);
}

/**
 * A tap on a tree on a phone: the same choices, in a bar along the bottom.
 * Someone who may only look has nothing to choose but opening, so their tap
 * just opens.
 */
function pickOnTree(target: TreeTarget, done: () => void): HTMLElement | undefined {
  const { title, items } = treeChoices(target);
  if (!title || items.length === 0) return undefined;
  if (target.kind === 'person') {
    if (items.length === 1) return undefined;
    return treeBar(title, items, done, () => openFromTree(target.id));
  }
  return treeBar(title, items, done);
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
    overview = new OverviewView(new Family(graph), openFromTree, openTreeMenu, pickOnTree);
    subtrees.set(key, overview);
  }
  return overview;
}

/** The address last put on screen, to tell a new page from the same one again. */
let rendered: string | undefined;

/**
 * Puts the page the address names on screen. The same page again — after a
 * save, or someone else's — keeps where it was scrolled to and the search.
 */
function render(): void {
  const same = location.hash === rendered;
  rendered = location.hash;
  if (!same || results.hidden) {
    closeResults();
    if (!same) closeSearch();
  }
  closeMenu();
  const route = parseRoute(location.hash);
  if (!route) {
    // An old link, a renamed person, a typo: say so rather than quietly showing the tree.
    if (!same && /^#\/?(p|up|down|r|path)\//.test(location.hash)) toast(t().personNotFound, 'info');
    history.replaceState(history.state, '', '#/');
    render();
    return;
  }
  const scrolled = same ? view.scrollTop : 0;
  show(route);
  view.scrollTop = scrolled;
  // The hits again, from the family as it is now.
  if (same && !results.hidden) search(true);
}

function show(route: Route): void {
  backButton.hidden = route.kind === 'tree';
  shownTree = undefined;
  // A ring from the last search, or a tapped person's bar, would read as part of whatever comes next.
  for (const overview of [tree, ...subtrees.values()]) {
    overview.unhighlight();
    overview.unpick();
  }

  switch (route.kind) {
    case 'person': {
      const { person } = route;
      view.replaceChildren(
        renderPerson(family, person, {
          viewer: viewer(),
          pickRelative,
          edit: source.editable ? (someone) => openEditor(someone, editorContext()) : undefined,
        }),
      );
      document.title = `${displayName(person)} — ${familyTitle()}`;
      return;
    }
    case 'relation': {
      const { a, b } = route;
      view.replaceChildren(
        renderRelation(family, a, b, {
          change: async (which) => {
            const keep = which === 'a' ? b : a;
            const other = await pickPerson(family, { title: t().pickOther(shortName(keep)), caption, extra: relationWords });
            if (other) navigate(which === 'a' ? relationRoute(other, b) : relationRoute(a, other));
          },
        }),
      );
      document.title = `${shortName(a)} & ${shortName(b)} — ${familyTitle()}`;
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
      dismissWarnings();
      showPage(
        renderMissing(
          gaps(family, (p) => !!photoUrl(p), today()),
          family.graph.warnings,
          duplicates(family),
          source.editable ? (a, b) => confirmMerge(a, b, editorContext()) : undefined,
        ),
        t().missing,
      );
      return;
    case 'file':
      showPage(
        renderSource(source.markdown, source.editable ? () => void save([{ kind: 'tidy' }], t().msg.tidied) : undefined),
        'family.md',
      );
      return;
    case 'tree':
      if (family.people().length === 0) {
        view.replaceChildren(renderEmpty());
        document.title = familyTitle();
        // A family that does not exist yet starts with its first person.
        if (source.editable && !offeredStart && !document.querySelector('dialog[open]')) {
          offeredStart = true;
          startFamily();
        }
        return;
      }
      showTree(tree, undefined, undefined, viewer());
      tree.emphasize(undefined);
      document.title = familyTitle();
      return;
    case 'path': {
      const { a, b } = route;
      const whole = wholeTree();
      showTree(whole, `${shortName(a)} ↔ ${shortName(b)}`, relationRoute(a, b));
      whole.emphasize(family.path(a.id, b.id));
      document.title = `${shortName(a)} ↔ ${shortName(b)} — ${familyTitle()}`;
      return;
    }
    case 'up':
    case 'down': {
      const { person } = route;
      const label = route.kind === 'up' ? t().ancestorsOf(shortName(person)) : t().descendantsOf(shortName(person));
      showTree(subtree(route.kind, person), label, `#/p/${encodeURIComponent(person.id)}`, person.id);
      document.title = `${label} — ${familyTitle()}`;
      return;
    }
  }
}

/** Whether the first person has been asked for once already — closing the sheet means "not now". */
let offeredStart = false;

function startFamily(): void {
  openNewPerson(editorContext(), showAdded);
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
  document.title = `${title} — ${familyTitle()}`;
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
  overview.element.querySelector('.scope-toggle')?.remove();
  if (overview === tree && viewer()) overview.element.append(scopeToggle());
  view.replaceChildren(overview.element);
  overview.markViewer(viewer());
  overview.activate(focus);
  showGestureHint(overview);
  shownTree = overview;
}

/** Bottom left of the overview: the whole family, or only one's own. */
function scopeToggle(): HTMLButtonElement {
  const on = scope === 'kin';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `scope-toggle btn btn-sm shadow-md ${on ? 'btn-primary' : 'bg-base-100'}`;
  button.setAttribute('aria-pressed', String(on));
  button.title = t().onlyMyFamilyHint;
  button.append(icon('family'), t().onlyMyFamily);
  button.addEventListener('click', () => {
    scope = on ? 'all' : 'kin';
    writeStored('stammbaum-scope', scope);
    tree = makeTree();
    render();
  });
  return button;
}

window.addEventListener('hashchange', render);
backButton.addEventListener('click', () => {
  navigate('#/');
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
  else navigate(`#/p/${encodeURIComponent(person.id)}`);
}

/**
 * The hits for what is typed, as a listbox the field points into: the focus
 * stays in the field, the arrow keys move the active hit, and a click or a tap
 * on a hit opens it — so the options hold no buttons of their own.
 */
function search(keep = false): void {
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
      const row = document.createElement('div');
      row.className = 'result flex w-full items-baseline justify-between gap-3';
      const name = document.createElement('span');
      name.textContent = displayName(person);
      const detail = document.createElement('small');
      detail.className = 'opacity-60 tabular-nums text-right';
      detail.textContent = [caption(person), lifespan(person)].filter(Boolean).join(' · ');
      row.append(name, detail);
      item.append(row);
      item.addEventListener('click', () => openPerson(person));
      return item;
    }),
  );
  results.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
  markActive(keep ? Math.min(active, hits.length - 1) : 0);
}

searchInput.addEventListener('input', () => search());

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

/** The viewer button shows whose eyes the captions are written for, or a blank person when nobody's. */
function paintViewerButton(): void {
  const me = viewer();
  const person = me ? family.person(me) : undefined;
  viewerButton.replaceChildren(person ? bubble(person) : icon('person'));
  const label = person ? `${t().iAm}: ${displayName(person)} — ${t().changeViewer}` : t().whoAreYou;
  viewerButton.title = label;
  viewerButton.setAttribute('aria-label', label);
}

function renderMenu(): void {
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
      openNewPerson(editorContext(), (id) => navigate(`#/p/${encodeURIComponent(id)}`)),
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
  // Only once the family has any to hide.
  const causes = family.people().some((person) => person.deathcause)
    ? [
        group(
          t().causes,
          segmented(
            (['show', 'hide'] as const).map((id) => ({ id, label: t().causesModes[id] })),
            showsCauses() ? 'show' : 'hide',
            (id) => {
              setShowsCauses(id === 'show');
              render();
              renderMenu();
            },
          ),
          hint(t().causesHint),
        ),
      ]
    : [];
  menuPanel.replaceChildren(
    group(t().more, more),
    group(
      t().language,
      segmented(
        LANGS.map(({ id, label }) => ({ id, label })),
        lang(),
        (id) => {
          setLang(id);
          // The tree's words — stand-ins' among them — are drawn in when it is built.
          tree = makeTree();
          subtrees.clear();
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
    ...causes,
    group(t().saveTree, save, hint(t().saveHint)),
  );
}

/** Downloads the tree on screen — or the whole family, from any other screen. */
async function saveTree(format: 'png' | 'svg'): Promise<void> {
  menu.open = false;
  const overview = shownTree ?? tree;
  const heading = shownTree ? document.title : familyTitle();
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
  // Screen readers hear it from the region that is always there, not from here.
  element.setAttribute('aria-hidden', 'true');
  element.textContent = text;
  document.body.append(element);
  setTimeout(() => element.remove(), kind === 'error' ? 6000 : 2500);
  announce(text);
}

/**
 * Says `text` through the live region in index.html. A region that is already
 * there is what screen readers listen to; one appearing with its words in it
 * often goes unread. Emptied first, so the same words twice are said twice.
 */
function announce(text: string): void {
  const region = document.querySelector('#announcer');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => (region.textContent = text), 50);
}

// ---- focus after a sheet ------------------------------------------------------

/** What last had the focus on the page, as a selector that finds it again once the page is drawn anew. */
let lastFocus: string | undefined;

view.addEventListener('focusin', (event) => {
  lastFocus = focusKey(event.target as Element);
});

/** The pen on a card, a bubble in the tree, a link — by what stays the same when they are drawn again. */
function focusKey(element: Element): string | undefined {
  const keyed = element.closest<HTMLElement | SVGElement>('[data-focus], .node[data-id], a[href]');
  if (!keyed) return undefined;
  const { focus, id } = keyed.dataset;
  if (focus) return `[data-focus="${CSS.escape(focus)}"]`;
  if (id) return `.node[data-id="${CSS.escape(id)}"]`;
  return `a[href="${CSS.escape(keyed.getAttribute('href') ?? '')}"]`;
}

// A closed sheet hands the focus back to what opened it. After a save that
// one was drawn anew, and the focus would fall to the page itself: it goes to
// the new one instead.
document.addEventListener(
  'close',
  () => {
    setTimeout(() => {
      if (document.querySelector('dialog[open]')) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      if (lastFocus) view.querySelector<HTMLElement | SVGElement>(lastFocus)?.focus();
    });
  },
  true,
);

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
    fail: (text) => toast(text),
  };
}

async function upload(image: Blob, name: string): Promise<string | undefined> {
  toast(t().uploading, 'info');
  try {
    const saved = await uploadPhoto(image, name);
    // The small version for the bubbles goes along; without it they show the big one.
    const thumb = await makeThumb(image);
    if (thumb) await uploadThumb(saved, thumb).catch((error: unknown) => console.error(error));
    return saved;
  } catch (error) {
    console.error(error);
    // A kind of picture the server does not take says so; anything else is a failed upload.
    toast(error instanceof UnsupportedImage ? t().unreadable(image instanceof File ? image.name : '') : t().uploadError);
    return undefined;
  }
}

/**
 * Sends edits to the server and shows the family as it is afterwards. When
 * someone else got there first, their version is shown instead and nothing of
 * this edit is lost silently — it just has to be made again.
 */
async function save(edits: Edit[], message: string): Promise<Record<string, string> | undefined> {
  // Whatever a check for changes brings back from before this save is older than its result.
  generation++;
  try {
    const saved = await saveEdits(edits, message);
    followRenames(saved.renamed);
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

/** Someone's id changed: the page on screen and who is looking follow, so nothing points at the old one. */
function followRenames(renamed: Record<string, string>): void {
  if (Object.keys(renamed).length === 0) return;
  const parts = location.hash.split('/').map((part) => {
    try {
      const now = renamed[decodeURIComponent(part)];
      return now ? encodeURIComponent(now) : part;
    } catch {
      return part;
    }
  });
  const before = location.hash;
  // The state stays: it may be an open sheet's.
  history.replaceState(history.state, '', parts.join('/') || '#/');
  // Still the same page, under its new name.
  if (rendered === before) rendered = location.hash;
  const me = readStored('stammbaum-me');
  if (me && renamed[me]) writeStored('stammbaum-me', renamed[me]);
}

/** Goes up with every save and every new version on screen, so a late answer can tell it is late. */
let generation = 0;

/** Puts a new version of the family on screen, wherever one was looking. */
function useSource(next: FamilySource): void {
  generation++;
  source = next;
  family = new Family(readFamily(next));
  const before = tree;
  tree = makeTree();
  // The same family a moment later: stay where one was looking.
  tree.keepViewOf(before);
  subtrees.clear();
  refresh();
}

// Someone else may have saved while this tab was in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const asked = generation;
  fetchChanges()
    .then((next) => {
      // A save in the meantime put a newer family on screen than this answer may be.
      if (generation !== asked) return;
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
  showWarnings();
  tree.localize();
  for (const overview of subtrees.values()) overview.localize();
  render();
  if (menu.open) renderMenu();
}

/** The words that live in index.html and the app bar rather than in a view. */
function localize(): void {
  document.documentElement.lang = lang();
  title.textContent = familyTitle();
  document.querySelector('meta[name="description"]')?.setAttribute('content', t().description);
  searchInput.placeholder = t().searchPlaceholder;
  searchInput.setAttribute('aria-label', t().search);
  paintViewerButton();
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

/** The warnings last closed, so the same ones do not come back with every save. */
let dismissedWarnings: string | undefined;

function warningsKey(): string {
  return family.graph.warnings.map((warning) => `${warning.line}|${warning.message}`).join('\n');
}

/**
 * The file's warnings, for whoever can do something about them: a note at the
 * bottom of the screen, built again whenever the family or the language
 * changes. Closed, it stays closed until the warnings change.
 */
function showWarnings(): void {
  document.querySelector('.warnings')?.remove();
  const { warnings } = family.graph;
  if (!source.editable || warnings.length === 0 || warningsKey() === dismissedWarnings) return;
  const banner = document.createElement('section');
  banner.className = 'warnings alert alert-warning shadow-lg flex-col items-start gap-1';
  banner.setAttribute('aria-labelledby', 'warnings-heading');
  const heading = document.createElement('strong');
  heading.id = 'warnings-heading';
  heading.textContent = t().warnings(warnings.length);
  const close = iconButton('close', t().closeWarnings);
  close.classList.add('btn-sm', 'warnings-close');
  close.addEventListener('click', dismissWarnings);
  const list = document.createElement('ul');
  const shown = 8;
  for (const warning of warnings.slice(0, shown)) {
    const item = document.createElement('li');
    item.textContent = warningText(warning);
    list.append(item);
  }
  const rest = warnings.length - shown;
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
  banner.append(heading, close, list, more);
  document.body.append(banner);
}

function dismissWarnings(): void {
  dismissedWarnings = warningsKey();
  document.querySelector('.warnings')?.remove();
}

localize();
showWarnings();
welcome();
render();

/**
 * Photos from before there were small versions — or put into photos/ by
 * hand — get theirs from the first editor who comes by, one at a time and
 * in the background. The bubbles use them from the next visit on.
 */
async function fillThumbs(): Promise<void> {
  if (!source.editable || sparingData()) return;
  for (const name of photosWithoutThumb()) {
    const url = source.photos.get(name);
    if (!url) continue;
    try {
      const thumb = await makeThumb(await (await fetch(url)).blob());
      if (thumb) await uploadThumb(name, thumb);
    } catch (error) {
      console.error(error);
    }
  }
}
setTimeout(() => void fillThumbs(), 4000);

/**
 * Whether the phone asked to save data, or is on mobile data: every full-size
 * photo is a lot to download for that. Only some browsers say either.
 */
function sparingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  return connection?.saveData === true || connection?.type === 'cellular';
}

/** The family, asked for until it comes: a failed load says so and offers to try again. */
async function firstSource(): Promise<FamilySource> {
  const page = must<HTMLElement>('#view');
  for (;;) {
    const waiting = document.createElement('p');
    waiting.className = 'load-state';
    waiting.setAttribute('role', 'status');
    waiting.append(spinner(), t().loading);
    // Only once it takes a moment: a quick answer should not flash past.
    const slow = setTimeout(() => page.replaceChildren(waiting), 400);
    try {
      const loaded = await loadSource();
      clearTimeout(slow);
      page.replaceChildren();
      return loaded;
    } catch (error) {
      clearTimeout(slow);
      console.error(error);
      await new Promise<void>((retry) => {
        const failed = document.createElement('div');
        failed.className = 'load-state';
        failed.setAttribute('role', 'alert');
        const text = document.createElement('p');
        text.textContent = t().loadFailed;
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn btn-primary btn-sm';
        again.textContent = t().retry;
        again.addEventListener('click', () => retry());
        failed.append(text, again);
        page.replaceChildren(failed);
        again.focus();
      });
    }
  }
}

function spinner(): HTMLElement {
  const element = document.createElement('span');
  element.className = 'loading loading-spinner loading-sm';
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
