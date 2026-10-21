# Stammbaum

A pocket "who is who" for family gatherings. Built mobile first — the phone in
your pocket at the party is the primary target, the desktop layout is the
enhancement. Three screens, one markdown file:

- **Übersicht** — the whole tree as a map you drag, pinch and flick around; or
  just one person's ancestors (`#/up/<id>`) or descendants (`#/down/<id>`).
- **Person** — one person with their first-degree relatives only: parents on
  top, partners beside (below, on a phone), children underneath. The card
  says how old they are (or became), where they were born and live, what they
  do, and has their photos.
- **Verwandtschaft** — how any two people are related (`#/r/<a>/<b>`): the word
  for it in both directions, and the chain of parents, children and partners
  between them, which the tree can then highlight (`#/path/<a>/<b>`).
- **Geburtstage & Jahrestage** — the birthdays and anniversaries of the next
  30 days (`#/dates`), to check before walking in.
- **Familie in Zahlen** — how many, how many generations, the oldest and the
  youngest, the longest marriage, the most common surname (`#/stats`).
- **Was fehlt noch?** — a checklist for whoever keeps the file (`#/missing`):
  the file's warnings, and everyone without a date of birth, a `sex=`, a photo,
  or a link to the rest of the family, each with the line to edit. Something
  to ask about at the next gathering.

On the hosted version, the menu shows the page on screen as a **QR code**: the
person you are talking to scans it and has the same relationship, tree or
person on their own phone. The encoder is part of the app — no library, no
network — and the single file mailed around leaves the entry out, since a
`file://` address leads nowhere on another phone.

Everyone is captioned with what they are to whoever is looking — *Tante*,
*Cousine 2. Grades* — and search finds people by name, place, job, year of
birth or by that relation ("tante", "cousin"); "mueller" and "strasse" find
*Müller* and *Straße*. The app speaks German and English; the menu switches
between them. The menu also saves the tree on screen as a PNG or SVG, with the
family's name on top and always in light colours — for a poster, or to send
around.

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
| Right-click, or press and hold | A menu for what is under it — see below |
| Mouse wheel, trackpad pinch | Zoom at the cursor |
| Arrow keys, `+` / `-`, Enter, menu key | The same, from the keyboard |

