import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { api, IndexQuote, Market, Stock } from '@/src/api';
import { theme, fmtPrice, fmtPct, changeColor } from '@/src/theme';
import { marketPref } from '@/src/storage-keys';
import ChipRow from '@/src/components/ChipRow';
import StockRow from '@/src/components/StockRow';
import Sparkline from '@/src/components/Sparkline';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/States';

export default function MarketsScreen() {
  const router = useRouter();
  const [market, setMarket] = useState<Market>('US');
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [gainers, setGainers] = useState<Stock[]>([]);
  const [losers, setLosers] = useState<Stock[]>([]);
  const [tab, setTab] = useState<'gainers' | 'losers'>('gainers');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { marketPref.get().then(setMarket); }, []);

  const load = useCallback(async (m: Market) => {
    try {
      setError(null);
      const data = await api.marketOverview(m);
      setIndices(data.indices || []);
      setGainers(data.gainers || []);
      setLosers(data.losers || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load market data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(market);
    marketPref.set(market);
  }, [market, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(market);
  }, [market, load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="markets-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Markets</Text>
          <Text style={styles.subtitle}>Live • {market === 'US' ? 'United States' : 'India'}</Text>
        </View>
        <TouchableOpacity
          testID="open-search"
          onPress={() => router.push('/search')}
          style={styles.iconBtn}
        >
          <Ionicons name="search" size={20} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <ChipRow
        testID="market-toggle"
        options={[
          { value: 'US', label: '🇺🇸 United States', testID: 'market-US' },
          { value: 'IN', label: '🇮🇳 India', testID: 'market-IN' },
        ]}
        value={market}
        onChange={(v) => setMarket(v as Market)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />
        }
      >
        {loading ? (
          <LoadingState label="Fetching live quotes…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); load(market); }} />
        ) : (
          <>
            {/* Indices row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.indicesRow}
              style={styles.indicesScroll}
              testID="indices-row"
            >
              {indices.map((idx) => (
                <View key={idx.symbol} style={styles.indexCard} testID={`index-card-${idx.symbol}`}>
                  <Text style={styles.indexName}>{idx.name}</Text>
                  <Text style={styles.indexValue}>{fmtPrice(idx.price, idx.currency).replace('$', '').replace('₹', '')}</Text>
                  <View style={styles.indexChangeRow}>
                    <Text style={[styles.indexChange, { color: changeColor(idx.change_pct) }]}>
                      {fmtPct(idx.change_pct)}
                    </Text>
                    <Sparkline data={idx.sparkline || []} width={60} height={20} />
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Movers section toggle */}
            <View style={styles.moversHeader}>
              <Text style={styles.sectionTitle}>Top Movers</Text>
              <View style={styles.moverToggle}>
                <TouchableOpacity
                  testID="movers-gainers"
                  onPress={() => setTab('gainers')}
                  style={[styles.moverTab, tab === 'gainers' && styles.moverTabActive]}
                >
                  <Text style={[styles.moverTabText, tab === 'gainers' && styles.moverTabTextActive]}>Gainers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="movers-losers"
                  onPress={() => setTab('losers')}
                  style={[styles.moverTab, tab === 'losers' && styles.moverTabActive]}
                >
                  <Text style={[styles.moverTabText, tab === 'losers' && styles.moverTabTextActive]}>Losers</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.list}>
              {(tab === 'gainers' ? gainers : losers).length === 0 ? (
                <EmptyState title="No data yet" subtitle="Pull to refresh." />
              ) : (
                (tab === 'gainers' ? gainers : losers).map((s) => (
                  <StockRow key={s.symbol} stock={s} testIDPrefix={`mover-${tab}`} />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.bg2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  scroll: { flex: 1 },
  indicesScroll: { flexGrow: 0, height: 116 },
  indicesRow: { paddingHorizontal: theme.spacing.lg, gap: 10, paddingVertical: theme.spacing.sm, alignItems: 'center' },
  indexCard: {
    width: 150,
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  indexName: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  indexValue: { color: theme.colors.text, fontSize: 20, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  indexChangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  indexChange: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  moversHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  moverToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  moverTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  moverTabActive: { backgroundColor: theme.colors.text },
  moverTabText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  moverTabTextActive: { color: theme.colors.bg },
  list: { backgroundColor: theme.colors.bg },
});
