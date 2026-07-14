import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Sparkline from './Sparkline';
import { theme, fmtPrice, fmtPct, changeColor } from '@/src/theme';
import { Stock } from '@/src/api';

interface Props {
  stock: Stock;
  rightBadges?: { label: string; value: string; tone?: 'pos' | 'neg' | 'neutral' }[];
  testIDPrefix?: string;
  hideSparkline?: boolean;
}

export default function StockRow({ stock, rightBadges, testIDPrefix = 'stock-row', hideSparkline = false }: Props) {
  const router = useRouter();
  const symbolShort = stock.symbol.replace('.NS', '');
  const ccy = stock.currency || (stock.symbol.endsWith('.NS') ? 'INR' : 'USD');

  return (
    <TouchableOpacity
      testID={`${testIDPrefix}-${stock.symbol}`}
      activeOpacity={0.7}
      onPress={() => router.push({ pathname: '/stock/[symbol]', params: { symbol: stock.symbol } })}
      style={styles.row}
    >
      <View style={styles.left}>
        <Text style={styles.symbol} numberOfLines={1}>{symbolShort}</Text>
        <Text style={styles.name} numberOfLines={1}>{stock.name}</Text>
        {rightBadges && rightBadges.length > 0 && (
          <View style={styles.badgeRow}>
            {rightBadges.slice(0, 3).map((b, i) => (
              <View key={i} style={[styles.badge, b.tone === 'pos' && styles.badgePos, b.tone === 'neg' && styles.badgeNeg]}>
                <Text style={styles.badgeLabel}>{b.label}</Text>
                <Text style={[styles.badgeValue, b.tone === 'pos' && { color: theme.colors.success }, b.tone === 'neg' && { color: theme.colors.error }]}>{b.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {!hideSparkline && (
        <View style={styles.spark}>
          <Sparkline data={stock.sparkline || []} width={70} height={26} />
        </View>
      )}

      <View style={styles.right}>
        <Text style={styles.price}>{fmtPrice(stock.price, ccy)}</Text>
        <Text style={[styles.change, { color: changeColor(stock.change_pct) }]}>
          {fmtPct(stock.change_pct)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  left: { flex: 1, paddingRight: theme.spacing.sm },
  symbol: { color: theme.colors.text, fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  name: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  spark: { width: 70, marginHorizontal: theme.spacing.sm },
  right: { alignItems: 'flex-end', minWidth: 84 },
  price: { color: theme.colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  change: { fontSize: 12, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: theme.colors.bg3,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgePos: { backgroundColor: 'rgba(16,185,129,0.12)' },
  badgeNeg: { backgroundColor: 'rgba(239,68,68,0.12)' },
  badgeLabel: { color: theme.colors.textSubtle, fontSize: 10 },
  badgeValue: { color: theme.colors.text, fontSize: 11, fontWeight: '600' },
});
