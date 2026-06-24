import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { api, Stock } from '@/src/api';
import { theme } from '@/src/theme';
import { watchlist, WatchItem } from '@/src/storage-keys';
import StockRow from '@/src/components/StockRow';
import { EmptyState, LoadingState } from '@/src/components/States';

export default function WatchlistScreen() {
  const router = useRouter();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await watchlist.list();
    setItems(list);
    if (list.length === 0) {
      setQuotes([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const r = await api.batchQuotes(list.map((x) => x.symbol));
      const ordered: Stock[] = [];
      list.forEach((wi) => {
        const q = r.quotes.find((x) => x.symbol === wi.symbol);
        if (q) ordered.push(q as Stock);
      });
      setQuotes(ordered);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const remove = async (symbol: string) => {
    await watchlist.remove(symbol);
    setQuotes((prev) => prev.filter((x) => x.symbol !== symbol));
    setItems((prev) => prev.filter((x) => x.symbol !== symbol));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="watchlist-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Watchlist</Text>
          <Text style={styles.subtitle}>{items.length} tracked</Text>
        </View>
        <TouchableOpacity testID="open-search" onPress={() => router.push('/search')} style={styles.iconBtn}>
          <Ionicons name="add" size={22} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.text} />}
      >
        {loading ? (
          <LoadingState />
        ) : quotes.length === 0 ? (
          <View style={styles.emptyWrap} testID="watchlist-empty">
            <Ionicons name="bookmarks-outline" size={48} color={theme.colors.borderStrong} />
            <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
            <Text style={styles.emptySubtitle}>Tap a stock in Markets, Radar, or Screener to add it here.</Text>
            <TouchableOpacity testID="empty-cta" onPress={() => router.push('/(tabs)/screener')} style={styles.ctaBtn}>
              <Text style={styles.ctaBtnText}>Go to Screener</Text>
            </TouchableOpacity>
          </View>
        ) : (
          quotes.map((s) => (
            <View key={s.symbol} style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1 }}>
                <StockRow stock={s} testIDPrefix="watchlist-row" />
              </View>
              <TouchableOpacity
                testID={`remove-${s.symbol}`}
                onPress={() => remove(s.symbol)}
                style={styles.removeBtn}
              >
                <Ionicons name="trash-outline" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', padding: theme.spacing.xxxl, gap: theme.spacing.sm },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', marginTop: theme.spacing.md },
  emptySubtitle: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
  ctaBtn: { marginTop: theme.spacing.lg, height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' },
  ctaBtnText: { color: theme.colors.bg, fontWeight: '700' },
  removeBtn: { width: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
});
