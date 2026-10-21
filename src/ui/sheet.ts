import { t } from '../i18n';
import { closeOnBack } from './back';
import { iconButton } from './icons';

export interface Sheet {
  /** Where the content goes. */
  body: HTMLElement;
  /** The title, for a sheet that changes what it is about. */
  heading: HTMLElement;
  close(): void;
}

/**
 * A titled sheet over the page: from the bottom on a phone, a dialog on a
 * desktop — the same shape as the person picker. Gone from the page once closed.
 */
export function openSheet(title: string, onClose?: () => void): Sheet {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal-bottom sm:modal-middle';
  const box = document.createElement('div');
  box.className = 'modal-box sheet';

  const header = document.createElement('div');
  header.className = 'picker-header';
  const heading = document.createElement('h2');
  heading.className = 'picker-title';
  heading.textContent = title;
  const close = iconButton('close', t().close);
  close.classList.add('btn-sm');
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);

  const body = document.createElement('div');
  body.className = 'sheet-body';
  box.append(header, body);

  const backdrop = document.createElement('form');
  backdrop.method = 'dialog';
  backdrop.className = 'modal-backdrop';
  const dismiss = document.createElement('button');
  dismiss.textContent = t().close;
  backdrop.append(dismiss);

  dialog.append(box, backdrop);
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  closeOnBack(dialog);
  return { body, heading, close: () => dialog.close() };
}

/** A row of buttons at the end of a sheet; the first is the one that matters. */
export function sheetActions(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sheet-actions';
  row.append(...buttons);
  return row;
}

export function button(label: string, className: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn btn-sm ${className}`;
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}
