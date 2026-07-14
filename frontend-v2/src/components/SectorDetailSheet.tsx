import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { SectorRow, Market } from '@/src/api';
import { theme, fmtPct, fmtMarketCap, changeColor } from '@/src/theme';
import { screenerSectorPref } from '@/src/storage-keys';

interface Props {
  open: boolean;
  sector: SectorRow | null;
  market: Market;
  currency: string;
  onClose: () => void;
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

export default function SectorDetailSheet({ open, sector, market, currency, onClose }: Props) {
  const router = useRouter();
  if (!sector) return null;

  const volGrowth = sector.avg_volume_growth_pct;
  const volLabel = volGrowth != null
    ? `${volGrowth > 0 ? '+' : ''}${volGrowth.toFixed(1)}%`
    : '—';

  const goStock = (sym: string) => {
    onClose();
    router.push({ pathname: '/stock/[symbol]', params: { symbol: sym } });
  };

  const goScreener = async () => {
    await screenerSectorPref.set(sector.sector, market);
    onClose();
    router.push('/(tabs)/screener');
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{sector.sector}</Text>
              <Text style={styles.subtitle}>{sector.stock_count} stocks · {market}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="sector-sheet-close">
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <StatRow
              label="Avg change"
              value={fmtPct(sector.avg_change_pct)}
              color={changeColor(sector.avg_change_pct)}
            />
            <StatRow
              label="Breadth"
              value={`${sector.breadth_pct?.toFixed(0) ?? '—'}% advancing`}
              color={(sector.breadth_pct ?? 0) >= 50 ? theme.colors.success : theme.colors.error}
            />
            <StatRow
              label="Volume vs avg"
              value={volLabel}
              color={changeColor(volGrowth)}
            />
            <StatRow
              label="Volume breadth"
              value={sector.volume_breadth_pct != null
                ? `${sector.volume_breadth_pct.toFixed(0)}% elevated (${sector.high_volume_count ?? 0} stocks)`
                : '—'}
            />
            <StatRow
              label="Market cap"
              value={fmtMarketCap(sector.market_cap_total, currency)}
            />
            <StatRow label="Winners / Losers" value={`${sector.winners}↑ · ${sector.losers}↓`} />

            {sector.top_gainer ? (
              <TouchableOpacity style={styles.moverRow} onPress={() => goStock(sector.top_gainer!)}>
                <Text style={styles.moverLabel}>Top gainer</Text>
                <Text style={[styles.moverSym, { color: theme.colors.success }]}>
                  {sector.top_gainer.replace('.NS', '')} →
                </Text>
              </TouchableOpacity>
            ) : null}
            {sector.top_loser ? (
              <TouchableOpacity style={styles.moverRow} onPress={() => goStock(sector.top_loser!)}>
                <Text style={styles.moverLabel}>Top loser</Text>
                <Text style={[styles.moverSym, { color: theme.colors.error }]}>
                  {sector.top_loser.replace('.NS', '')} →
                </Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>

          <TouchableOpacity style={styles.cta} onPress={goScreener} testID="sector-view-stocks">
            <Ionicons name="filter" size={18} color={theme.colors.bg} />
            <Text style={styles.ctaText}>View all stocks in screener</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: theme.colors.bg,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '75%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.border,
    alignSelf: 'center', marginTop: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md,
  },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, gap: 2 },
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border,
  },
  statLabel: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  statValue: { color: theme.colors.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  moverRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, marginTop: 4,
  },
  moverLabel: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  moverSym: { fontSize: 14, fontWeight: '800' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.lg, marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.text, paddingVertical: 14, borderRadius: theme.radius.md,
  },
  ctaText: { color: theme.colors.bg, fontSize: 14, fontWeight: '800' },
});
