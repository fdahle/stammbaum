import { photoByName } from '../data';
import type { Family } from '../family';
import { t } from '../i18n';
import { isDeceased, knownDate, unionEnd, unionStart, unionStatus, type Person, type Union } from '../parser/types';
import { PERSON_FIELDS, personValue, type Changes, type Edit, type PersonField, type UnionField } from '../parser/write';
import { shortName, year } from '../ui/format';
import { pickPerson } from '../ui/picker';
import { button, openSheet, sheetActions, type Sheet } from '../ui/sheet';
import { checkField, choiceField, countryField, dateField, INVALID, pair, textField, type Field } from './fields';
import { cropImage } from './crop';
import { photoChanges, photoNames, pickImages, shrink } from './photos';

export interface EditorContext {
  /** The family as it is now — after a save, already the new one. */
  readonly family: Family;
  /** Saves and shows the result; resolves to the ids new people got, or `undefined` when it failed. */
  save(edits: Edit[], message: string): Promise<Record<string, string> | undefined>;
  /** Puts a picture into photos/ under a name built from `name`; resolves to the file name, or `undefined` when it failed. */
  upload(image: Blob, name: string): Promise<string | undefined>;
  caption(person: Person): string | undefined;
}

/** What the person form asks for; the pictures have their own section. */
const FORM_FIELDS = PERSON_FIELDS.filter((key) => key !== 'photo' && key !== 'photos');

// ---- the person form --------------------------------------------------------

interface PersonForm {
  element: HTMLElement;
  /** Every field as it would be written, or a message saying what is wrong. */
  read(): Record<PersonField, string | null> | string;
}

/**
 * Everything family.md knows about a person, as a form. `short` asks only for
 * what one needs when adding someone in passing: name, sex, birth.
 */
function personForm(person: Person | undefined, short = false): PersonForm {
  const element = document.createElement('div');
  element.className = 'form';
  const fields = t().fields;

  const name = textField(fields.name, person?.name);
  const sex = choiceField(
    fields.sex,
    [
      { value: 'f', label: t().sexes.f },
      { value: 'm', label: t().sexes.m },
      { value: '', label: t().sexes.unknown },
    ],
    person?.sex ?? '',
  );
  const born = dateField(fields.born, person?.born);
  element.append(name.element, sex.element, born.element);

  const rest: Partial<Record<PersonField, Field<string | null>>> = {};
  let deceased: ReturnType<typeof checkField> | undefined;
  let died: Field<string | null | typeof INVALID> | undefined;
  if (!short) {
    // Every place with its country beside it.
    rest.birthplace = textField(fields.birthplace, person?.birthplace);
    rest.birthcountry = countryField(fields.country, person?.birthcountry);
    rest.nick = textField(fields.nick, person?.nick);
    rest.maiden = textField(fields.maiden, person?.maiden);
    deceased = checkField(fields.deceased, !!person && isDeceased(person));
    died = dateField(fields.died, person?.died);
    rest.deathplace = textField(fields.deathplace, person?.deathplace);
    rest.deathcountry = countryField(fields.country, person?.deathcountry);
    const death = document.createElement('div');
    death.className = 'form-group';
    death.append(died.element, pair(rest.deathplace, rest.deathcountry));
    death.hidden = !deceased.value();
    deceased.onChange((on) => (death.hidden = !on));
    rest.job = textField(fields.job, person?.job);
    rest.lives = textField(fields.lives, person?.lives);
    rest.country = countryField(fields.country, person?.country);
    rest.nationality = countryField(fields.nationality, person?.nationality, { multiple: true, hint: t().nationalityHint });
    rest.note = textField(fields.note, person?.note, { multiline: true });
    rest.login = textField(fields.login, person?.login, { hint: t().loginHint });
    element.append(
      pair(rest.birthplace, rest.birthcountry),
      rest.nick.element,
      rest.maiden.element,
      deceased.element,
      death,
      rest.job.element,
      pair(rest.lives, rest.country),
      rest.nationality.element,
      rest.note.element,
      rest.login.element,
    );
  }

  return {
    element,
    read() {
      const values = Object.fromEntries(PERSON_FIELDS.map((key) => [key, null])) as Record<PersonField, string | null>;
      values.name = name.value();
      if (!values.name) return t().nameNeeded;
      values.sex = sex.value() || null;
      const birth = born.value();
      if (birth === INVALID) return t().invalidDate(fields.born);
      values.born = birth;
      for (const [key, field] of Object.entries(rest) as Array<[PersonField, Field<string | null>]>) values[key] = field.value();
      if (deceased && died) {
        const death = died.value();
        if (deceased.value() && death === INVALID) return t().invalidDate(fields.died);
        // Dead without a date: keep however the file said so (`died=true`), else `?`.
        const undated = person?.died !== undefined && !knownDate(person.died) ? person.died : '?';
        values.died = deceased.value() ? ((death as string | null) ?? undated) : null;
        if (!deceased.value()) {
          values.deathplace = null;
          values.deathcountry = null;
        }
      }
      return values;
    },
  };
}

