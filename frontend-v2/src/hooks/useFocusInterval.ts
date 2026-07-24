import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Run `tick` while the screen is focused, on an interval.
 * Clears automatically on blur / unmount.
 */
export function useFocusInterval(
  tick: () => void | Promise<void>,
  intervalMs: number,
  options?: { immediate?: boolean },
) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const immediate = options?.immediate ?? false;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const run = () => {
        if (!cancelled) void tickRef.current();
      };
      if (immediate) run();
      const id = setInterval(run, intervalMs);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }, [intervalMs, immediate]),
  );
}
