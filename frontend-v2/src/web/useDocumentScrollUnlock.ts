import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Walk up from each [data-page-scroll] node and unlock overflow/height so the
 * document (html/body) becomes the scroll root — required for Chrome's
 * address-bar pull-to-refresh. Skips horizontal chip/tab scrolers.
 */
export function useDocumentScrollUnlock() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const unlock = () => {
      document.querySelectorAll('[data-page-scroll="true"]').forEach((el) => {
        let node = el.parentElement;
        while (node && node !== document.documentElement) {
          const style = window.getComputedStyle(node);
          const oy = style.overflowY;
          if (oy === 'hidden' || oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
            // Keep intentional horizontal-only scrollports.
            const ox = style.overflowX;
            const horizontalOnly =
              (ox === 'auto' || ox === 'scroll' || ox === 'overlay') &&
              node.scrollWidth > node.clientWidth + 1 &&
              node.scrollHeight <= node.clientHeight + 1;
            if (!horizontalOnly) {
              node.style.setProperty('overflow-y', 'visible', 'important');
              node.style.setProperty('max-height', 'none', 'important');
              node.style.setProperty('height', 'auto', 'important');
            }
          }
          node = node.parentElement;
        }
      });

      document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
      document.documentElement.style.setProperty('height', 'auto', 'important');
      document.documentElement.style.setProperty('overscroll-behavior-y', 'auto', 'important');
      document.body.style.setProperty('overflow-y', 'auto', 'important');
      document.body.style.setProperty('height', 'auto', 'important');
      document.body.style.setProperty('overscroll-behavior-y', 'auto', 'important');
    };

    unlock();
    const mo = new MutationObserver(() => unlock());
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', unlock);
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', unlock);
    };
  }, []);
}
