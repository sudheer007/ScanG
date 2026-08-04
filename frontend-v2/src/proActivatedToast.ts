import { storage } from '@/src/utils/storage';

const KEY = 'radar.proActivatedToast.pending.v1';

/** In-memory so we can set/consume sync within the same session. */
let pendingMemory: boolean | null = null;

/** Call right after a successful Pro payment verification. */
export function markProJustActivated() {
  pendingMemory = true;
  void storage.setItem(KEY, true);
}

/**
 * Returns true once if a Pro activation toast is pending, then clears the flag.
 * Survives navigation / reload until consumed on the home screen.
 */
export async function consumeProJustActivated(): Promise<boolean> {
  if (pendingMemory === true) {
    pendingMemory = false;
    void storage.removeItem(KEY);
    return true;
  }
  if (pendingMemory === false) return false;

  const stored = await storage.getItem(KEY, false);
  pendingMemory = false;
  if (stored) {
    void storage.removeItem(KEY);
    return true;
  }
  return false;
}
