import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

export interface Column {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render?: (row: any) => React.ReactNode;
  tone?: (row: any) => 'pos' | 'neg' | 'neutral' | undefined;
  mono?: boolean;
}

interface Props {
  columns: Column[];
  rows: any[];
  rowKey?: (r: any) => string;
  onRowPress?: (row: any) => void;
  linkToStockField?: string; // e.g., 'symbol'
  testID?: string;
}

export default function DataTable({ columns, rows, rowKey, onRowPress, linkToStockField, testID }: Props) {
  const router = useRouter();
  const totalW = columns.reduce((acc, c) => acc + (c.width || 100), 0);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ backgroundColor: theme.colors.bg }} testID={testID}>
      <View style={{ width: Math.max(totalW, 320) }}>
        {/* Header */}
        <View style={styles.headerRow}>
          {columns.map((c) => (
            <Text
              key={c.key}
              numberOfLines={1}
              style={[
                styles.headerCell,
                { width: c.width || 100, textAlign: c.align || 'left' },
              ]}
            >
              {c.label}
            </Text>
          ))}
        </View>
        {/* Body */}
        {rows.map((r, idx) => {
          const handlePress = () => {
            if (onRowPress) onRowPress(r);
            else if (linkToStockField && r[linkToStockField]) router.push({ pathname: '/stock/[symbol]', params: { symbol: r[linkToStockField] } });
          };
          return (
            <TouchableOpacity
              key={rowKey ? rowKey(r) : idx.toString()}
              activeOpacity={0.7}
              onPress={handlePress}
              style={[styles.bodyRow, idx % 2 === 1 && { backgroundColor: theme.colors.bg2 }]}
            >
              {columns.map((c) => {
                const tone = c.tone ? c.tone(r) : undefined;
                const color =
                  tone === 'pos' ? theme.colors.success :
                  tone === 'neg' ? theme.colors.error :
                  theme.colors.text;
                return (
                  <View key={c.key} style={{ width: c.width || 100, paddingHorizontal: 6, paddingVertical: 10 }}>
                    {c.render ? (
                      c.render(r)
                    ) : (
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.cell,
                          { textAlign: c.align || 'left', color },
                          c.mono && { fontVariant: ['tabular-nums'] },
                        ]}
                      >
                        {r[c.key] ?? '—'}
                      </Text>
                    )}
                  </View>
                );
              })}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    backgroundColor: theme.colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerCell: {
    paddingHorizontal: 6,
    color: theme.colors.textSubtle,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  bodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  cell: { color: theme.colors.text, fontSize: 12, fontWeight: '500' },
});