/** Only what changed, and what it was — so someone else's edit in between is noticed. */
function personChanges(person: Person, values: Record<PersonField, string | null>, only?: PersonField[]): { set: Changes<PersonField>; was: Changes<PersonField> } {
  const set: Changes<PersonField> = {};
  const was: Changes<PersonField> = {};
  for (const key of only ?? FORM_FIELDS) {
    const before = personValue(person, key) ?? null;
    if (values[key] !== before) {
      set[key] = values[key];
      was[key] = before;
    }
  }
  return { set, was };
}

function error(sheet: Sheet, text: string): void {
  let line = sheet.body.querySelector<HTMLElement>('.form-error');
  if (!line) {
    line = document.createElement('p');
    line.className = 'form-error';
    line.setAttribute('role', 'alert');
    sheet.body.prepend(line);
  }
  line.textContent = text;
  line.scrollIntoView({ block: 'nearest' });
}

/** Runs a save from a sheet: the button waits, and the sheet closes once it worked. */
async function submit(sheet: Sheet, trigger: HTMLButtonElement, run: () => Promise<boolean>): Promise<void> {
  trigger.disabled = true;
  trigger.classList.add('loading-wait');
  try {
    if (await run()) sheet.close();
  } finally {
    trigger.disabled = false;
    trigger.classList.remove('loading-wait');
  }
}

// ---- the editor for one person ---------------------------------------------

/**
 * Everything that can be changed about `person`: the details on top, their
 * relatives below — each with what can be done about them — and, at the very
 * end, removing them.
 */
