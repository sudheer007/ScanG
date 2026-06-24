import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

interface Props {
  label: string;
  value: number; // 0-100
  tone?: 'pos' | 'neg' | 'neutral';
}

export default function ScoreBar({ label, value, tone }: Props) {
  const color =
    tone === 'neg' ? theme.colors.error :
    tone === 'pos' ? theme.colors.success :
    value >= 70 ? theme.colors.success :
    value >= 45 ? theme.colors.warning :
    theme.colors.error;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.val, { color }]}>{value.toFixed(0)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
  label: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600', width: 80 },
  track: { flex: 1, height: 6, backgroundColor: theme.colors.bg3, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  val: { width: 32, textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
