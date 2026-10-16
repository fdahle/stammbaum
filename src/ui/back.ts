/**
 * The phone's back button closes whatever sheet is open instead of leaving
 * the page under it. Every dialog gets a history entry of its own, at the
 * same address; going back closes the newest dialog, and a dialog closed any
 * other way takes its entry back out again.
 */

/** Dialogs with an entry of their own, oldest first. */
const entries: HTMLDialogElement[] = [];
/** Steps back asked for here that have not arrived yet. */
let returning = 0;
/** Where the page was when stepping back — a rename may have changed it meanwhile. */
let address = '';
/** A page to go to once those steps have arrived. */
let then: string | undefined;

/** Gives `dialog` a history entry, so that Back closes it. Call it as the dialog opens. */
export function closeOnBack(dialog: HTMLDialogElement): void {
  // A sheet that just closed to make way for this one hands its entry over.
  const spent = entries.findIndex((entry) => !entry.open);
  if (spent >= 0) {
    entries.splice(spent, 1);
  } else {
    try {
      history.pushState({ sheet: true }, '');
    } catch {
      // A page opened from a file may not be allowed to; Back then leaves it.
      return;
    }
  }
  entries.push(dialog);
  dialog.addEventListener('close', settle);
}

/**
 * Goes to `hash` — after the entries of any sheet that just closed are gone,
 * so the new page is not stepped back over again.
 */
export function navigate(hash: string): void {
  settle();
  if (returning > 0) then = hash;
  else location.hash = hash;
}

/** Takes the entries of closed dialogs back out. */
function settle(): void {
  let steps = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.open) continue;
    entries.splice(i, 1);
    steps++;
  }
  if (steps === 0) return;
  // A link followed from the sheet put a page on top; its entry stays behind that.
  if ((history.state as { sheet?: boolean } | null)?.sheet !== true) return;
  returning++;
  address = location.href;
  history.go(-steps);
}

window.addEventListener('popstate', () => {
  if (returning > 0) {
    returning--;
    if (location.href !== address) history.replaceState(history.state, '', address);
    if (returning === 0 && then !== undefined) {
      const hash = then;
      then = undefined;
      location.hash = hash;
    }
    return;
  }
  // Back by hand: the newest dialog closes, and the page stays.
  entries.pop()?.close();
});
