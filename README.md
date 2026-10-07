# Stammbaum

A pocket "who is who" for family gatherings. Built mobile first — the phone in
your pocket at the party is the primary target, the desktop layout is the
enhancement. Two screens, one markdown file:

- **Übersicht** — the whole tree as a map you drag, pinch and flick around.
- **Person** — one person with their first-degree relatives only: parents on
  top, partners beside (below, on a phone), children underneath.

The family lives in `data/family.md`, written in a mermaid-flavoured DSL, so the
tree is edited like text and reviewed like code. That folder is private and
never part of this repository — see [Keeping the family
private](#keeping-the-family-private); a made-up family in
[`sample/`](sample/family.md) stands in until it exists.

Built with [Claude Code](https://claude.com/claude-code). 

## Gestures

The overview has no zoom buttons; it is driven by gestures, the same ones a map
app uses.

| Gesture | |
| --- | --- |
| Drag / flick | Pan, with momentum afterwards |
| Two-finger pinch | Zoom, around the point between your fingers |
| Double-tap | Zoom in at that point; again when zoomed in, back out |
| Tap a bubble | Open that person |
| Mouse wheel, trackpad pinch | Zoom at the cursor |
| Arrow keys, `+` / `-`, Enter | The same, from the keyboard |

The tree is clamped so it can never be flung off screen, and the button in the
bottom corner zooms out to the whole family.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # parser, graph and layout tests
npm run build        # dist/ — a normal static site
npm run build:single # dist/index.html — ONE self-contained file, works offline
```

To host it, `docker compose up -d --build` runs `build:single` in a Node build
stage and serves the resulting `index.html` from nginx on `127.0.0.1:8080`
(`PORT=…` to change it); run it again after editing the family. A build from
`data/` puts the whole family online, so keep that server private: the port is
only reachable from the host itself, and a reverse proxy there adds the login —
[`deploy/`](deploy/) has an example for nginx with
[Authelia](https://www.authelia.com) in front.

## Keeping the family private

This repository is public, so it only carries the made-up Bauer family in
`sample/`. Your own family goes into `data/` — ignored here, and a git
repository of its own:

```sh
mkdir -p data/photos && cp sample/family.md data/
cd data && git init && git add . && git commit -m "Our family"
# optional, a private remote:
git remote add origin git@github.com:<you>/<family>.git && git push -u origin main
```

`npm run dev` and both builds use `data/` whenever `data/family.md` exists and
fall back to `sample/` otherwise. `FAMILY_DIR=<folder>` points them anywhere
else — `FAMILY_DIR=sample npm run dev` shows the sample even with your family in
place. The tests always run against the sample.

A build made from `data/` contains every name and photo: mail the file around,
but never publish `dist/`.

`build:single` inlines the script, the styles and every photo as `data:` URIs.
The result is a single HTML file you can mail to relatives or open from a USB
stick with no server and no network — which is usually what a family gathering
in a house with bad reception actually needs.

## Writing the family file

Everything the app shows comes from the ```` ```family ```` block(s) in
`data/family.md` — or [`sample/family.md`](sample/family.md) until you have one.
Prose outside those blocks is ignored, so document the family in the same file.

```family
person heinrich  "Heinrich Bauer"  born=1931-04-02 died=2011-08-17 photo=heinrich.jpg
person elisabeth "Elisabeth Bauer" born=1934-11-23 maiden=Vogt nick=Oma

heinrich + elisabeth married=1956-05-19 -> klaus, brigitte

%% Divorced, then married again: two partnerships, one line each.
klaus + sabine married=1984 divorced=1996 -> nina, jonas
klaus + carmen married=2001 -> luca

%% Not married, just a couple — and one that ended without a divorce.
brigitte + tobias together=2015 -> emil
nina + david together=2012 separated=2018
```

| Statement | Meaning |
| --- | --- |
| `person <id> "<Name>" key=value …` | Declares a person. |
| `<a> + <b> key=value …` | A partnership. |
| `<a> + <b> -> <child>, <child>` | Children of that partnership. |
| `<a> -> <child>` | Children whose second parent is unknown. |
| `me <id>` | Whose point of view relations are named from, by default. |
| `%% …` | Comment. |

**Person keys** — `born`, `died`, `photo`, `maiden`, `nick`, `note`, `sex`,
`birthplace`, `deathplace`, `job`, `lives`, `photos`, `login`.
**Partnership keys** — `married`, `divorced`, `together`, `separated`,
`children`, `adopted`.

Notes:

- A partnership has a start — `married` or `together` — and an optional end —
  `divorced` or `separated`. That gives four states: *verheiratet*, *zusammen*,
  *geschieden*, *getrennt*. A bare `a + b` with no keys counts as a marriage.
  In the tree a marriage carries the two rings its children hang from, an
  unmarried couple gets the plain line, and a partnership that ended is dotted.
- Use `together` for a couple who are not married.
- A date you do not know or do not care to publish can be written as `?` or
  `true` — `a + b together=?`, `a + b divorced=true`. The partnership is drawn
  as that kind of partnership, just without a year next to it.
- Dates are free text, but `1956`, `1956-04` and `1956-04-02` are formatted
  nicely (`* 2. April 1956`); anything else is printed as written.
- Ids are the deep-link handles — `#/p/klaus` opens Klaus directly — so keep
  them short, lowercase and stable.
- `nick` wins over the first name in bubbles: the tree says *Oma*, the detail
  view says *Elisabeth Bauer*.
- Every person in the detail view is captioned with what they are to whoever
  is looking — see [Who is looking](#who-is-looking): *Tante*, *Cousine 2.
  Grades*, *Schwager*, *Mann der Cousine*, or in English *Aunt*, *Second
  cousin*, *Cousin's husband*. `sex=m` or `sex=f` (`w` works too) picks the
  gendered word; without it the caption names both (*Onkel/Tante*). People who
  are neither blood relatives nor one partnership away from one get no caption.
- With a full `born` date the card shows the age — *37 Jahre*, or *wurde 80
  Jahre alt* with a `died` date too — and a note on the birthday itself. With
  only a year it says *etwa*. A lasting partnership says how long it has
  lasted: *seit 2001 · 25 J.*
- `birthplace`, `deathplace`, `job` and `lives` are free text and shown as
  written: `* 2. April 1931 in Lindau`, *Wohnt in Lissabon*. Quote anything
  with spaces: `deathplace="Bad Wörishofen"`.
- `adopted=<child>, …` lists children of a partnership who were adopted. They
  count as children everywhere — no `->` needed — and their card says so. A
  child may also appear in two partnerships, birth parents and adoptive ones.
  Attributes may come before or after the `->` children.
- Statements about one partnership may be split across lines and written in
  either partner order; they merge.
- Photos are file names inside the `photos/` folder next to `family.md`. Anyone
  without a photo gets an initials bubble in a colour derived from their id.
  `photos=a.jpg, b.jpg` adds more pictures; the card shows them as a gallery,
  and tapping the portrait opens them full screen.
- `login` is the person's user name at the login in front of the app — see
  [Who is looking](#who-is-looking).
- Undeclared ids still render, and the app shows a dismissible list of hints
  about the file — a half-finished tree never breaks the page.

## Who is looking

The captions are written for one person, the viewer. The app picks them in
this order:

1. Whoever tapped **Das bin ich** on their card, or chose themselves under
   **Ich bin** in the menu — remembered on that phone.
2. The person whose `login=` matches who logged in, when the app runs behind
   a login such as Authelia. A static page never sees request headers, so the
   reverse proxy passes the user name on as a `stammbaum_login` cookie — see
   [`deploy/nginx-stammbaum.conf`](deploy/nginx-stammbaum.conf).
3. The file's `me` line.

"Niemand davon" in the picker turns the captions off on that phone.

## Language

The menu switches between **Deutsch** and **English**; the first visit follows
the browser's language. Everything the app says is translated, the relation
words included. What the family file says — names, notes, places, jobs — is
shown as written.

## Appearance

The menu switches between **Automatisch**, **Hell** and **Dunkel**, and the
choice is remembered. "Automatisch" follows the phone's own light/dark setting and
switches with it; the two explicit modes override it. The phone's status bar
colour follows along.

The switching is daisyUI's, not hand-rolled:

```css
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

`--prefersdark` is what makes the dark theme apply on its own under
`prefers-color-scheme: dark`; setting `data-theme="light"` or `"dark"` on
`<html>` overrides it. Adding another daisyUI theme — or a custom one — is a
matter of putting its name in that list.

Everything in [`src/styles/app.css`](src/styles/app.css) is written against
daisyUI's semantic variables (`--color-base-100…300`, `--color-base-content`,
`--color-primary`, `--color-error`, `--radius-*`), so both themes are handled by
the same rules and nothing carries a hardcoded colour. The per-person avatar
tint is mixed into the current surface rather than picked per theme:

```css
fill: color-mix(in oklab, hsl(var(--avatar-h) 70% 55%) 26%, var(--color-base-100));
```

which is why the bubbles are pale in light mode and deep in dark mode without a
second palette existing anywhere.

## How it is built

Vite + TypeScript with Tailwind CSS 4 and daisyUI 5 for the styling and the
theme system; no UI framework and no runtime JavaScript dependencies. Tailwind
and daisyUI are build-time only, so the offline file still fetches nothing —
about 36 kB of JavaScript and 62 kB of CSS, both tree-shaken to what the app
actually uses. Icons are inline SVG, so there is no icon font either.

The overview is one SVG with a transform for pan and zoom, driven by Pointer
Events so mouse, trackpad, pen and touch all take the same code path. The person
view is HTML with connectors drawn into an SVG overlay after layout, so it
reflows correctly from a 390 px phone up. daisyUI supplies the chrome — navbar,
buttons, card, badges, menu — while the tree and the person view keep their own
component classes, because utility strings inside generated SVG would be
unreadable.

```
data/                   your family — ignored here, a private repo of its own
sample/family.md        the made-up sample family, and the format in prose
sample/photos/          its placeholder portraits
src/parser/             markdown → { people, unions, warnings }
src/family.ts           derived lookups: parents, partnerships, broods, search
src/layout/layout.ts    generations, tidy horizontal placement, refinement sweep
src/ui/icons.ts         inline stroked SVG icons
src/views/overview.ts   the gesture-driven SVG tree
src/views/person.ts     one person and their first-degree relatives
src/styles/app.css      Tailwind + daisyUI setup and every component rule
tests/                  parser, family and layout tests (vitest)
```

The layout is a two-stage tidy tree: a recursive walk places each couple above
the middle of its children, then a relaxation sweep pulls couples towards their
children and children towards their parents without ever reordering a row. Two
families that marry into each other end up next to each other instead of at
opposite ends of the page.