The tree is clamped so it can never be flung off screen, and the button in the
bottom corner zooms out to the whole family. A tree too wide for the screen
opens on whoever is looking; an ancestor or descendant tree on its person.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173 — editing works here too
npm test             # parser, writer, server, graph and layout tests
npm run build        # dist/ and dist-server/ — the app and its small server
npm start            # serves dist/ with the family from ./data (DATA_DIR=…)
npm run build:single # dist-single/index.html — ONE self-contained file, works offline
```

To host it, `docker compose up -d --build` builds the app and runs its server
on `127.0.0.1:8080` (`PORT=…` to change it). The family is not part of the
image: the container mounts `./data` and reads `family.md` and the photos from
there live, so an edit — in the app or by hand — shows without a rebuild. That
folder holds the whole family, so keep the server private: the port is only
reachable from the host itself, and a reverse proxy there adds the login —
[`deploy/`](deploy/) has an example for nginx with
[Authelia](https://www.authelia.com) in front, which also tells the server who
is logged in.

| Setting | |
| --- | --- |
| `FAMILY_DIR=./sample` | Mount another folder than `./data` |
| `STAMMBAUM_EDITORS=jonas,oma` | Only these logins may edit; everyone else reads. Empty: everyone who can log in |
| `STAMMBAUM_READONLY=1` | Nobody may edit |
| `STAMMBAUM_PROXY_SECRET` | A long random value the proxy sends along as `X-Stammbaum-Proxy` (see [`deploy/`](deploy/)). Once set, the server answers nobody else — not even another program on the host |
| `STAMMBAUM_UID`, `STAMMBAUM_GID` | Whose files the server writes (1000:1000) — make them yours, so `data/` stays yours to edit and back up |

## Editing in the app

Behind the login, every card has a pen in its corner: the person's details as a form
— dates as day, month and year, where the year alone is enough — then their
parents, partners and children, each with what can be done about them, and
**+ Elternteil**, **+ Partner/in**, **+ Kind**, **+ Geschwister** to add someone
new or someone already in the tree. The menu adds people connected to nobody yet. A
partnership is edited from its row: married or together, since when, and
whether and when it ended.

The tree itself is quicker. A right-click — a long press on a phone — opens a
menu for what is under it:

| On | |
| --- | --- |
| A person | Open, edit, **Hinzufügen ▸** a parent, partner, child, sibling or photo, delete |
| A line between people | Edit that partnership, add a child to the couple, unlink one of their children |
| Empty space | Add someone new, show the whole tree |

A family file that is still empty starts with the first person.

Relatives find their place: a second parent takes the brothers and sisters
along, a new partner can become the other parent of someone's children, and a
child of a couple is no longer also listed under one of them alone. Siblings
share parents — when there are none yet, a stand-in *Mutter von …* and *Vater
von …* come along, drawn as a dashed "?" and named from whoever is looking
(*Urgroßmutter · unbekannt*) until someone knows who they were.

**Photos** come from the phone or computer: on the edit sheet, or from the menu
on a person. The browser turns each one upright and shrinks it to 1600 pixels
across — which also drops what the camera wrote into it, such as where it was
taken — and the server keeps it in `photos/` as `klaus.jpg`, `klaus-2.jpg`.
The first becomes the portrait, the rest the gallery; the sheet can make
another one the portrait, choose the circle the bubble shows, or take one out
again (the file stays in `photos/`). Each photo also gets a small version for
the bubbles, made by the browser — `photos/.thumbs/` — so a tree with hundreds
of photos stays quick; photos from before, or put in by hand, get theirs the
next time someone who may edit opens the app.
SVG is not taken, since it could carry script. Uploads are logged in
`changes.log` like edits; the proxy in front has to let bodies of a few
megabytes through (`client_max_body_size` in [`deploy/`](deploy/)).

The menu's **Die Datei family.md** shows the file as it is, line by line, to
download or copy — and **Datei ordnen** puts it in order: a section per
generation, each household together (the couple, then the line about them),
person lines aligned, a bare `married=?` dropped since `a + b` says the same,
and ids the app made in an earlier form given today's. Nothing is lost —
comments go along with the line below them, prose around the block stays — and
a file in order stays in order: every save after that puts new lines where they
belong. A file kept in an order of its own is left alone.

**Was fehlt noch?** also lists people who look entered twice — the same name,
or a birth name, and no different sex or year of birth — and makes two such
entries one: the details joined, every link moved over.

Every change is written straight into `family.md`, and only where it belongs:
one word in a person's line, one name added to a `->` list, a new `person` line
next to the relatives it belongs with. Comments, prose, order and alignment
stay as they were, so the file reads as if written by hand — and can still be
edited by hand.

Before each save the server puts the previous `family.md` into
`data/history/`, named by the time — the newest 1000 are kept — and adds a line to
`data/history/changes.log` saying who changed what:

```
2026-10-14T11:40:31.535Z	jonas	Lea Bauer als Kind von Jonas & Sara eingetragen
```

To undo anything, copy an earlier file from `history/` back over `family.md`.
Backing up `data/` backs up its history with it.

When two relatives edit at once, both changes land as long as they are about
different things. If both change the same field, the second one is told that
someone was quicker, sees the new version and can make the change again —
nothing is overwritten unseen. An app left open picks up other people's changes
when it comes back to the foreground.

`npm run dev` edits `data/` the same way, as the user `local`. The made-up
sample ships with this repository, so it stays read-only there unless
`STAMMBAUM_EDIT=1` says otherwise.

## Keeping the family private

This repository is public, so it only carries the made-up Bauer family in
`sample/`. Your own family goes into `data/` — a folder this repository
ignores, and the only place the family lives:

```sh
mkdir -p data/photos && cp sample/family.md data/
```

`npm run dev` and the single-file build use `data/` whenever `data/family.md`
exists and fall back to `sample/` otherwise. `FAMILY_DIR=<folder>` points them
anywhere else — `FAMILY_DIR=sample npm run dev` shows the sample even with your
family in place. The tests always run against the sample.

The hosted app's files carry no family at all; it arrives from the server once
someone has logged in. The single file is different: `build:single` inlines the
family, the script, the styles and every photo as `data:` URIs into one HTML
file you can mail to relatives or open from a USB stick with no server and no
network — which is usually what a family gathering in a house with bad
reception actually needs. It is a read-only snapshot of the day it was built:
mail it around, but never publish it.

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
| `me <id>` | Optional: whose point of view relations are named from until someone says who they are. |
| `%% …` | Comment. |

**Person keys** — `born`, `died`, `photo`, `maiden`, `nick`, `note`, `sex`,
`birthplace`, `deathplace`, `job`, `lives`, `photos`, `birthcountry`,
`deathcountry`, `country`, `nationality`, `deathcause`.
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
  as that kind of partnership, just without a year next to it. The same goes
  for people: `died=?` marks someone as dead without a date (*1931 – †*).
- Dates are free text, but `1956`, `1956-04` and `1956-04-02` are formatted
  nicely (`* 2. April 1956`); anything else is printed as written.
- Ids are the deep-link handles — `#/p/klaus-bauer` opens Klaus directly. The
  app makes them from the whole name, with the year of birth when two share
  it, then a number: `klaus-bauer`, `klaus-bauer-1958`, `klaus-bauer-2`.
  Cyrillic and Greek names are spelled in Latin letters (*Анна Иванова* is
  `anna-ivanova`). `person` and `me` are words of the file, never ids, and no
  id starts with `#`.
