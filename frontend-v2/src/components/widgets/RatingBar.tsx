import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

interface Props {
  strongBuy: number; buy: number; hold: number; sell: number;
  height?: number;
}

export default function RatingBar({ strongBuy, buy, hold, sell, height = 8 }: Props) {
  const total = Math.max(1, strongBuy + buy + hold + sell);
  return (
    <View>
      <View style={[styles.bar, { height }]}>
        <View style={{ flex: strongBuy / total, backgroundColor: '#10B981' }} />
        <View style={{ flex: buy / total, backgroundColor: '#34D399' }} />
        <View style={{ flex: hold / total, backgroundColor: '#F59E0B' }} />
        <View style={{ flex: sell / total, backgroundColor: '#EF4444' }} />
      </View>
      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: '#10B981' }]}>SB {strongBuy}%</Text>
        <Text style={[styles.legendText, { color: '#34D399' }]}>B {buy}%</Text>
        <Text style={[styles.legendText, { color: '#F59E0B' }]}>H {hold}%</Text>
        <Text style={[styles.legendText, { color: '#EF4444' }]}>S {sell}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: theme.colors.bg3,
  },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  legendText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});
