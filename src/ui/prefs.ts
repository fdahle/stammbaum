import { readStored, writeStored } from './storage';

const CAUSES = 'stammbaum-causes';

/**
 * Whether causes of death are shown on this device — on the person's page
 * and in the editor. Off, say, on the tablet the children use.
 */
export function showsCauses(): boolean {
  return readStored(CAUSES) !== 'hide';
}

export function setShowsCauses(on: boolean): void {
  writeStored(CAUSES, on ? null : 'hide');
}