- `nick` wins over the first name in bubbles: the tree says *Oma*, the card
  says *Elisabeth (Oma) Bauer*.
- Every person in the detail view is captioned with what they are to whoever
  is looking — see [Who is looking](#who-is-looking): *Tante*, *Cousine 2.
  Grades*, *Schwager*, *Mann der Cousine*, or in English *Aunt*, *Second
  cousin*, *Cousin's husband*. `sex=m` or `sex=f` (`w` works too) picks the
  gendered word; without it the caption names both (*Onkel/Tante*).
  Step-siblings (*Stiefbruder*) and the *Schwippschwager* — a partner's
  sibling's partner, or a sibling's partner's sibling — have their words too.
  Anyone further out gets no caption — the relationship screen still shows how
  they are connected.
- With a full `born` date the card shows the age — *37 Jahre*, or *wurde 80
  Jahre alt* with a `died` date too — and a note on the birthday itself. With
  only a year it says *etwa*. A lasting partnership says how long it has
  lasted: *seit 2001 · 25 J.*
- `birthplace`, `deathplace`, `job` and `lives` are free text and shown as
  written: `* 2. April 1931 in Lindau`, *Wohnt in Lissabon*. Quote anything
  with spaces: `deathplace="Bad Wörishofen"`. Inside quotes, `\"` is a quote
  and `\\` a backslash: `note="Sagte immer \"Moin\""`.
- `birthcountry`, `deathcountry` and `country` (where someone lives) go with
  those places, and `nationality` lists one or more: `birthplace=Lindau
  birthcountry=DE`, `lives=Lissabon country=PT nationality="DE, PT"`. They are
  the two-letter ISO codes, shown by name in the app's language — *Deutschland*
  or *Germany* — and found by search in either. The app writes them that way
  from whatever is typed ("Norwegen", "Norway", "no"); a country that no
  longer is one, such as `birthcountry=DDR`, stays as written. The numbers
  page lists the countries the family was born in and lives in today.
- `deathcause` says what someone died of: `deathcause=Herzinfarkt`. It is
  shown on their card only, never on the tree, in search, in the numbers or
  among what is missing. Once anyone in the file has one, the settings can
  hide them on that device — on the tablet the children use, say — and the
  editor then leaves the field out and keeps what was there.
- A person whose id the app made from their name — `klaus-bauer` for *Klaus Bauer* —
  gets a new one when renamed in the app: a stand-in *Mutter von Felix* named
  *Birgit Dahle* becomes `birgit-dahle` everywhere in the file. Ids written by hand
  stay as they are.
- `adopted=<child>, …` lists children of a partnership who were adopted. They
  count as children everywhere — no `->` needed — and their card says so. A
  child may also appear in two partnerships, birth parents and adoptive ones.
  A single adoptive parent works the same way: `petra adopted=marie`.
  Attributes may come before or after the `->` children.
- Statements about one partnership may be split across lines and written in
  either partner order; they merge. The exception is a couple who divorced and
  then married each other again: a new `married=` (or `together=`) after the
  end starts a second partnership, as with any remarriage.
- Photos are file names inside the `photos/` folder next to `family.md`, in any
  case (`IMG_1234.JPG` is found as `img_1234.jpg`). Anyone
  without a photo gets an initials bubble in a colour derived from their id.
  `photos=a.jpg, b.jpg` adds more pictures; the card shows them as a gallery,
  and tapping the portrait opens them full screen, where a pinch, a double tap
  or the mouse wheel zooms in.
- Undeclared ids still render, and the app shows a dismissible list of hints
  about the file — a half-finished tree never breaks the page. The hints also
  catch what parses but cannot be true: a person declared twice, a missing
  photo, a child born before its parent, a death before the birth, someone who
  ends up their own ancestor.

## Who is looking

The captions are written for one person, the viewer: whoever was chosen with
the bubble next to search — remembered on that phone — or else the file's
`me` line. That bubble is the one place to change it. A first visit asks
**Wer bist du?** rather than quietly captioning everything for the file's
`me` — which matters for the single file mailed around, where everyone would
otherwise read the author's captions as their own. "Niemand davon" turns the
captions off on that phone.

At the bottom of the tree, **Nur meine Familie** leaves out everyone who is
not related to the viewer by blood or married to someone who is: one's
cousins stay, a partner's family goes.

So `me` is a default, not the shape of the file: the file itself describes the
family from nobody's point of view, and works just as well without a `me`
line.

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
about 157 kB of JavaScript and 140 kB of CSS, both tree-shaken to what the app
actually uses. Icons are inline SVG, so there is no icon font either. The
server is about 70 kB of Node with nothing but its standard library, and shares
the parser and the writer with the app.

The overview is one SVG with a transform for pan and zoom, driven by Pointer
Events so mouse, trackpad, pen and touch all take the same code path. The person
view is HTML with connectors drawn into an SVG overlay after layout, so it
reflows correctly from a 390 px phone up. daisyUI supplies the chrome — navbar,
buttons, card, badges, menu — while the tree and the person view keep their own
component classes, because utility strings inside generated SVG would be
unreadable.

```
data/                   your family and its history/ — ignored here
sample/family.md        the made-up sample family, and the format in prose
sample/photos/          its placeholder portraits
src/parser/             markdown → { people, unions, warnings }, and back: write.ts
src/source/             where the family comes from: the server, or built in
src/edit/               the editor: forms, and what they turn into
server/                 the app's server: api/family, api/edits, api/photos, photos/, history
src/family.ts           derived lookups: parents, broods, search, subtrees, paths
src/calendar.ts         upcoming birthdays and anniversaries
src/stats.ts            the family in numbers
src/missing.ts          what the file does not know yet
src/kinship.ts          what one person is to another, in German and English
src/i18n.ts             the app's own words, German and English
src/layout/layout.ts    generations, tidy horizontal placement, refinement sweep
src/ui/icons.ts         inline stroked SVG icons
src/ui/picker.ts        the searchable "who?" sheet
src/ui/sheet.ts         every other sheet
src/ui/lightbox.ts      photos full screen, with pinch zoom
src/ui/qr.ts            a QR code encoder of its own
src/ui/share.ts         the "share this page" QR sheet
src/views/overview.ts   the gesture-driven SVG tree
src/views/person.ts     one person and their first-degree relatives
src/views/relation.ts   how two people are related, and the path between them
src/views/dates.ts      the birthdays and anniversaries coming up
src/views/stats.ts      the numbers as tiles
src/views/missing.ts    the checklist for whoever keeps the file
src/styles/app.css      Tailwind + daisyUI setup and every component rule
tests/                  parser, writer, server, family, kinship, age, calendar, stats, gaps, QR and layout (vitest)
```

The layout is a two-stage tidy tree: a recursive walk places each couple above
the middle of its children, then a relaxation sweep pulls couples towards their
children and children towards their parents without ever reordering a row. Two
families that marry into each other end up next to each other instead of at
opposite ends of the page.
