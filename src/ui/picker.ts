import type { Family, SearchOptions } from '../family';
import { t } from '../i18n';
import type { Person } from '../parser/types';
import { displayName, lifespan } from './format';
import { closeOnBack } from './back';
import { iconButton } from './icons';
import { bubble } from './tile';

export interface PickOptions {
  title: string;
  /** A line under the title saying what the choice is for. */
  hint?: string;
  /** Offers "none of them", which resolves to `null`. */
  none?: boolean;
  /** A line under each name — typically what they are to whoever is looking. */
  caption?: (person: Person) => string | undefined;
  /** Extra text to search, passed on to `Family.search`. */
  extra?: SearchOptions['extra'];
  exclude?: string;
}

/**
 * A searchable list of everyone, as a bottom sheet on a phone and a dialog on
 * a desktop. Resolves to the chosen person, `null` for "none of them", or
 * `undefined` when dismissed.
 */
export function pickPerson(family: Family, options: PickOptions): Promise<Person | null | undefined> {
  return new Promise((resolve) => {
    let result: Person | null | undefined;

    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal-bottom sm:modal-middle';
    const box = document.createElement('div');
    box.className = 'modal-box picker';

    // The close button comes first so that it, not the field, takes the focus:
    // a phone keyboard popping up would hide half the list.
    const header = document.createElement('div');
    header.className = 'picker-header';
    const title = document.createElement('h2');
    title.className = 'picker-title';
    title.textContent = options.title;
    const close = iconButton('close', t().close);
    close.classList.add('btn-sm');
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);

    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = t().pickerPlaceholder;
    input.setAttribute('aria-label', t().pickerPlaceholder);
    input.className = 'input w-full rounded-full bg-base-200';

    const list = document.createElement('ul');
    list.className = 'picker-list';

    const choose = (person: Person | null) => {
      result = person;
      dialog.close();
    };

    const everyone = family
      .people()
      .filter((p) => p.id !== options.exclude)
      .sort((a, b) => a.name.localeCompare(b.name));

    const render = () => {
      const query = input.value.trim();
      const people = query
        ? family.search(query, { extra: options.extra, limit: 50 }).filter((p) => p.id !== options.exclude)
        : everyone;
      if (people.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'picker-empty';
        empty.textContent = t().noMatches;
        list.replaceChildren(empty);
        return;
      }
      list.replaceChildren(
        ...people.map((person) => {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'picker-row';
          const text = document.createElement('span');
          text.className = 'picker-text';
          const name = document.createElement('span');
          name.className = 'picker-name';
          name.textContent = displayName(person);
          const detail = document.createElement('small');
          detail.className = 'picker-detail';
          detail.textContent = [options.caption?.(person), lifespan(person)].filter(Boolean).join(' · ');
          text.append(name, detail);
          button.append(bubble(person), text);
          button.addEventListener('click', () => choose(person));
          item.append(button);
          return item;
        }),
      );
    };

    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const first = list.querySelector<HTMLButtonElement>('.picker-row');
      first?.click();
    });

    box.append(header);
    if (options.hint) {
      const hint = document.createElement('p');
      hint.className = 'picker-hint';
      hint.textContent = options.hint;
      box.append(hint);
    }
    box.append(input, list);
    if (options.none) {
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'btn btn-ghost btn-sm self-start';
      none.textContent = t().noneOfThem;
      none.addEventListener('click', () => choose(null));
      box.append(none);
    }

    const backdrop = document.createElement('form');
    backdrop.method = 'dialog';
    backdrop.className = 'modal-backdrop';
    const dismiss = document.createElement('button');
    dismiss.textContent = t().close;
    backdrop.append(dismiss);

    dialog.append(box, backdrop);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    render();
    document.body.append(dialog);
    dialog.showModal();
    closeOnBack(dialog);
  });
}
