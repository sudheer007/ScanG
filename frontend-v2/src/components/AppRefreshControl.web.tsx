import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  PanResponder,
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

const PULL_THRESHOLD = 56;
const INDICATOR_H = 44;

/** Find the overflow-scrolling DOM node under the RefreshControl wrapper. */
function readScrollTop(container: View | null): number {
  const root = container as unknown as HTMLElement | null;
  if (!root || typeof document === 'undefined') return 0;

  const walk = (el: Element | null): number | null => {
    if (!el || !(el instanceof HTMLElement)) return null;
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
      return el.scrollTop;
    }
    for (let i = 0; i < el.children.length; i += 1) {
      const found = walk(el.children[i]);
      if (found !== null) return found;
    }
    return null;
  };

  return walk(root) ?? 0;
}

/**
 * Web pull-to-refresh — RN Web's RefreshControl is a no-op stub.
 * ScrollView clones this around itself; we own the overscroll gesture.
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
  const containerRef = useRef<View>(null);
  const pullReached = useRef(0);

  const pullAnim = useRef(new Animated.Value(0)).current;
  const arrowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    Animated.timing(pullAnim, {
      toValue: refreshing ? INDICATOR_H : 0,
      duration: 280,
      useNativeDriver: false,
    }).start();
    if (refreshing) {
      pullReached.current = 0;
      arrowAnim.setValue(0);
    }
  }, [refreshing, pullAnim, arrowAnim]);

  const finishGesture = useCallback(() => {
    if (pullReached.current && onRefreshRef.current) {
      onRefreshRef.current();
      return;
    }
    Animated.timing(pullAnim, {
      toValue: 0,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [pullAnim]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) => {
          if (enabledRef.current === false || refreshing) return false;
          if (readScrollTop(containerRef.current) > 1) return false;
          return (
            Math.abs(g.dy) > Math.abs(g.dx) * 2 &&
            Math.abs(g.vy) > Math.abs(g.vx) * 2 &&
            g.dy > 4
          );
        },
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderMove: (_, g) => {
          if (enabledRef.current === false) return;
          const dy = g.dy <= 0 ? 0 : (g.dy * 140) / (g.dy + 110);
          pullAnim.setValue(dy);
          const next = dy > PULL_THRESHOLD ? 1 : 0;
          if (next !== pullReached.current) {
            pullReached.current = next;
            Animated.timing(arrowAnim, {
              toValue: next,
              duration: 140,
              useNativeDriver: false,
            }).start();
          }
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: finishGesture,
        onPanResponderTerminate: finishGesture,
      }),
    [arrowAnim, finishGesture, pullAnim, refreshing],
  );

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
    <View ref={containerRef} style={outerStyle} {...panResponder.panHandlers}>
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
