import { addPhotos, confirmDelete, confirmUnlink, namesOf, openAddRelative, openEditor, openNewPerson, openPartnership, type EditorContext } from '../edit/editor';
import type { Family } from '../family';
import type { Person } from '../parser/types';
import { t } from '../i18n';
import { displayName, shortName } from '../ui/format';
import type { MenuItem } from '../ui/menu';
import type { TreeTarget } from './overview';

export interface TreeMenuContext {
  family: Family;
  /** Only there when whoever is looking may change the family. */
  editor: EditorContext | undefined;
  open(id: string): void;
  /** Someone was just added from the tree. */
  added(id: string): void;
  fit(): void;
}

/**
 * What a right-click or a long press on the tree offers: for a person, their
 * card and everything the editor can do about them; for the line between two
 * people, their partnership and their children; for empty space, someone new.
 */
export function treeMenu(target: TreeTarget, context: TreeMenuContext): { title: string | undefined; items: MenuItem[] } {
  const { family, editor } = context;

  if (target.kind === 'person') {
    const person = family.person(target.id);
    if (!person) return { title: undefined, items: [] };
    const items: MenuItem[] = [{ icon: 'person', label: t().open, action: () => context.open(person.id) }];
    if (editor) {
      items.push(
        { icon: 'pencil', label: t().edit, action: () => openEditor(person, editor) },
        { icon: 'plus', label: t().addMenu, items: addMenu(family, person, editor) },
        { icon: 'trash', label: t().deletePerson, action: () => confirmDelete(person, editor), danger: true },
      );
    }
    return { title: displayName(person), items };
  }

  if (target.kind === 'union') {
    const union = family.graph.unions.find((u) => u.id === target.id);
    if (!union || !editor) return { title: undefined, items: [] };
    const [first, second] = union.partners.map((id) => family.person(id));
    if (!first) return { title: undefined, items: [] };
    const items: MenuItem[] = [];
    if (second) items.push({ icon: 'pencil', label: t().editPartnership, action: () => openPartnership(union, editor) });
    items.push({ icon: 'down', label: t().addChild, action: () => openAddRelative('child', first, editor, { otherParent: second?.id ?? '' }) });
    for (const id of union.children) {
      const child = family.person(id);
      if (child) items.push({ icon: 'unlink', label: t().unlinkChild(shortName(child)), action: () => confirmUnlink(union, child, editor), danger: true });
    }
    return { title: namesOf(family, union.partners), items };
  }

  const items: MenuItem[] = [];
  if (editor) items.push({ icon: 'plus', label: t().addPerson, action: () => openNewPerson(editor, context.added) });
  items.push({ icon: 'fit', label: t().fit, action: context.fit });
  return { title: undefined, items };
}

/**
 * What can be added to someone: relatives of every kind and a photo — the
 * same choices from the tree and from their card.
 */
export function addMenu(family: Family, person: Person, editor: EditorContext): MenuItem[] {
  const items: MenuItem[] = [];
  if (family.parents(person.id).length < 2) items.push({ icon: 'up', label: t().parent, action: () => openAddRelative('parent', person, editor) });
  items.push(
    { icon: 'link', label: t().partner, action: () => openAddRelative('partner', person, editor) },
    { icon: 'down', label: t().child, action: () => openAddRelative('child', person, editor) },
    { icon: 'swap', label: t().sibling, action: () => openAddRelative('sibling', person, editor) },
    { icon: 'image', label: t().addPhoto, action: () => void addPhotos(person, editor) },
  );
  return items;
}
