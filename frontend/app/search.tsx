import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { api } from '@/src/api';
import { theme, fmtPrice, fmtPct, changeColor } from '@/src/theme';

interface Result { symbol: string; name: string; market: 'US'|'IN'; price: number; change_pct: number; currency: string }

export default function SearchScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.search(q.trim());
        setResults(r.results as Result[]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="search-screen">
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={theme.colors.textMuted} />
          <TextInput
            testID="search-input"
            value={q}
            onChangeText={setQ}
            placeholder="Search ticker or company…"
            placeholderTextColor={theme.colors.textSubtle}
            autoFocus
            style={styles.input}
          />
          {q.length > 0 && (
            <TouchableOpacity onPress={() => setQ('')} testID="clear-search">
              <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        {loading && <ActivityIndicator color={theme.colors.text} style={{ marginTop: 30 }} />}
        {!loading && results.length === 0 && q.length > 0 && (
          <Text style={styles.empty}>No matches for "{q}"</Text>
        )}
        {results.map((r) => (
          <TouchableOpacity
            key={r.symbol}
            testID={`search-result-${r.symbol}`}
            onPress={() => router.push({ pathname: '/stock/[symbol]', params: { symbol: r.symbol } })}
            style={styles.row}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.sym}>{r.symbol.replace('.NS', '')} <Text style={styles.market}>· {r.market}</Text></Text>
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.price}>{fmtPrice(r.price, r.currency)}</Text>
              <Text style={[styles.chg, { color: changeColor(r.change_pct) }]}>{fmtPct(r.change_pct)}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md, gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12, borderRadius: 20, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },
  input: { flex: 1, color: theme.colors.text, fontSize: 14 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  sym: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  market: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '500' },
  name: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  price: { color: theme.colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chg: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
