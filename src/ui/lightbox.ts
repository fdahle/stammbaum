import { t } from '../i18n';
import { iconButton } from './icons';

/** One picture at a time, filling the screen; arrows or swipes for the others. */
export function openLightbox(urls: string[], start: number, alt: string): void {
  let index = start;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal lightbox';

  const image = document.createElement('img');
  image.className = 'lightbox-image';
  image.alt = alt;
  const counter = document.createElement('p');
  counter.className = 'lightbox-counter';

  const show = (next: number) => {
    index = (next + urls.length) % urls.length;
    image.src = urls[index]!;
    counter.textContent = urls.length > 1 ? t().photo(index + 1, urls.length) : '';
  };

  const close = iconButton('close', t().close);
  close.classList.add('lightbox-close');
  close.addEventListener('click', () => dialog.close());
  dialog.append(image, counter, close);

  if (urls.length > 1) {
    const previous = iconButton('previous', t().previousPhoto);
    const next = iconButton('next', t().nextPhoto);
    previous.classList.add('lightbox-previous');
    next.classList.add('lightbox-next');
    previous.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));
    dialog.append(previous, next);

    let startX: number | undefined;
    image.addEventListener('pointerdown', (event) => (startX = event.clientX));
    image.addEventListener('pointerup', (event) => {
      if (startX === undefined) return;
      const dx = event.clientX - startX;
      startX = undefined;
      if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight') show(index + 1);
    });
  }

  // A tap beside the picture closes it, like everywhere else.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  show(start);
  document.body.append(dialog);
  dialog.showModal();
}
