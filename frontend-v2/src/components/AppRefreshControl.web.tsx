import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  ActivityIndicator,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/src/theme';

type Props = {
  refreshing: boolean;
  onRefresh?: () => void;
  tintColor?: string;
  colors?: string[];
  enabled?: boolean;
  progressViewOffset?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactElement;
  title?: string;
  titleColor?: string;
};

const PULL_THRESHOLD = 64;
const INDICATOR_H = 44;
const ARM_DY = 10;

function isVerticallyScrollable(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const oy = style.overflowY;
  if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
  // Skip mostly-horizontal scrollers (chip rows, tables).
  const ox = style.overflowX;
  if ((ox === 'auto' || ox === 'scroll' || ox === 'overlay') && el.scrollWidth > el.clientWidth + 1) {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
  }
  return true;
}

/** Largest vertical overflow scroller under the RefreshControl wrapper. */
function findScrollElement(container: View | null): HTMLElement | null {
  const root = container as unknown as HTMLElement | null;
  if (!root || typeof document === 'undefined') return null;

  let best: HTMLElement | null = null;
  let bestArea = -1;

  const walk = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    if (isVerticallyScrollable(el)) {
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    for (let i = 0; i < el.children.length; i += 1) walk(el.children[i]);
  };

  walk(root);
  return best;
}

function readScrollTop(scrollEl: HTMLElement | null): number {
  if (!scrollEl) return Number.POSITIVE_INFINITY;
  return Math.max(scrollEl.scrollTop, 0);
}

/**
 * Web pull-to-refresh — RN Web's RefreshControl is a no-op stub.
 * ScrollView clones this around itself; we own the overscroll gesture.
 *
 * Uses native touch listeners on the scroll node (not PanResponder) so
 * normal mid-page scrolling never arms refresh — only pull-down at scrollTop 0.
 */
