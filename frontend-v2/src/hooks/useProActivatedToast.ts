import { useCallback, useEffect, useState } from 'react';

import { useEntitlement } from '@/src/hooks/useEntitlement';

/** Resets on full page reload / cold app start — once per open, not forever. */
let shownThisSession = false;

/**
 * Shows the "Pro activated" toast once per website/app open when the user is premium
 * and lands on the home (Markets) screen.
 */
export function useProActivatedToast() {
  const { isPremium, hydrated } = useEntitlement();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hydrated || !isPremium || shownThisSession) return;
    shownThisSession = true;
    setVisible(true);
  }, [hydrated, isPremium]);

  const dismiss = useCallback(() => setVisible(false), []);

  return { visible, dismiss };
}
