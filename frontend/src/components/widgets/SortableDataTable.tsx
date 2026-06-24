import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

export interface SortableColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render?: (row: any) => React.ReactNode;
  tone?: (row: any) => 'pos' | 'neg' | 'neutral' | undefined;
  sortValue?: (row: any) => number | string | null;
  mono?: boolean;
  description?: string;
}

interface Props {
  columns: SortableColumn[];
  rows: any[];
  rowKey?: (r: any) => string;
  onRowPress?: (row: any) => void;
  linkToStockField?: string;
  defaultSort?: { key: string; desc?: boolean };
  /** Width of the sticky symbol column (frozen on left). */
  stickyWidth?: number;
  /** Field name in row for sticky symbol cell. */
  stickyField?: string;
  /** Optional render for sticky cell. Default: shows symbol big and name small. */
  renderSticky?: (row: any) => React.ReactNode;
  testID?: string;
}

/**
 * SortableDataTable — horizontally scrollable table with:
 *   • Sortable column headers (tap once → desc, tap again → asc, tap a 3rd time → clear)
 *   • Sticky/frozen first column (ticker symbol) that stays visible while scrolling right
 *   • Alternating row colors
 *   • Per-column tone coloring
 *
 * Layout: a fixed-width sticky column on the left + a horizontally-scrollable
 * region for the rest of the columns. Both share vertical scroll via a single
 * vertical ScrollView wrapping the body.
 */
export default function SortableDataTable({
  columns,
  rows,
  rowKey,
  onRowPress,
  linkToStockField,
  defaultSort,
  stickyWidth = 78,
  stickyField = 'symbol',
  renderSticky,
  testID,
}: Props) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key || null);
  const [sortDesc, setSortDesc] = useState<boolean>(defaultSort?.desc ?? true);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    const fn = col?.sortValue || ((r: any) => r[sortKey!]);
    const sorted = [...rows].sort((a, b) => {
      const av = fn(a); const bv = fn(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDesc ? bv - av : av - bv;
      const as = String(av).toLowerCase(); const bs = String(bv).toLowerCase();
      return sortDesc ? bs.localeCompare(as) : as.localeCompare(bs);
    });
    return sorted;
  }, [rows, sortKey, sortDesc, columns]);

  const totalScrollW = columns.reduce((acc, c) => acc + (c.width || 100), 0);

  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDesc(true); return; }
    if (sortDesc) { setSortDesc(false); return; }
    setSortKey(null);
  };

  const handlePressRow = (r: any) => {
    if (onRowPress) onRowPress(r);
    else if (linkToStockField && r[linkToStockField]) {
      router.push({ pathname: '/stock/[symbol]', params: { symbol: r[linkToStockField] } });
    }
  };

  const defaultStickyRender = (r: any) => (
    <View>
      <Text style={styles.stickySym} numberOfLines={1}>{String(r[stickyField] || '').replace('.NS', '')}</Text>
      {r.name ? <Text style={styles.stickyName} numberOfLines={1}>{r.name}</Text> : null}
    </View>
  );

  return (
    <View style={styles.wrap} testID={testID}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={[styles.stickyHeader, { width: stickyWidth }]}>
          <TouchableOpacity onPress={() => handleSort(stickyField)} style={styles.headerCellTouch}>
            <Text style={styles.headerCellText}>SYM</Text>
            {sortKey === stickyField ? <Ionicons name={sortDesc ? 'caret-down' : 'caret-up'} size={9} color={theme.colors.text} /> : null}
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ width: Math.max(totalScrollW, 320) }}
        >
          <View style={{ flexDirection: 'row' }}>
            {columns.map((c) => (
              <TouchableOpacity
                key={c.key}
                onPress={() => handleSort(c.key)}
                style={[styles.headerCellTouch, {
                  width: c.width || 100,
                  justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start',
                }]}
              >
                <Text style={styles.headerCellText} numberOfLines={1}>{c.label}</Text>
                {sortKey === c.key ? <Ionicons name={sortDesc ? 'caret-down' : 'caret-up'} size={9} color={theme.colors.text} /> : null}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Body: vertical wrapper containing both sticky col + horizontal scroll of data */}
      <ScrollView
        style={{ maxHeight: 800 }}
        nestedScrollEnabled
      >
        <View style={{ flexDirection: 'row' }}>
          {/* Sticky column body */}
          <View style={[styles.stickyBodyCol, { width: stickyWidth }]}>
            {sortedRows.map((r, idx) => (
              <TouchableOpacity
                key={(rowKey ? rowKey(r) : idx.toString()) + '-sticky'}
                activeOpacity={0.7}
                onPress={() => handlePressRow(r)}
                style={[styles.stickyCell, idx % 2 === 1 && { backgroundColor: theme.colors.bg2 }]}
              >
                {(renderSticky || defaultStickyRender)(r)}
              </TouchableOpacity>
            ))}
          </View>
          {/* Horizontally scrollable body */}
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={{ width: Math.max(totalScrollW, 320) }}>
              {sortedRows.map((r, idx) => (
                <TouchableOpacity
                  key={rowKey ? rowKey(r) : idx.toString()}
                  activeOpacity={0.7}
                  onPress={() => handlePressRow(r)}
                  style={[styles.bodyRow, idx % 2 === 1 && { backgroundColor: theme.colors.bg2 }]}
                >
                  {columns.map((c) => {
                    const tone = c.tone ? c.tone(r) : undefined;
                    const color =
                      tone === 'pos' ? theme.colors.success :
                      tone === 'neg' ? theme.colors.error :
                      theme.colors.text;
                    return (
                      <View key={c.key} style={{ width: c.width || 100, paddingHorizontal: 6, paddingVertical: 10, justifyContent: 'center' }}>
                        {c.render ? c.render(r) : (
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
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.colors.bg },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  stickyHeader: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: theme.colors.bg2,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  headerCellTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  headerCellText: {
    color: theme.colors.textSubtle,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stickyBodyCol: {
    backgroundColor: theme.colors.bg,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  stickyCell: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  stickySym: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  stickyName: { color: theme.colors.textMuted, fontSize: 9, marginTop: 1 },
  bodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  cell: { color: theme.colors.text, fontSize: 12, fontWeight: '500' },
});