export function openEditor(person: Person, context: EditorContext): void {
  const { family } = context;
  const sheet = openSheet(t().editTitle(person.name));
  const form = personForm(person);
  const saveButton = button(t().save, 'btn-primary', () => {
    void submit(sheet, saveButton, async () => {
      const values = form.read();
      if (typeof values === 'string') {
        error(sheet, values);
        return false;
      }
      const { set, was } = personChanges(person, values);
      if (Object.keys(set).length === 0) return true;
      return !!(await context.save([{ kind: 'person', id: person.id, set, was }], t().msg.edited(person.name)));
    });
  });
  sheet.body.append(form.element, sheetActions(saveButton));

  const then = (next: () => void) => () => {
    sheet.close();
    next();
  };

  // Pictures, the portrait first: each can become the portrait, or go.
  const pictures = section(t().photos);
  const names = photoNames(person);
  if (names.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    names.forEach((name, index) => {
      const tile = document.createElement('figure');
      tile.className = 'photo-tile';
      const url = photoByName(name);
      if (url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        image.loading = 'lazy';
        tile.append(image);
      } else {
        const missing = document.createElement('span');
        missing.className = 'photo-missing';
        missing.textContent = name;
        tile.append(missing);
      }
      const actions = document.createElement('figcaption');
      if (index === 0 && person.photo) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-sm badge-soft badge-primary';
        badge.textContent = t().portrait;
        actions.append(badge);
      } else {
        const first = [name, ...names.filter((n) => n !== name)];
        actions.append(button(t().makePortrait, 'btn-ghost btn-xs', then(() => void changePhotos(person, first, context))));
      }
      if (url) actions.append(button(t().crop, 'btn-ghost btn-xs', then(() => void recrop(person, name, url, context))));
      const without = names.filter((n) => n !== name);
      actions.append(button(t().remove, 'btn-ghost btn-xs text-error', then(() => void changePhotos(person, without, context))));
      tile.append(actions);
      grid.append(tile);
    });
    pictures.append(grid);
  }
  const addPicture = document.createElement('div');
  addPicture.className = 'relative-add';
  addPicture.append(button(`+ ${t().addPhoto}`, 'btn-soft btn-primary', then(() => void addPhotos(person, context, true))));
  pictures.append(addPicture);
  sheet.body.append(pictures);

  // Relatives, each a row with what can be done about them.
  const relatives = section(t().relatives);

  const row = (text: string, ...actions: HTMLButtonElement[]) => {
    const line = document.createElement('div');
    line.className = 'relative-row';
    const label = document.createElement('span');
    label.textContent = text;
    line.append(label, ...actions);
    relatives.append(line);
  };

  const parentUnions = family.graph.unions.filter((u) => u.children.includes(person.id));
  for (const union of parentUnions) {
    const names = namesOf(family, union.partners);
    row(`${t().parents}: ${names}`, button(t().unlink, 'btn-ghost', then(() => confirmUnlink(union, person, context))));
  }
  for (const { union, partner } of family.partnerships(person.id)) {
    if (!partner) continue;
    row(`${shortName(partner)} · ${describe(union)}`, button(t().change, 'btn-ghost', then(() => openPartnership(union, context))));
  }
  for (const brood of family.broods(person.id)) {
    for (const child of brood.children) {
      row(`${t().child}: ${shortName(child)}`, button(t().unlink, 'btn-ghost', then(() => confirmUnlink(brood.union, child, context))));
    }
  }

  const add = document.createElement('div');
  add.className = 'relative-add';
  if (family.parents(person.id).length < 2) add.append(button(`+ ${t().parent}`, 'btn-soft btn-primary', then(() => openAddRelative('parent', person, context))));
  add.append(button(`+ ${t().partner}`, 'btn-soft btn-primary', then(() => openAddRelative('partner', person, context))));
  add.append(button(`+ ${t().child}`, 'btn-soft btn-primary', then(() => openAddRelative('child', person, context))));
  add.append(button(`+ ${t().sibling}`, 'btn-soft btn-primary', then(() => openAddRelative('sibling', person, context))));
  relatives.append(add);
  sheet.body.append(relatives);

  const danger = document.createElement('section');
  danger.className = 'sheet-section';
  danger.append(button(t().deletePerson, 'btn-ghost text-error', then(() => confirmDelete(person, context))));
  sheet.body.append(danger);
}

function section(title: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'sheet-section';
  const heading = document.createElement('h3');
  heading.className = 'settings-label';
  heading.textContent = title;
  element.append(heading);
  return element;
}

/** The editor again, with `id` as the file has them now — after a change made from inside it. */
function reopen(id: string, context: EditorContext): void {
  const person = context.family.person(id);
  if (person) openEditor(person, context);
}

// ---- pictures ---------------------------------------------------------------

/**
 * New pictures for `person`, chosen on the device: each uploaded, then all
 * added in one change — the first as the portrait if there is none yet.
 */
export async function addPhotos(person: Person, context: EditorContext, thenEdit = false): Promise<void> {
  const files = await pickImages();
  // One picture gets the circle to choose what shows in the bubble; several go as they are.
  const [only] = files;
  if (files.length === 1 && only) {
    const cropped = await cropImage(only);
    if (!cropped) return;
    if (cropped !== 'whole') files[0] = new File([cropped], 'cropped.jpg', { type: cropped.type });
  }
  const added: string[] = [];
  for (const file of files) {
    const name = await context.upload(await shrink(file), person.id);
    if (!name) break;
    added.push(name);
  }
  if (added.length === 0) return;
  const names = person.photo ? [...photoNames(person), ...added] : [added[0]!, ...(person.photos ?? []), ...added.slice(1)];
  const { set, was } = photoChanges(person, names);
  const saved = await context.save([{ kind: 'person', id: person.id, set, was }], t().msg.photosAdded(person.name, added.length));
  if (saved && thenEdit) reopen(person.id, context);
}

