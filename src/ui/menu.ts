import { t } from '../i18n';
import { icon, type IconName } from './icons';
import { openSheet } from './sheet';

export interface MenuItem {
  icon: IconName;
  label: string;
  /** What a choice does — or, with `items`, nothing: the entry opens those instead. */
  action?: () => void;
  /** A smaller menu of its own, shown in place of this one. */
  items?: MenuItem[];
  /** Removes or deletes something: shown in red, and set apart. */
  danger?: boolean;
}

let open: (() => void) | undefined;

/**
 * A small menu at a point on screen — what a right-click on the tree brings
 * up. Without a point, for a finger, the same menu is a sheet from the bottom
 * instead: rows to reach with a thumb rather than a box under it. Goes away on
 * a choice, a press elsewhere, Escape, or once the page moves on. Kept inside
 * the window however close to an edge it was asked for. An entry with `items`
 * opens them in the same spot, with a way back.
 */
export function openMenu(at: { x: number; y: number } | undefined, title: string | undefined, items: MenuItem[]): void {
  closeMenu();
  if (items.length === 0) return;

  // Closed some other way — the backdrop, Back — it still has to tidy up.
  const sheet = at ? undefined : openSheet(title ?? '', () => open === close && close());
  const element = sheet?.body ?? document.createElement('div');
  element.classList.add(sheet ? 'menu-sheet' : 'context-menu');
  let buttons: HTMLButtonElement[] = [];

  const place = () => {
    if (!at) return;
    const margin = 8;
    const box = element.getBoundingClientRect();
    element.style.left = `${Math.max(margin, Math.min(at.x, innerWidth - box.width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(at.y, innerHeight - box.height - margin))}px`;
  };

  const show = (heading: string | undefined, entries: MenuItem[], back?: () => void) => {
    element.replaceChildren();
    if (sheet) {
      sheet.heading.textContent = heading ?? '';
    } else if (heading) {
      const label = document.createElement('p');
      label.className = 'context-menu-title';
      label.textContent = heading;
      element.append(label);
    }
    const list = document.createElement('ul');
    list.className = `menu w-full p-0 ${sheet ? '' : 'menu-sm'}`;
    list.setAttribute('role', 'menu');
    if (heading) list.setAttribute('aria-label', heading);
    const row = (glyph: IconName, label: string, run: () => void, className = '', more = false) => {
      const entry = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.className = className;
      button.append(icon(glyph), label);
      if (more) {
        button.setAttribute('aria-haspopup', 'menu');
        const chevron = icon('next');
        chevron.classList.add('context-menu-more');
        button.append(chevron);
      }
      // Synchronously on the click: a file picker only opens from a user's own gesture.
      button.addEventListener('click', run);
      entry.append(button);
      list.append(entry);
      return { entry, button };
    };
    buttons = [];
    if (back) buttons.push(row('previous', t().menuBack, back, 'context-menu-back').button);
    entries.forEach((item, index) => {
      const sub = item.items;
      const { entry, button } = row(
        item.icon,
        item.label,
        sub ? () => show(item.label, sub, () => show(heading, entries, back)) : () => {
          closeMenu();
          item.action?.();
        },
        item.danger ? 'text-error' : '',
        !!sub,
      );
      // A line above whatever removes something.
      if (item.danger && index > 0 && !entries[index - 1]!.danger) entry.className = 'context-menu-danger';
      buttons.push(button);
    });
    element.append(list);
    place();
    // A sheet leaves focus where the dialog puts it; a finger has no use for a ring.
    if (!sheet) buttons[back ? 1 : 0]?.focus({ preventScroll: true });
  };

  if (!sheet) document.body.append(element);
  show(title, items);

  const outside = (event: Event) => {
    if (!element.contains(event.target as Node)) closeMenu();
  };
  const keys = (event: KeyboardEvent) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Tab' && !sheet) {
      closeMenu();
    }
  };
  const gone = () => closeMenu();
  const returnTo = document.activeElement as HTMLElement | null;

  // A sheet has its own backdrop, and a phone resizes whenever its toolbars come and go.
  if (!sheet) {
    document.addEventListener('pointerdown', outside, true);
    addEventListener('resize', gone);
  }
  document.addEventListener('keydown', keys, true);
  addEventListener('hashchange', gone);
  const close = () => {
    open = undefined;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
    removeEventListener('resize', gone);
    removeEventListener('hashchange', gone);
    if (sheet) sheet.close();
    else element.remove();
    if (document.activeElement === document.body || !document.activeElement) returnTo?.focus?.({ preventScroll: true });
  };
  open = close;
}

export function closeMenu(): void {
  open?.();
}
