import { icon, type IconName } from './icons';

export interface MenuItem {
  icon: IconName;
  label: string;
  action: () => void;
  /** Removes or deletes something: shown in red, and set apart. */
  danger?: boolean;
}

let open: (() => void) | undefined;

/**
 * A small menu at a point on screen — what a right-click or a long press on
 * the tree brings up. Goes away on a choice, a press elsewhere, Escape, or
 * once the page moves on. Kept inside the window however close to an edge
 * it was asked for.
 */
export function openMenu(at: { x: number; y: number }, title: string | undefined, items: MenuItem[]): void {
  closeMenu();
  if (items.length === 0) return;

  const element = document.createElement('div');
  element.className = 'context-menu';
  if (title) {
    const heading = document.createElement('p');
    heading.className = 'context-menu-title';
    heading.textContent = title;
    element.append(heading);
  }
  const list = document.createElement('ul');
  list.className = 'menu menu-sm w-full p-0';
  list.setAttribute('role', 'menu');
  if (title) list.setAttribute('aria-label', title);
  const buttons = items.map((item, index) => {
    const entry = document.createElement('li');
    // A line above whatever removes something.
    if (item.danger && index > 0 && !items[index - 1]!.danger) entry.className = 'context-menu-danger';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    if (item.danger) button.className = 'text-error';
    button.append(icon(item.icon), item.label);
    // Synchronously on the click: a file picker only opens from a user's own gesture.
    button.addEventListener('click', () => {
      closeMenu();
      item.action();
    });
    entry.append(button);
    list.append(entry);
    return button;
  });
  element.append(list);
  document.body.append(element);

  const margin = 8;
  const box = element.getBoundingClientRect();
  element.style.left = `${Math.max(margin, Math.min(at.x, innerWidth - box.width - margin))}px`;
  element.style.top = `${Math.max(margin, Math.min(at.y, innerHeight - box.height - margin))}px`;

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
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  };
  const gone = () => closeMenu();
  const returnTo = document.activeElement as HTMLElement | null;

  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keys, true);
  addEventListener('resize', gone);
  addEventListener('hashchange', gone);
  open = () => {
    open = undefined;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
    removeEventListener('resize', gone);
    removeEventListener('hashchange', gone);
    element.remove();
    if (document.activeElement === document.body || !document.activeElement) returnTo?.focus?.({ preventScroll: true });
  };
  buttons[0]?.focus({ preventScroll: true });
}

export function closeMenu(): void {
  open?.();
}