export default function AppRefreshControl({
  refreshing,
  onRefresh,
  tintColor = theme.colors.text,
  colors,
  style,
  progressViewOffset = 0,
  children,
  enabled = true,
  title,
  titleColor = theme.colors.textMuted,
}: Props) {
  const onRefreshRef = useRef(onRefresh);
  const enabledRef = useRef(enabled);
  const refreshingRef = useRef(refreshing);
  const containerRef = useRef<View>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const pullReached = useRef(false);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const pullingRef = useRef(false);
  const pullDyRef = useRef(0);

  const pullAnim = useRef(new Animated.Value(0)).current;
  const arrowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    Animated.timing(pullAnim, {
      toValue: refreshing ? INDICATOR_H : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
    if (refreshing) {
      pullReached.current = false;
      pullingRef.current = false;
      pullDyRef.current = 0;
      arrowAnim.setValue(0);
    }
  }, [refreshing, pullAnim, arrowAnim]);

  const setPullVisual = useCallback(
    (dy: number) => {
      const damped = dy <= 0 ? 0 : (dy * 140) / (dy + 110);
      pullDyRef.current = damped;
      pullAnim.setValue(damped);
      const next = damped > PULL_THRESHOLD;
      if (next !== pullReached.current) {
        pullReached.current = next;
        Animated.timing(arrowAnim, {
          toValue: next ? 1 : 0,
          duration: 120,
          useNativeDriver: false,
        }).start();
      }
    },
    [arrowAnim, pullAnim],
  );

  const resetPullVisual = useCallback(() => {
    pullingRef.current = false;
    pullReached.current = false;
    pullDyRef.current = 0;
    Animated.timing(pullAnim, {
      toValue: refreshingRef.current ? INDICATOR_H : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
    arrowAnim.setValue(0);
  }, [arrowAnim, pullAnim]);

  const finishGesture = useCallback(() => {
    if (!pullingRef.current) {
      resetPullVisual();
      return;
    }
    const shouldRefresh = pullReached.current && !!onRefreshRef.current;
    pullingRef.current = false;
    if (shouldRefresh) {
      pullReached.current = false;
      onRefreshRef.current?.();
      return;
    }
    resetPullVisual();
  }, [resetPullVisual]);

  // Bind touch listeners directly to the vertical scroller.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    let cancelled = false;
    let scrollEl: HTMLElement | null = null;
    let bound = false;
    let raf = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current || refreshingRef.current) return;
      if (e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      startScrollTopRef.current = readScrollTop(scrollElRef.current);
      pullingRef.current = false;
      pullReached.current = false;
      pullDyRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!enabledRef.current || refreshingRef.current) return;
      if (e.touches.length !== 1) return;
      const el = scrollElRef.current;
      if (!el) return;

      const y = e.touches[0].clientY;
      const dy = y - startYRef.current;
      const scrollTop = readScrollTop(el);

      // Must begin at top; leave pull mode if the list scrolls away from top.
      if (startScrollTopRef.current > 1 || scrollTop > 1) {
        if (pullingRef.current) resetPullVisual();
        return;
      }

      // Finger moving up → normal scroll, never refresh.
      if (dy <= ARM_DY) {
        if (pullingRef.current) resetPullVisual();
        return;
      }

      // At top + pulling down → own the gesture so the page doesn't rubber-band.
      pullingRef.current = true;
      if (e.cancelable) e.preventDefault();
      setPullVisual(dy);
    };

    const onTouchEnd = () => {
      if (pullingRef.current || pullDyRef.current > 0) finishGesture();
    };

    const bind = (el: HTMLElement) => {
      if (bound && scrollEl === el) return;
      if (scrollEl && bound) {
        scrollEl.removeEventListener('touchstart', onTouchStart);
        scrollEl.removeEventListener('touchmove', onTouchMove);
        scrollEl.removeEventListener('touchend', onTouchEnd);
        scrollEl.removeEventListener('touchcancel', onTouchEnd);
      }
      scrollEl = el;
      scrollElRef.current = el;
      // Stop browser native PTR from fighting our gesture on mobile Chrome.
      el.style.overscrollBehaviorY = 'contain';
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd);
      el.addEventListener('touchcancel', onTouchEnd);
      bound = true;
    };

    const unbind = () => {
      if (!scrollEl || !bound) return;
      scrollEl.removeEventListener('touchstart', onTouchStart);
      scrollEl.removeEventListener('touchmove', onTouchMove);
      scrollEl.removeEventListener('touchend', onTouchEnd);
      scrollEl.removeEventListener('touchcancel', onTouchEnd);
      bound = false;
      scrollEl = null;
      scrollElRef.current = null;
    };

    const tryAttach = () => {
      if (cancelled) return;
      const found = findScrollElement(containerRef.current);
      if (found) {
        bind(found);
        return;
      }
      // ScrollView may mount a frame later after cloneElement.
      raf = window.requestAnimationFrame(tryAttach);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      unbind();
    };
  }, [finishGesture, resetPullVisual, setPullVisual]);

  const color = tintColor || colors?.[0] || theme.colors.text;

  const outerStyle = useMemo(
    () => [
      style,
      styles.outer,
      progressViewOffset ? { paddingTop: progressViewOffset } : null,
    ],
    [style, progressViewOffset],
  );

  const indicatorStyle = useMemo(
    () => [
      styles.indicator,
      {
        transform: [{ translateY: pullAnim }],
      },
    ],
    [pullAnim],
  );

  const contentStyle = useMemo(
    () => [{ flex: 1, minHeight: 0, transform: [{ translateY: pullAnim }] }],
    [pullAnim],
  );

  const arrowRotate = arrowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View ref={containerRef} style={outerStyle}>
      <Animated.View style={indicatorStyle} pointerEvents="none">
        {refreshing ? (
          <View style={styles.row}>
            <ActivityIndicator color={color} size="small" />
            {title ? <Text style={[styles.title, { color: titleColor }]}>{title}</Text> : null}
          </View>
        ) : (
          <Animated.View style={{ transform: [{ rotate: arrowRotate }] }}>
            <Ionicons name="refresh" size={22} color={color} />
          </Animated.View>
        )}
      </Animated.View>
      <Animated.View style={contentStyle}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    overflow: 'hidden',
    flex: 1,
  },
  indicator: {
    alignSelf: 'center',
    marginTop: -INDICATOR_H,
    height: INDICATOR_H,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '500',
  },
});
