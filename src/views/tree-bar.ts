import { t } from '../i18n';
import { icon, iconButton } from '../ui/icons';
import { openMenu, type MenuItem } from '../ui/menu';

/** Buttons the bar has room for at phone width; whatever else there is goes under "More". */
const ROOM = 4;

/**
 * What a tap on the tree brings up on a phone: who or what was tapped, and
 * the same choices as the tree's menu, as buttons along the bottom where a
 * thumb reaches them. `open` makes the title a way into the person's page;
 * `done` takes the bar away, as any choice does.
 */
export function treeBar(title: string, items: MenuItem[], done: () => void, open?: () => void): HTMLElement {
  const bar = document.createElement('section');
  bar.className = 'tree-bar';
  bar.setAttribute('aria-label', title);

  const head = document.createElement('div');
  head.className = 'tree-bar-head';
  const name = document.createElement(open ? 'button' : 'p');
  name.className = 'tree-bar-title';
  const text = document.createElement('span');
  text.textContent = title;
  name.append(text);
  if (open && name instanceof HTMLButtonElement) {
    name.type = 'button';
    name.append(icon('next'));
    name.addEventListener('click', () => {
      done();
      open();
    });
  }
  const close = iconButton('close', t().close);
  close.classList.add('btn-sm');
  close.addEventListener('click', done);
  head.append(name, close);

  // Removing something is never one stray tap away: it waits under "More".
  const safe = items.filter((item) => !item.danger);
  const shown = safe.length + (safe.length < items.length ? 1 : 0) > ROOM ? safe.slice(0, ROOM - 1) : safe;
  const rest = items.filter((item) => !shown.includes(item));

  const actions = document.createElement('div');
  actions.className = 'tree-bar-actions';
  const action = (item: MenuItem, run: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tree-bar-action ${item.danger ? 'text-error' : ''}`;
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(icon(item.icon), label);
    if (item.items) button.setAttribute('aria-haspopup', 'menu');
    // Synchronously on the click: a file picker only opens from a user's own gesture.
    button.addEventListener('click', run);
    actions.append(button);
  };
  for (const item of shown) {
    const sub = item.items;
    action(item, sub ? () => openMenu(undefined, item.label, closing(sub, done)) : () => {
      done();
      item.action?.();
    });
  }
  if (rest.length > 0) action({ icon: 'more', label: t().more }, () => openMenu(undefined, title, closing(rest, done)));
  bar.append(head, actions);
  return bar;
}

/** The same choices, each taking the bar away before it does what it does. */
function closing(items: MenuItem[], done: () => void): MenuItem[] {
  return items.map(({ action, items: sub, ...item }) => ({
    ...item,
    ...(action && {
      action: () => {
        done();
        action();
      },
    }),
    ...(sub && { items: closing(sub, done) }),
  }));
}
