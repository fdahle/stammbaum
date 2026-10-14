import { t } from '../i18n';
import { knownDate } from '../parser/types';
import { parseDate } from '../ui/format';

/** One input of a form, and how to read what was entered. */
export interface Field<T> {
  element: HTMLElement;
  value(): T;
}

/** Marks a date the form cannot accept, so the sheet can say which. */
export const INVALID = Symbol('invalid');

let counter = 0;
const nextId = () => `field-${++counter}`;

function labelled(label: string, control: HTMLElement, id: string, hint?: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const caption = document.createElement('label');
  caption.className = 'form-label';
  caption.htmlFor = id;
  caption.textContent = label;
  wrapper.append(caption, control);
  if (hint) {
    const small = document.createElement('p');
    small.className = 'form-hint';
    small.textContent = hint;
    wrapper.append(small);
  }
  return wrapper;
}

export function textField(label: string, value: string | undefined, options: { multiline?: boolean; hint?: string } = {}): Field<string | null> {
  const id = nextId();
  const input = document.createElement(options.multiline ? 'textarea' : 'input');
  input.id = id;
  input.className = options.multiline ? 'textarea w-full' : 'input w-full';
  input.value = value ?? '';
  if (input instanceof HTMLInputElement) input.type = 'text';
  else input.rows = 3;
  return {
    element: labelled(label, input, id, options.hint),
    value: () => input.value.trim() || null,
  };
}

/**
 * A date as family.md has it: the year always, month and day if known — three
 * small inputs rather than a calendar, since a birthday in 1931 is a long way
 * to scroll. A value in the file that is not such a date (`ca. 1900`) is
 * offered as written, in one text field.
 */
export function dateField(label: string, value: string | undefined): Field<string | null | typeof INVALID> {
  const id = nextId();
  const written = knownDate(value);
  const parts = parseDate(written);
  if (written && !parts) {
    const field = textField(label, written, { hint: t().freeDateHint });
    return field;
  }

  const row = document.createElement('div');
  row.className = 'date-parts';
  const day = document.createElement('input');
  day.id = id;
  day.className = 'input';
  day.inputMode = 'numeric';
  day.maxLength = 2;
  day.placeholder = t().day;
  day.setAttribute('aria-label', `${label}: ${t().day}`);
  day.value = parts?.d ? String(parts.d) : '';

  const month = document.createElement('select');
  month.className = 'select';
  month.setAttribute('aria-label', `${label}: ${t().month}`);
  month.append(new Option(t().month, ''));
  t().months.forEach((name, i) => month.append(new Option(name, String(i + 1))));
  month.value = parts?.m ? String(parts.m) : '';

  const year = document.createElement('input');
  year.className = 'input';
  year.inputMode = 'numeric';
  year.maxLength = 4;
  year.placeholder = t().year;
  year.setAttribute('aria-label', `${label}: ${t().year}`);
  year.value = parts ? String(parts.y) : '';
  row.append(day, month, year);

  return {
    element: labelled(label, row, id, t().dateHint),
    value: () => {
      const d = day.value.trim();
      const m = month.value;
      const y = year.value.trim();
      if (!d && !m && !y) return null;
      if (!/^\d{4}$/.test(y)) return INVALID;
      if (!m) return d ? INVALID : y;
      const mm = m.padStart(2, '0');
      if (!d) return `${y}-${mm}`;
      const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
      if (!/^\d{1,2}$/.test(d) || Number(d) < 1 || Number(d) > days) return INVALID;
      return `${y}-${mm}-${d.padStart(2, '0')}`;
    },
  };
}

/** A few choices side by side, exactly one of them on. */
export function choiceField<T extends string>(label: string, options: Array<{ value: T; label: string }>, value: T): Field<T> & { onChange(listener: (value: T) => void): void } {
  const id = nextId();
  let current = value;
  const listeners: Array<(value: T) => void> = [];
  const row = document.createElement('div');
  row.className = 'join w-full';
  row.id = id;
  row.setAttribute('role', 'radiogroup');
  const buttons = options.map((option) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = option.label;
    element.setAttribute('role', 'radio');
    element.addEventListener('click', () => {
      current = option.value;
      paint();
      for (const listener of listeners) listener(current);
    });
    row.append(element);
    return { element, option };
  });
  const paint = () => {
    for (const { element, option } of buttons) {
      const on = option.value === current;
      element.className = `btn btn-sm join-item flex-1 ${on ? 'btn-primary' : 'btn-ghost bg-base-200'}`;
      element.setAttribute('aria-checked', String(on));
    }
  };
  paint();
  return { element: labelled(label, row, id), value: () => current, onChange: (listener) => void listeners.push(listener) };
}

export function checkField(label: string, checked: boolean): Field<boolean> & { onChange(listener: (checked: boolean) => void): void } {
  const wrapper = document.createElement('label');
  wrapper.className = 'form-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'checkbox checkbox-sm checkbox-primary';
  box.checked = checked;
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(box, text);
  return {
    element: wrapper,
    value: () => box.checked,
    onChange: (listener) => box.addEventListener('change', () => listener(box.checked)),
  };
}
