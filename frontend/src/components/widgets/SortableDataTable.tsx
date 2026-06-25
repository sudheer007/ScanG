import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
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
  stickyWidth?: number;
  stickyField?: string;
  renderSticky?: (row: any) => React.ReactNode;
  testID?: string;
}

const ROW_HEIGHT = 56; // single source of truth — both sticky & data cells use this

/**
 * SortableDataTable v2 — fixes:
 *  - Sticky column row heights now exactly match scrolling-region row heights (ROW_HEIGHT).
 *  - Header horizontally scrolls in sync with the body.
 *  - Single outer vertical ScrollView keeps both columns aligned during vertical scroll.
 */
export default function SortableDataTable({
  columns,
  rows,
  rowKey,
  onRowPress,
  linkToStockField,
  defaultSort,
  stickyWidth = 82,
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
  const headerScrollRef = useRef<ScrollView>(null);
  const bodyScrollRef = useRef<ScrollView>(null);

  // One-directional sync: body drives header. Header is NOT user-draggable
  // to avoid a programmatic-scroll feedback loop that caused stutter/vibration
  // (especially when scrolling left against momentum).
  const onBodyHorizScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    headerScrollRef.current?.scrollTo({ x, animated: false });
  };

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
    <View style={styles.stickyContent}>
      <Text style={styles.stickySym} numberOfLines={1}>{String(r[stickyField] || '').replace('.NS', '')}</Text>
      {r.name ? <Text style={styles.stickyName} numberOfLines={1}>{r.name}</Text> : null}
    </View>
  );

  return (
    <View style={styles.wrap} testID={testID}>
      {/* ===== Header row (sticky col + horizontally scrollable header) ===== */}
      <View style={styles.headerRow}>
        <View style={[styles.stickyHeaderCell, { width: stickyWidth }]}>
          <TouchableOpacity onPress={() => handleSort(stickyField)} style={styles.headerCellTouch}>
            <Text style={styles.headerCellText}>SYM</Text>
            {sortKey === stickyField ? <Ionicons name={sortDesc ? 'caret-down' : 'caret-up'} size={9} color={theme.colors.text} /> : null}
          </TouchableOpacity>
        </View>
        <ScrollView
          ref={headerScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={false}
          pointerEvents="box-none"
          style={{ flex: 1 }}
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

      {/* ===== Body: vertical scroll wraps both sticky col + horizontal-scroll data ===== */}
      <ScrollView style={{ maxHeight: 800 }} nestedScrollEnabled>
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
          {/* Horizontally scrollable body — synced with header */}
          <ScrollView
            ref={bodyScrollRef}
            horizontal
            showsHorizontalScrollIndicator
            scrollEventThrottle={16}
            onScroll={onBodyHorizScroll}
            style={{ flex: 1 }}
          >
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
                      <View key={c.key} style={[styles.bodyCell, { width: c.width || 100 }]}>
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
    height: 32,
  },
  stickyHeaderCell: {
    height: 32,
    backgroundColor: theme.colors.bg2,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    justifyContent: 'center',
  },
  headerCellTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    height: 32,
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
    height: ROW_HEIGHT,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    justifyContent: 'center',
  },
  stickyContent: { justifyContent: 'center' },
  stickySym: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  stickyName: { color: theme.colors.textMuted, fontSize: 9, marginTop: 2 },
  bodyRow: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  bodyCell: {
    height: ROW_HEIGHT,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  cell: { color: theme.colors.text, fontSize: 12, fontWeight: '500' },
});
