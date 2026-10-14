import type { Person } from '../parser/types';
import { personValue, type Changes, type PersonField } from '../parser/write';

/** Long side of an uploaded picture: plenty for the card and the lightbox, small for a phone's data plan. */
const MAX_SIDE = 1600;

/** Asks for pictures from the device — the camera roll on a phone. Empty when nothing was chosen. */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/**
 * A phone's photo, turned upright, at most MAX_SIDE across and as a JPEG —
 * which also leaves behind what the camera wrote into it, such as where it
 * was taken. A GIF stays as it is, and so does anything the browser cannot
 * draw; the server says whether it takes it.
 */
export async function shrink(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    // A transparent PNG would turn black as a JPEG.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Every picture of someone, the portrait first. */
export function photoNames(person: Person): string[] {
  return [...new Set([person.photo, ...(person.photos ?? [])].filter((name): name is string => !!name))];
}

/**
 * The change that gives `person` exactly `names`: the first becomes the
 * portrait, the rest the gallery. Only what differs, with what it was.
 */
export function photoChanges(person: Person, names: string[]): { set: Changes<PersonField>; was: Changes<PersonField> } {
  const [portrait, ...rest] = names;
  const wanted: Record<'photo' | 'photos', string | null> = {
    photo: portrait ?? null,
    photos: rest.length > 0 ? rest.join(', ') : null,
  };
  const set: Changes<PersonField> = {};
  const was: Changes<PersonField> = {};
  for (const key of ['photo', 'photos'] as const) {
    const before = personValue(person, key) ?? null;
    if (wanted[key] !== before) {
      set[key] = wanted[key];
      was[key] = before;
    }
  }
  return { set, was };
}
