/**
 * localStorage that never throws: private windows, blocked site data and
 * embedded previews all make it unavailable, and the app has to work anyway.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do — the choice is simply not remembered.
  }
}
