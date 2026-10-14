import { t } from '../i18n';
import { button, openSheet, sheetActions } from '../ui/sheet';

/** Size of a cropped portrait — the bubble is far smaller, the card a little. */
const OUT = 800;
/** How far in the slider zooms, beyond just covering the circle. */
const MAX_ZOOM = 5;

/**
 * Lets someone pick the part of `image` that shows in the round bubble: drag
 * to move, the slider, the wheel or two fingers to zoom. Resolves to the
 * square around the circle as a JPEG, to `'whole'` for the picture as it is,
 * or to `undefined` when the sheet was closed.
 */
export async function cropImage(image: Blob): Promise<Blob | 'whole' | undefined> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  } catch {
    // Nothing the browser can draw: the server decides what to make of it.
    return 'whole';
  }

  return new Promise((resolve) => {
    let result: Blob | 'whole' | undefined;
    const sheet = openSheet(t().cropTitle, () => {
      bitmap.close();
      resolve(result);
    });

    // The picture is drawn on a canvas, upright whatever the camera wrote.
    const stage = document.createElement('div');
    stage.className = 'crop-stage';
    const canvas = document.createElement('canvas');
    // On screen at most 1600 across: a camera's full size is a lot to move around.
    const shown = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * shown);
    canvas.height = Math.round(bitmap.height * shown);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    canvas.className = 'crop-image';
    const ring = document.createElement('div');
    ring.className = 'crop-ring';
    stage.append(canvas, ring);

    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.className = 'range range-sm range-primary w-full';
    zoom.min = '1';
    zoom.max = String(MAX_ZOOM);
    zoom.step = '0.01';
    zoom.value = '1';
    zoom.setAttribute('aria-label', t().cropZoom);
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = t().cropHint;

    // Where the picture sits in the stage: its top-left corner and its scale.
    let size = 0;
    let base = 1;
    let view = { x: 0, y: 0, k: 1 };
    const clampView = () => {
      view.x = Math.min(0, Math.max(size - bitmap.width * view.k, view.x));
      view.y = Math.min(0, Math.max(size - bitmap.height * view.k, view.y));
    };
    const paint = () => {
      clampView();
      canvas.style.width = `${bitmap.width * view.k}px`;
      canvas.style.transform = `translate(${view.x}px, ${view.y}px)`;
    };
    const zoomTo = (factor: number, cx = size / 2, cy = size / 2) => {
      const k = base * Math.min(MAX_ZOOM, Math.max(1, factor));
      view = { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
      zoom.value = String(k / base);
      paint();
    };
    const fit = () => {
      size = stage.clientWidth;
      if (size === 0) return;
      // Just covering the circle, the middle of the picture in it.
      base = size / Math.min(bitmap.width, bitmap.height);
      view = { k: base, x: (size - bitmap.width * base) / 2, y: (size - bitmap.height * base) / 2 };
      zoom.value = '1';
      paint();
    };

    zoom.addEventListener('input', () => zoomTo(Number(zoom.value)));
    stage.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const box = stage.getBoundingClientRect();
        zoomTo((view.k / base) * Math.exp(-event.deltaY * 0.002), event.clientX - box.left, event.clientY - box.top);
      },
      { passive: false },
    );
    const pointers = new Map<number, { x: number; y: number }>();
    let spread = 0;
    stage.addEventListener('pointerdown', (event) => {
      stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      spread = 0;
    });
    stage.addEventListener('pointermove', (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const next = Math.hypot(a.x - b.x, a.y - b.y);
        const box = stage.getBoundingClientRect();
        if (spread > 0) zoomTo((view.k / base) * (next / spread), (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
        spread = next;
        return;
      }
      view.x += event.clientX - previous.x;
      view.y += event.clientY - previous.y;
      paint();
    });
    const release = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      spread = 0;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    const use = button(t().cropUse, 'btn-primary', () => {
      // The square around the circle, in the picture's own pixels.
      const side = size / view.k;
      const out = Math.round(Math.min(OUT, side));
      const square = document.createElement('canvas');
      square.width = out;
      square.height = out;
      const context = square.getContext('2d');
      if (!context) return;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, out, out);
      context.drawImage(bitmap, -view.x / view.k, -view.y / view.k, side, side, 0, 0, out, out);
      square.toBlob((blob) => {
        result = blob ?? 'whole';
        sheet.close();
      }, 'image/jpeg', 0.9);
    });
    const whole = button(t().cropWhole, 'btn-ghost', () => {
      result = 'whole';
      sheet.close();
    });
    sheet.body.append(stage, zoom, hint, sheetActions(use, whole));
    // Measured once it is on screen.
    requestAnimationFrame(fit);
  });
}
