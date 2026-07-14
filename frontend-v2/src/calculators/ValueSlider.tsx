import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
  PanResponder,
  GestureResponderEvent,
} from 'react-native';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  onChange: (v: number) => void;
  testID?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, min: number, max: number, step: number) {
  const snapped = Math.round((n - min) / step) * step + min;
  return clamp(Number(snapped.toFixed(6)), min, max);
}

export function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
  testID,
}: Props) {
  const widthRef = useRef(0);
  const grantXRef = useRef(0);
  const [width, setWidth] = useState(0);

  const ratio = max === min ? 0 : (value - min) / (max - min);
  const fillWidth = width > 0 ? clamp(ratio, 0, 1) * width : 0;
  const thumbLeft = width > 0 ? clamp(ratio, 0, 1) * width - 12 : 0;

  const updateFromX = useCallback(
    (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const t = clamp(x / w, 0, 1);
      onChange(snap(min + t * (max - min), min, max, step));
    },
    [min, max, step, onChange],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          grantXRef.current = e.nativeEvent.locationX;
          updateFromX(grantXRef.current);
        },
        onPanResponderMove: (_e, gesture) => {
          updateFromX(grantXRef.current + gesture.dx);
        },
      }),
    [updateFromX],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{formatValue(value)}</Text>
      <View style={styles.trackWrap} onLayout={onLayout} {...pan.panHandlers}>
        <View style={styles.track} />
        <View style={[styles.fill, { width: fillWidth }]} />
        <View style={[styles.thumb, { left: thumbLeft }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141417',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  label: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
  },
  value: {
    color: '#FAFAFA',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  trackWrap: {
    height: 28,
    justifyContent: 'center',
  },
  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#3F3F46',
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#1A82FF',
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#1A82FF',
    top: 2,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
