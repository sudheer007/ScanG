import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectorRow } from '@/src/api';
import { theme } from '@/src/theme';
import SegmentedTabs from '@/src/components/widgets/SegmentedTabs';

export type HeatmapColorMode = 'change' | 'volume' | 'breadth';

function heatValue(sector: SectorRow, mode: HeatmapColorMode): number {
  if (mode === 'volume') return sector.avg_volume_growth_pct ?? 0;
  if (mode === 'breadth') return (sector.breadth_pct ?? 50) - 50;
  return sector.avg_change_pct;
}

export function heatColor(value: number, mode: HeatmapColorMode = 'change'): string {
  let v: number;
  if (mode === 'breadth') {
    v = Math.max(-50, Math.min(50, value)) / 50;
  } else if (mode === 'volume') {
    v = Math.max(-50, Math.min(50, value)) / 50;
  } else {
    v = Math.max(-2.5, Math.min(2.5, value)) / 2.5;
  }
  if (v >= 0) return `rgba(16,185,129,${(0.12 + 0.45 * v).toFixed(3)})`;
  return `rgba(239,68,68,${(0.12 + 0.45 * Math.abs(v)).toFixed(3)})`;
}

function tileFlexBasis(sector: SectorRow, maxCap: number): DimensionValue {
  if (!maxCap || !sector.market_cap_total) return '30%';
  const share = sector.market_cap_total / maxCap;
  const pct = 22 + share * 26;
  return `${Math.round(pct)}%` as DimensionValue;
}

function fmtVolGrowth(v: number | null | undefined): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export default function SectorHeatmap({
  sectors,
  onSelect,
  colorMode = 'change',
  onColorModeChange,
  showColorToggle = false,
}: {
  sectors: SectorRow[];
  onSelect?: (sector: string) => void;
  colorMode?: HeatmapColorMode;
  onColorModeChange?: (mode: HeatmapColorMode) => void;
  showColorToggle?: boolean;
}) {
  if (!sectors || sectors.length === 0) return null;

  const maxCap = Math.max(...sectors.map((s) => s.market_cap_total || 0), 0);

  return (
    <View>
      {showColorToggle && onColorModeChange ? (
        <SegmentedTabs
          testID="heatmap-color-mode"
          options={[
            { value: 'change', label: 'Change' },
            { value: 'volume', label: 'Volume' },
            { value: 'breadth', label: 'Breadth' },
          ]}
          value={colorMode}
          onChange={(v) => onColorModeChange(v as HeatmapColorMode)}
        />
      ) : null}
      <View style={styles.grid}>
        {sectors.map((s) => {
          const pos = s.avg_change_pct >= 0;
          const vol = s.avg_volume_growth_pct;
          const volPos = vol != null && vol > 0;
          const volNeg = vol != null && vol < 0;
          const heatVal = heatValue(s, colorMode);
          return (
            <TouchableOpacity
              key={s.sector}
              activeOpacity={0.8}
              onPress={() => onSelect?.(s.sector)}
              disabled={!onSelect}
              style={[
                styles.tile,
                { backgroundColor: heatColor(heatVal, colorMode), flexBasis: tileFlexBasis(s, maxCap) },
              ]}
              testID={`heat-${s.sector}`}
            >
              <Text style={styles.sector} numberOfLines={2}>{s.sector}</Text>
              <Text style={[styles.pct, { color: pos ? theme.colors.success : theme.colors.error }]}>
                {pos ? '+' : ''}{s.avg_change_pct.toFixed(2)}%
              </Text>
              <View style={styles.volRow}>
                <Ionicons name="bar-chart" size={10} color={theme.colors.textSubtle} />
                <Text style={[
                  styles.vol,
                  volPos && { color: theme.colors.success },
                  volNeg && { color: theme.colors.error },
                ]}>
                  Vol {fmtVolGrowth(vol)}
                </Text>
              </View>
              <View style={styles.breadthRow}>
                <Ionicons name="people" size={10} color={theme.colors.textSubtle} />
                <Text style={styles.breadth}>{s.winners}↑ {s.losers}↓ · {s.stock_count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: theme.spacing.lg },
  tile: {
    flexGrow: 1,
    minWidth: 100,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  sector: { color: theme.colors.text, fontSize: 12, fontWeight: '700', minHeight: 32 },
  pct: { fontSize: 18, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  vol: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  breadthRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  breadth: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '600' },
});