/** A new circle out of a picture someone already has: a new file, in the old one's place. */
async function recrop(person: Person, name: string, url: string, context: EditorContext): Promise<void> {
  const original = await fetch(url).then((response) => (response.ok ? response.blob() : undefined)).catch(() => undefined);
  if (!original) return;
  const cropped = await cropImage(original);
  if (!cropped || cropped === 'whole') return reopen(person.id, context);
  const added = await context.upload(cropped, person.id);
  if (!added) return;
  await changePhotos(person, photoNames(person).map((n) => (n === name ? added : n)), context);
}

/** Gives `person` exactly `names`, the first as the portrait. The files stay in photos/. */
async function changePhotos(person: Person, names: string[], context: EditorContext): Promise<void> {
  const { set, was } = photoChanges(person, names);
  if (Object.keys(set).length === 0) return;
  if (await context.save([{ kind: 'person', id: person.id, set, was }], t().msg.photosChanged(person.name))) reopen(person.id, context);
}

// ---- someone new ------------------------------------------------------------

/**
 * Someone new, connected to nobody yet — from the menu. `login` fills in the
 * login name ahead: the first person of a new family is usually whoever is
 * starting it.
 */
export function openNewPerson(context: EditorContext, done: (id: string) => void, login?: string): void {
  const sheet = openSheet(t().newPerson);
  const form = personForm(login ? { id: '', name: '', login } : undefined);
  const add = button(t().add, 'btn-primary', () => {
    void submit(sheet, add, async () => {
      const values = form.read();
      if (typeof values === 'string') {
        error(sheet, values);
        return false;
      }
      const created = await context.save([{ kind: 'add-person', ref: '$new', set: values }], t().msg.added(values.name!));
      if (created?.$new) done(created.$new);
      return !!created;
    });
  });
  sheet.body.append(form.element, sheetActions(add));
}

// ---- adding relatives -------------------------------------------------------

export type Kind = 'parent' | 'partner' | 'child' | 'sibling';

/**
 * A parent, partner, child or sibling for `person`: someone new — just name,
 * sex and birth, the rest can follow on their own card — or someone already in
 * the tree. What else it takes depends on the kind: the other parent of a
 * child, how a partnership stands, which parents siblings share.
 */
