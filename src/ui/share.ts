import { t } from '../i18n';
import { closeOnBack } from './back';
import { iconButton } from './icons';
import { qrSvg } from './qr';

/**
 * Whether a QR code would lead anywhere: a page opened from a file or a mail
 * attachment has no address another phone could reach.
 */
export function canShare(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

/**
 * The current page as a QR code, so the person you are talking to can scan it
 * and look at the same thing on their own phone.
 */
export function openShare(url: string): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal-bottom sm:modal-middle';
  const box = document.createElement('div');
  box.className = 'modal-box share';

  const header = document.createElement('div');
  header.className = 'picker-header';
  const title = document.createElement('h2');
  title.className = 'picker-title';
  title.textContent = t().shareTitle;
  const close = iconButton('close', t().close);
  close.classList.add('btn-sm');
  close.addEventListener('click', () => dialog.close());
  header.append(title, close);

  const code = qrSvg(url);
  code.setAttribute('class', 'share-code');
  code.setAttribute('role', 'img');
  code.setAttribute('aria-label', url);

  const hint = document.createElement('p');
  hint.className = 'picker-hint';
  hint.textContent = t().shareHint;
  const address = document.createElement('p');
  address.className = 'share-url';
  address.textContent = url;
  box.append(header, code, hint, address);

  // The clipboard is only there on https and localhost.
  if (navigator.clipboard) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-soft btn-primary btn-sm';
    copy.textContent = t().copyLink;
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(
        () => (copy.textContent = t().copied),
        () => undefined,
      );
    });
    box.append(copy);
  }

  const backdrop = document.createElement('form');
  backdrop.method = 'dialog';
  backdrop.className = 'modal-backdrop';
  const dismiss = document.createElement('button');
  dismiss.textContent = t().close;
  backdrop.append(dismiss);

  dialog.append(box, backdrop);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  closeOnBack(dialog);
}
