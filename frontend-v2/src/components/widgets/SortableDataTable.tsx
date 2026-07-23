import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from 'react-native';
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

type ColW = SortableColumn & { width: number };

/**
 * SortableDataTable v2:
 *  - Mobile / narrow: fixed column widths + horizontal scroll (unchanged).
 *  - Laptop / wide: flex columns fill available width (no clipping, no blank right gap).
 *  - Vertical scroll is owned by the parent screen (avoids double scrollbars).
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
  const [tableWidth, setTableWidth] = useState(0);

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

  const displayCols: ColW[] = useMemo(
    () => columns.map((c) => ({ ...c, width: c.width || 100 })),
    [columns],
  );
  const baseTotal = useMemo(
    () => displayCols.reduce((acc, c) => acc + c.width, 0),
    [displayCols],
  );

  // Wide only when measured width clearly exceeds natural table size.
  const fillWide = tableWidth > 0 && tableWidth >= stickyWidth + baseTotal + 8;

  const headerScrollRef = useRef<ScrollView>(null);
  const bodyScrollRef = useRef<ScrollView>(null);

  const onBodyHorizScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    headerScrollRef.current?.scrollTo({ x, animated: false });
  };

  const onTableLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - tableWidth) > 1) setTableWidth(w);
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

  const alignItemsFor = (align?: 'left' | 'right' | 'center') =>
    align === 'right' ? 'flex-end' as const : align === 'center' ? 'center' as const : 'flex-start' as const;

  const defaultStickyRender = (r: any) => (
    <View style={styles.stickyContent}>
      <Text style={styles.stickySym} numberOfLines={1}>{String(r[stickyField] || '').replace('.NS', '')}</Text>
      {r.name ? <Text style={styles.stickyName} numberOfLines={1}>{r.name}</Text> : null}
    </View>
  );

  const renderHeaderCells = (wide: boolean) =>
    displayCols.map((c) => (
      <TouchableOpacity
        key={c.key}
        onPress={() => handleSort(c.key)}
        style={[
          styles.headerCellTouch,
          wide
            ? { flex: c.width, minWidth: 0, justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }
            : { width: c.width, justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' },
        ]}
      >
        <Text style={styles.headerCellText} numberOfLines={1}>{c.label}</Text>
        {sortKey === c.key ? <Ionicons name={sortDesc ? 'caret-down' : 'caret-up'} size={9} color={theme.colors.text} /> : null}
      </TouchableOpacity>
    ));

  const renderBodyCells = (r: any, wide: boolean) =>
    displayCols.map((c) => {
      const tone = c.tone ? c.tone(r) : undefined;
      const color =
        tone === 'pos' ? theme.colors.success :
        tone === 'neg' ? theme.colors.error :
        theme.colors.text;
      const rendered = c.render ? c.render(r) : (r[c.key] ?? '—');
      const isPrimitive = typeof rendered === 'string' || typeof rendered === 'number';
      return (
        <View
          key={c.key}
          style={[
            styles.bodyCell,
            wide
              ? { flex: c.width, minWidth: 0, alignItems: alignItemsFor(c.align) }
              : { width: c.width, alignItems: alignItemsFor(c.align) },
          ]}
        >
          {isPrimitive ? (
            <Text
              numberOfLines={1}
              style={[
                styles.cell,
                { textAlign: c.align || 'left', color, width: '100%' },
                c.mono && { fontVariant: ['tabular-nums'] },
              ]}
            >
              {rendered}
            </Text>
          ) : rendered}
        </View>
      );
    });

  return (
    <View style={styles.wrap} testID={testID} onLayout={onTableLayout}>
      {/* ===== Header ===== */}
      <View style={styles.headerRow}>
        <View style={[styles.stickyHeaderCell, { width: stickyWidth }]}>
          <TouchableOpacity onPress={() => handleSort(stickyField)} style={styles.headerCellTouch}>
            <Text style={styles.headerCellText}>SYM</Text>
            {sortKey === stickyField ? <Ionicons name={sortDesc ? 'caret-down' : 'caret-up'} size={9} color={theme.colors.text} /> : null}
          </TouchableOpacity>
        </View>
        {fillWide ? (
          <View style={styles.flexHeaderTrack}>
            {renderHeaderCells(true)}
          </View>
        ) : (
          <ScrollView
            ref={headerScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={false}
            style={{ flex: 1, pointerEvents: 'box-none' }}
            contentContainerStyle={{ width: Math.max(baseTotal, 320) }}
          >
            <View style={{ flexDirection: 'row' }}>
              {renderHeaderCells(false)}
            </View>
          </ScrollView>
        )}
      </View>

      {/* ===== Body (no nested vertical scroll — parent page scrolls) ===== */}
      {fillWide ? (
        <View>
          {sortedRows.map((r, idx) => (
            <TouchableOpacity
              key={rowKey ? rowKey(r) : idx.toString()}
              testID={`row-${r[stickyField]}`}
              activeOpacity={0.7}
              onPress={() => handlePressRow(r)}
              style={[styles.bodyRow, styles.wideRow, idx % 2 === 1 && { backgroundColor: theme.colors.bg2 }]}
            >
              <View style={[
                styles.stickyCell,
                styles.stickyCellWide,
                { width: stickyWidth },
                idx % 2 === 1 && { backgroundColor: theme.colors.bg2 },
              ]}>
                {(renderSticky || defaultStickyRender)(r)}
              </View>
              <View style={styles.flexBodyTrack}>
                {renderBodyCells(r, true)}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row' }}>
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
          <ScrollView
            ref={bodyScrollRef}
            horizontal
            showsHorizontalScrollIndicator
            scrollEventThrottle={16}
            onScroll={onBodyHorizScroll}
            style={{ flex: 1 }}
          >
            <View style={{ width: Math.max(baseTotal, 320) }}>
              {sortedRows.map((r, idx) => (
                <TouchableOpacity
                  key={rowKey ? rowKey(r) : idx.toString()}
                  testID={`row-${r[stickyField]}`}
                  activeOpacity={0.7}
                  onPress={() => handlePressRow(r)}
                  style={[styles.bodyRow, idx % 2 === 1 && { backgroundColor: theme.colors.bg2 }]}
                >
                  {renderBodyCells(r, false)}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.bg,
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    height: 32,
    width: '100%',
  },
  flexHeaderTrack: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  flexBodyTrack: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  wideRow: {
    width: '100%',
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
  stickyCellWide: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
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
    overflow: 'hidden',
  },
  cell: { color: theme.colors.text, fontSize: 12, fontWeight: '500' },
});
