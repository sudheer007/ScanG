import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useEntitlement } from '@/src/hooks/useEntitlement';
import { consumeProJustActivated } from '@/src/proActivatedToast';

/**
 * Shows "Pro activated" only once after a successful payment,
 * when the user lands on / focuses the home (Markets) screen.
 */
export function useProActivatedToast() {
  const { isPremium, hydrated } = useEntitlement();
  const [visible, setVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!hydrated || !isPremium) return;
      let cancelled = false;
      (async () => {
        const pending = await consumeProJustActivated();
        if (!cancelled && pending) setVisible(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [hydrated, isPremium]),
  );

  const dismiss = useCallback(() => setVisible(false), []);

  return { visible, dismiss };
}
