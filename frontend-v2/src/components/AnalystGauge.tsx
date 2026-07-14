import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/src/theme';

interface Props {
  mean?: number | null;   // 1 = Strong Buy ... 5 = Strong Sell
  count?: number | null;  // analyst count
  width?: number;
}

// Map recommendation mean to a label + color.
function rating(mean: number) {
  if (mean <= 1.5) return { label: 'Strong Buy', color: '#10B981' };
  if (mean <= 2.5) return { label: 'Buy', color: '#34D399' };
  if (mean <= 3.5) return { label: 'Hold', color: '#F59E0B' };
  if (mean <= 4.5) return { label: 'Sell', color: '#F97316' };
  return { label: 'Strong Sell', color: '#EF4444' };
}

const TRACK = 96;
const MARKER = 12;

export default function AnalystGauge({ mean, count, width = TRACK }: Props) {
  if (mean === null || mean === undefined || Number.isNaN(mean)) {
    return (
      <View style={{ width, alignItems: 'flex-end' }}>
        <Text style={styles.none}>No coverage</Text>
      </View>
    );
  }
  const { label, color } = rating(mean);
  // 1 (buy) -> right/green end, 5 (sell) -> left/red end
  const frac = Math.max(0, Math.min(1, (5 - mean) / 4));
  const trackW = width;
  const x = frac * (trackW - MARKER);

  return (
    <View style={{ width, alignItems: 'flex-end' }}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color }]} numberOfLines={1}>{label}</Text>
        {count ? <Text style={styles.count}>{count}</Text> : null}
      </View>
      <View style={[styles.track, { width: trackW }]}>
        <LinearGradient
          colors={['#EF4444', '#F59E0B', '#10B981']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.marker, { left: x, borderColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  count: { color: theme.colors.textSubtle, fontSize: 9, fontWeight: '600' },
  none: { color: theme.colors.textSubtle, fontSize: 10, fontStyle: 'italic' },
  track: { height: 6, borderRadius: 3, backgroundColor: theme.colors.bg3, overflow: 'visible', justifyContent: 'center' },
  marker: {
    position: 'absolute',
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    backgroundColor: theme.colors.text,
    borderWidth: 2,
    top: -3,
  },
});
