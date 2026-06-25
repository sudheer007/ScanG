import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectorRow } from '@/src/api';
import { theme } from '@/src/theme';

function heatColor(pct: number): string {
  const v = Math.max(-2.5, Math.min(2.5, pct)) / 2.5; // -1..1
  if (v >= 0) return `rgba(16,185,129,${(0.12 + 0.45 * v).toFixed(3)})`;
  return `rgba(239,68,68,${(0.12 + 0.45 * Math.abs(v)).toFixed(3)})`;
}

export default function SectorHeatmap({
  sectors,
  onSelect,
}: {
  sectors: SectorRow[];
  onSelect?: (sector: string) => void;
}) {
  if (!sectors || sectors.length === 0) return null;
  return (
    <View style={styles.grid}>
      {sectors.map((s) => {
        const pos = s.avg_change_pct >= 0;
        return (
          <TouchableOpacity
            key={s.sector}
            activeOpacity={0.8}
            onPress={() => onSelect?.(s.sector)}
            disabled={!onSelect}
            style={[styles.tile, { backgroundColor: heatColor(s.avg_change_pct) }]}
            testID={`heat-${s.sector}`}
          >
            <Text style={styles.sector} numberOfLines={2}>{s.sector}</Text>
            <Text style={[styles.pct, { color: pos ? theme.colors.success : theme.colors.error }]}>
              {pos ? '+' : ''}{s.avg_change_pct.toFixed(2)}%
            </Text>
            <View style={styles.breadthRow}>
              <Ionicons name="people" size={10} color={theme.colors.textSubtle} />
              <Text style={styles.breadth}>{s.winners}↑ {s.losers}↓ · {s.stock_count}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: theme.spacing.lg },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  sector: { color: theme.colors.text, fontSize: 12, fontWeight: '700', minHeight: 32 },
  pct: { fontSize: 18, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] },
  breadthRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  breadth: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '600' },
});