export function openAddRelative(kind: Kind, person: Person, context: EditorContext, preset: { otherParent?: string } = {}): void {
  const { family } = context;
  const sheet = openSheet(t().addTitle[kind](shortName(person)));
  const form = personForm(undefined, true);

  // Or someone who is already there.
  let existing: Person | undefined;
  /** Kinds whose further questions depend on who was chosen ask again. */
  let chosenChanged: (() => void) | undefined;
  const chosen = document.createElement('div');
  chosen.className = 'relative-existing';
  const paintChosen = () => {
    chosen.replaceChildren();
    form.element.hidden = !!existing;
    if (existing) {
      const label = document.createElement('span');
      label.textContent = t().chosen(existing.name);
      chosen.append(label, button(t().close, 'btn-ghost', () => {
        existing = undefined;
        paintChosen();
      }));
    } else {
      const hint = document.createElement('span');
      hint.className = 'form-hint';
      hint.textContent = t().orExisting;
      chosen.append(hint, button(t().chooseExisting, 'btn-ghost', () => {
        void pickPerson(family, { title: t().addTitle[kind](shortName(person)), caption: context.caption, exclude: person.id }).then((picked) => {
          if (picked) existing = picked;
          paintChosen();
        });
      }));
    }
    chosenChanged?.();
  };
  paintChosen();
  sheet.body.append(form.element, chosen);

  // What else this kind of relative needs.
  const partners = family.partnerships(person.id).filter((p) => p.partner);
  let otherParent: ReturnType<typeof choiceField<string>> | undefined;
  let adopted: ReturnType<typeof checkField> | undefined;
  let together: ReturnType<typeof checkField> | undefined;
  let partnership: ReturnType<typeof partnershipFields> | undefined;
  let shared: ReturnType<typeof choiceField<string>> | undefined;
  let newParents: Array<Field<string | null>> = [];
  /** Children who get the new person as their other parent, each with a box to say so. */
  let alsoParentOf: Array<{ child: Person; box: ReturnType<typeof checkField> }> = [];
  const alsoParent = document.createElement('div');
  alsoParent.className = 'form-group';
  const askAlsoParent = (label: string, children: Person[]) => {
    alsoParentOf = children.map((child) => ({ child, box: checkField(shortName(child), true) }));
    alsoParent.hidden = alsoParentOf.length === 0;
    const heading = document.createElement('p');
    heading.className = 'form-label';
    heading.textContent = label;
    alsoParent.replaceChildren(heading, ...alsoParentOf.map(({ box }) => box.element));
  };
  /** Children someone has with nobody else named: the ones a new partner may well be the other parent of. */
  const ownChildren = (id: string) =>
    family.graph.unions.filter((u) => u.partners.length === 1 && u.partners[0] === id).flatMap((u) => u.children.map((c) => family.person(c)!).filter(Boolean));
  const loneParent = family.graph.unions.find((u) => u.children.includes(person.id) && u.partners.length === 1);
  if (kind === 'sibling') {
    // Siblings are children of the same parents: these, or one of them for a half-sibling.
    const parentUnions = family.graph.unions.filter((u) => u.children.includes(person.id));
    if (parentUnions.length > 0) {
      const options = parentUnions.flatMap((union) => [
        { value: union.partners.join('+'), label: namesOf(family, union.partners) },
        ...(union.partners.length === 2 ? union.partners.map((id) => ({ value: id, label: t().halfVia(namesOf(family, [id])) })) : []),
      ]);
      shared = choiceField(t().sharedParents, options, options[0]!.value);
      sheet.body.append(shared.element);
    } else {
      // No parents yet: they come along, named or as a stand-in to name later.
      const group = document.createElement('div');
      group.className = 'form-group';
      const hint = document.createElement('p');
      hint.className = 'form-hint';
      hint.textContent = t().siblingParentsHint(shortName(person));
      newParents = [textField(t().motherOptional, undefined), textField(t().fatherOptional, undefined)];
      group.append(hint, ...newParents.map((field) => field.element));
      sheet.body.append(group);
    }
  } else if (kind === 'child') {
    const lasting = partners.filter((p) => !unionEnd(p.union) && !['divorced', 'separated'].includes(unionStatus(p.union)));
    const options = [...partners.map((p) => ({ value: p.partner!.id, label: shortName(p.partner!) })), { value: '', label: t().unknownParent }];
    const likely = lasting.at(-1)?.partner?.id ?? partners.at(-1)?.partner?.id ?? '';
    const asked = preset.otherParent;
    otherParent = choiceField(t().otherParent, options, asked !== undefined && options.some((o) => o.value === asked) ? asked : likely);
    adopted = checkField(t().adopted, false);
    sheet.body.append(otherParent.element, adopted.element);
  } else if (kind === 'partner') {
    partnership = partnershipFields(undefined);
    // Their children so far had one parent named: the new partner may be the other.
    chosenChanged = () => {
      const children = [...ownChildren(person.id), ...(existing ? ownChildren(existing.id) : [])];
      askAlsoParent(t().sharedChildren, [...new Map(children.map((c) => [c.id, c])).values()]);
    };
    chosenChanged();
    sheet.body.append(partnership.element, alsoParent);
  } else if (loneParent) {
    together = checkField(t().togetherWith(namesOf(family, loneParent.partners)), true);
    // Brothers and sisters with the same one parent named most likely share the new one too.
    askAlsoParent(t().alsoParentOf, loneParent.children.filter((c) => c !== person.id).map((c) => family.person(c)!).filter(Boolean));
    together.onChange((on) => (alsoParent.hidden = !on || alsoParentOf.length === 0));
    sheet.body.append(together.element, alsoParent);
  }

  const add = button(t().add, 'btn-primary', () => {
    void submit(sheet, add, async () => {
      const edits: Edit[] = [];
      let target = existing?.id;
      let name = existing?.name;
      if (!existing) {
        const values = form.read();
        if (typeof values === 'string') {
          error(sheet, values);
          return false;
        }
        target = '$new';
        name = values.name!;
        edits.push({ kind: 'add-person', ref: '$new', set: values, near: nearFor(kind, person, family, otherParent?.value()) });
      }
      let message: string;
      if (kind === 'child') {
        const parents = [person.id, otherParent?.value()].filter((p): p is string => !!p);
        edits.push({ kind: 'add-child', parents, child: target!, adopted: adopted?.value() ?? false });
        message = t().msg.addedChild(name!, namesOf(family, parents));
      } else if (kind === 'partner') {
        const set = partnership!.read(undefined);
        if (typeof set === 'string') {
          error(sheet, set);
          return false;
        }
        edits.push({ kind: 'add-partnership', partners: [person.id, target!], set: set.set });
        for (const { child, box } of alsoParentOf) {
          if (box.value()) edits.push({ kind: 'add-child', parents: [person.id, target!], child: child.id });
        }
        message = t().msg.addedPartner(person.name, name!);
      } else if (kind === 'sibling') {
        let parents: string[];
        if (shared) {
          parents = shared.value().split('+');
        } else {
          // A mother and a father, as named — or stand-ins to name later, whose ids follow once they are.
          const stand = [
            { name: newParents[0]?.value() ?? t().motherOf(shortName(person)), sex: 'f' },
            { name: newParents[1]?.value() ?? t().fatherOf(shortName(person)), sex: 'm' },
          ];
          parents = stand.map((parent, i) => {
            edits.push({ kind: 'add-person', ref: `$parent${i}`, set: parent, near: { id: person.id, side: 'before' } });
            return `$parent${i}`;
          });
          edits.push({ kind: 'add-child', parents, child: person.id });
        }
        edits.push({ kind: 'add-child', parents, child: target! });
        message = t().msg.addedSibling(name!, person.name);
      } else {
        if (loneParent && together?.value()) {
          // As a child of both, they are no longer listed under the one parent alone.
          const children = [person, ...alsoParentOf.filter(({ box }) => box.value()).map(({ child }) => child)];
          for (const child of children) edits.push({ kind: 'add-child', parents: [...loneParent.partners, target!], child: child.id });
        } else {
          edits.push({ kind: 'add-child', parents: [target!], child: person.id });
        }
        message = t().msg.addedParent(name!, person.name);
      }
      return !!(await context.save(edits, message));
    });
  });
  sheet.body.append(sheetActions(add));
}

