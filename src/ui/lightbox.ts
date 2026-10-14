import { t } from '../i18n';
import { iconButton } from './icons';

const MAX_ZOOM = 5;
const DOUBLE_TAP_MS = 320;

/**
 * One picture at a time, filling the screen; arrows or swipes for the others.
 * Pinch, double-tap or the mouse wheel zoom into a picture — old group photos
 * are where you want to look closely — and a drag then moves it around.
 */
export function openLightbox(urls: string[], start: number, alt: string): void {
  let index = start;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal lightbox';

  const image = document.createElement('img');
  image.className = 'lightbox-image';
  image.alt = alt;
  // A desktop browser would start dragging the picture instead of swiping it.
  image.draggable = false;
  const counter = document.createElement('p');
  counter.className = 'lightbox-counter';

  // ---- zoom ------------------------------------------------------------------

  /** Scale, and the offset of the picture's centre from where it rests. */
  let zoom = { k: 1, x: 0, y: 0 };
  const paint = () => {
    image.style.transform = zoom.k === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})`;
  };
  /** The picture's resting centre and size, whatever the zoom is now. */
  const rest = () => {
    const box = image.getBoundingClientRect();
    return {
      cx: box.left + box.width / 2 - zoom.x,
      cy: box.top + box.height / 2 - zoom.y,
      width: box.width / zoom.k,
      height: box.height / zoom.k,
    };
  };
  /** Zooms to `k` keeping the point under the screen position `(px, py)` where it is. */
  const zoomAt = (k: number, px: number, py: number) => {
    const { cx, cy, width, height } = rest();
    const next = Math.min(Math.max(k, 1), MAX_ZOOM);
    const ratio = next / zoom.k;
    const sx = px - cx;
    const sy = py - cy;
    zoom = { k: next, x: sx - (sx - zoom.x) * ratio, y: sy - (sy - zoom.y) * ratio };
    clampPan(width, height);
    paint();
  };
  /** However far it is dragged, the picture still covers the middle of the screen. */
  const clampPan = (width: number, height: number) => {
    const maxX = ((zoom.k - 1) * width) / 2;
    const maxY = ((zoom.k - 1) * height) / 2;
    zoom.x = Math.min(Math.max(zoom.x, -maxX), maxX);
    zoom.y = Math.min(Math.max(zoom.y, -maxY), maxY);
  };
  const resetZoom = () => {
    zoom = { k: 1, x: 0, y: 0 };
    paint();
  };

  const show = (next: number) => {
    index = (next + urls.length) % urls.length;
    resetZoom();
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
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight') show(index + 1);
    });
  }

  // ---- gestures --------------------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  /** Where a one-finger gesture began, for the swipe; dropped once it turns into something else. */
  let swipeFrom: number | undefined;
  let lastTap = 0;

  image.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      image.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; the gesture still works.
    }
    if (pointers.size === 2) {
      pinch = spread(pointers);
      swipeFrom = undefined;
    } else {
      swipeFrom = zoom.k === 1 && urls.length > 1 ? event.clientX : undefined;
    }
  });

  image.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const distance = spread(pointers);
      const [a, b] = [...pointers.values()];
      if (pinch > 0 && a && b) zoomAt((zoom.k * distance) / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = distance;
    } else if (zoom.k > 1) {
      const { width, height } = rest();
      zoom.x += event.clientX - previous.x;
      zoom.y += event.clientY - previous.y;
      clampPan(width, height);
      paint();
    }
  });

  const release = (event: PointerEvent) => {
    const from = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size > 0 || !from) return;
    pinch = 0;
    if (swipeFrom !== undefined) {
      const dx = event.clientX - swipeFrom;
      swipeFrom = undefined;
      if (Math.abs(dx) > 40) {
        show(index + (dx < 0 ? 1 : -1));
        return;
      }
    }
    // A double tap zooms in where it landed, or back out.
    if (event.timeStamp - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      if (zoom.k > 1) resetZoom();
      else zoomAt(2.5, event.clientX, event.clientY);
    } else {
      lastTap = event.timeStamp;
    }
  };
  image.addEventListener('pointerup', release);
  image.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    pinch = 0;
    swipeFrom = undefined;
  });

  image.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoomAt(zoom.k * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), event.clientX, event.clientY);
    },
    { passive: false },
  );

  // A tap beside the picture closes it, like everywhere else.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  show(start);
  document.body.append(dialog);
  dialog.showModal();
}

function spread(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}
