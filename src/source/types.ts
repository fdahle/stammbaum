/**
 * Where the family comes from. The hosted app reads family.md live from the
 * server and can change it (`live.ts`); the single file mailed around carries
 * a copy from the day it was built and cannot (`bundled.ts`). Vite picks one
 * as `@source` — see vite.config.ts.
 */
export interface FamilySource {
  markdown: string;
  /** Picture URLs by lower-case file name. */
  photos: Map<string, string>;
  /** Small versions for the bubbles, by the same names — not every photo has one. */
  thumbs: Map<string, string>;
  /** Changes with every edit, to notice someone else's. */
  version: string;
  /** How current this copy is: when the file last changed, or the family commit it was built from. */
  stamp: { updated?: string; commit?: string };
  /** Whether whoever is looking may change the family. */
  editable: boolean;
}

export interface Saved {
  source: FamilySource;
  /** The ids given to people added under a `$ref`. */
  created: Record<string, string>;
  /** Old id → new id, for everyone whose id changed. */
  renamed: Record<string, string>;
}

/** The server does not take this kind of picture — one the browser could not turn into a JPEG. */
export class UnsupportedImage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedImage';
  }
}

/** Someone else changed the same thing first; `source` is the family as it is now. */
export class SaveConflict extends Error {
  constructor(
    readonly source: FamilySource,
    message: string,
  ) {
    super(message);
    this.name = 'SaveConflict';
  }
}
