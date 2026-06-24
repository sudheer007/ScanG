import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Sparkline from '../Sparkline';
import { theme, fmtPrice, fmtPct, changeColor } from '@/src/theme';

interface Props {
  symbol: string;
  name?: string | null;
  price?: number | null;
  changePct?: number | null;
  currency?: string;
  sparkline?: number[];
  rightLabel?: string;
  rightValue?: string;
  rightTone?: 'pos' | 'neg' | 'neutral';
  onPress?: () => void;
  compact?: boolean;
}

export default function MiniRow({ symbol, name, price, changePct, currency, sparkline, rightLabel, rightValue, rightTone, onPress, compact }: Props) {
  const router = useRouter();
  const short = symbol.replace('.NS', '');
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress || (() => router.push({ pathname: '/stock/[symbol]', params: { symbol } }))}
      style={[styles.row, compact && { paddingVertical: 8 }]}
    >
      <View style={styles.left}>
        <Text style={styles.symbol} numberOfLines={1}>{short}</Text>
        {name ? <Text style={styles.name} numberOfLines={1}>{name}</Text> : null}
      </View>
      {sparkline && sparkline.length > 0 ? (
        <View style={styles.spark}>
          <Sparkline data={sparkline} width={56} height={20} />
        </View>
      ) : null}
      <View style={styles.right}>
        {price != null ? <Text style={styles.price}>{fmtPrice(price, currency || 'USD')}</Text> : null}
        {rightLabel || rightValue ? (
          <View style={styles.pillsRow}>
            {rightLabel ? <Text style={styles.rightLabel}>{rightLabel}</Text> : null}
            {rightValue ? (
              <Text style={[
                styles.rightValue,
                rightTone === 'pos' && { color: theme.colors.success },
                rightTone === 'neg' && { color: theme.colors.error },
              ]}>{rightValue}</Text>
            ) : null}
          </View>
        ) : changePct != null ? (
          <Text style={[styles.change, { color: changeColor(changePct) }]}>{fmtPct(changePct)}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  left: { flex: 1 },
  symbol: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  name: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  spark: { width: 56 },
  right: { alignItems: 'flex-end', minWidth: 78 },
  price: { color: theme.colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  change: { fontSize: 11, fontWeight: '600', marginTop: 1, fontVariant: ['tabular-nums'] },
  pillsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rightLabel: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '600' },
  rightValue: { color: theme.colors.text, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