/** Where a new relative's line goes: a child after their siblings, a parent before the child. */
function nearFor(kind: Kind, person: Person, family: Family, other: string | undefined): { id: string; side: 'before' | 'after' } {
  if (kind === 'parent') return { id: person.id, side: 'before' };
  if (kind === 'child') {
    const union = family.graph.unions.find((u) => u.partners.length === (other ? 2 : 1) && u.partners.includes(person.id) && (!other || u.partners.includes(other)));
    const sibling = union?.children.at(-1);
    if (sibling) return { id: sibling, side: 'after' };
  }
  return { id: person.id, side: 'after' };
}

// ---- partnerships -----------------------------------------------------------

/**
 * How a partnership stands: married or together, since when, and whether and
 * when it ended. `read` gives only the keys that change against `union`.
 */
function partnershipFields(union: Union | undefined) {
  const element = document.createElement('div');
  element.className = 'form';
  const marriedNow = !union || union.married !== undefined || union.together === undefined;
  const state = choiceField<'married' | 'together'>(
    t().relationship,
    [
      { value: 'married', label: t().status.married },
      { value: 'together', label: t().status.together },
    ],
    marriedNow ? 'married' : 'together',
  );
  const since = dateField(t().sinceLabel, union && unionStart(union));
  const ended = checkField(t().ended, !!union && (union.divorced !== undefined || union.separated !== undefined));
  const until = dateField(t().until, union && unionEnd(union));
  until.element.hidden = !ended.value();
  ended.onChange((on) => (until.element.hidden = !on));
  element.append(state.element, since.element, ended.element, until.element);

  return {
    element,
    read(current: Union | undefined): { set: Changes<UnionField>; was: Changes<UnionField> } | string {
      const start = since.value();
      const end = until.value();
      if (start === INVALID) return t().invalidDate(t().sinceLabel);
      if (ended.value() && end === INVALID) return t().invalidDate(t().until);
      // An undated value stays as the file wrote it (`divorced=true`), a new one is `?`.
      const undated = (key: UnionField) => (current?.[key] !== undefined && !knownDate(current[key]) ? current[key]! : '?');
      const startKey = state.value();
      const endKey = startKey === 'married' ? 'divorced' : 'separated';
      const wanted: Record<UnionField, string | null | undefined> = {
        married: current?.married ?? null,
        together: current?.together ?? null,
        divorced: null,
        separated: null,
      };
      if (startKey === 'married') {
        // A bare `a + b` is a marriage already; it needs no key unless there is a date.
        wanted.married = (start as string | null) ?? (current && (current.married !== undefined || current.together !== undefined) ? undated('married') : null);
        if (!current) wanted.married ??= '?';
      } else {
        wanted.married = null;
        wanted.together = (start as string | null) ?? undated('together');
      }
      if (ended.value()) wanted[endKey] = (end as string | null) ?? undated(endKey);
      const set: Changes<UnionField> = {};
      const was: Changes<UnionField> = {};
      for (const key of ['married', 'together', 'divorced', 'separated'] as const) {
        const before = current?.[key] ?? null;
        if ((wanted[key] ?? null) !== before) {
          set[key] = wanted[key] ?? null;
          was[key] = before;
        }
      }
      return { set, was };
    },
  };
}

export function openPartnership(union: Union, context: EditorContext): void {
  const names = namesOf(context.family, union.partners);
  const sheet = openSheet(names);
  const fields = partnershipFields(union);
  const save = button(t().save, 'btn-primary', () => {
    void submit(sheet, save, async () => {
      const result = fields.read(union);
      if (typeof result === 'string') {
        error(sheet, result);
        return false;
      }
      if (Object.keys(result.set).length === 0) return true;
      return !!(await context.save([{ kind: 'partnership', union: union.id, ...result }], t().msg.partnership(names)));
    });
  });
  const buttons = [save];
  if (union.children.length === 0) {
    const remove = button(t().removePartnership, 'btn-ghost text-error', () => {
      void submit(sheet, remove, async () => !!(await context.save([{ kind: 'delete-partnership', union: union.id }], t().msg.removedPartnership(names))));
    });
    buttons.push(remove);
  }
  sheet.body.append(fields.element, sheetActions(...buttons));
}

// ---- taking things out ------------------------------------------------------

function confirm(title: string, text: string, label: string, run: () => Promise<unknown>): void {
  const sheet = openSheet(title);
  const paragraph = document.createElement('p');
  paragraph.className = 'sheet-text';
  paragraph.textContent = text;
  const go = button(label, 'btn-error', () => void submit(sheet, go, async () => !!(await run())));
  sheet.body.append(paragraph, sheetActions(go, button(t().cancel, 'btn-ghost', () => sheet.close())));
}

export function confirmUnlink(union: Union, child: Person, context: EditorContext): void {
  const parents = namesOf(context.family, union.partners);
  confirm(t().unlink, t().unlinkText(child.name, parents), t().unlink, () =>
    context.save([{ kind: 'remove-child', union: union.id, child: child.id }], t().msg.unlinked(child.name, parents)),
  );
}

export function confirmDelete(person: Person, context: EditorContext): void {
  const { family } = context;
  const links =
    family.parents(person.id).length + family.children(person.id).length + family.partnerships(person.id).filter((p) => p.partner).length;
  confirm(t().deletePerson, t().deleteText(person.name, links), t().delete, () =>
    context.save([{ kind: 'delete-person', id: person.id }], t().msg.deleted(person.name)),
  );
}

// ---- words ------------------------------------------------------------------

export function namesOf(family: Family, ids: string[]): string {
  return ids.map((id) => {
    const person = family.person(id);
    return person ? shortName(person) : id;
  }).join(' & ');
}

/** `verheiratet 1984–1996`, `zusammen seit 2015`. */
function describe(union: Union): string {
  const from = year(unionStart(union));
  const to = year(unionEnd(union));
  const status = t().status[unionStatus(union)];
  if (from && to) return `${status} ${from}–${to}`;
  return from ? `${status} · ${t().since(from)}` : status;
}
