import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';

import { api, ApiError, Stock } from '@/src/api';
import { theme } from '@/src/theme';
import { WatchItem } from '@/src/storage-keys';
import { listWatchlist, removeWatchlistItem } from '@/src/services/watchlistService';
import { useAuth } from '@/src/hooks/useAuth';
import StockRow from '@/src/components/StockRow';
import { LoadingState } from '@/src/components/States';

type ImportSummary = {
  parsed: number;
  added: number;
  duplicates: number;
  invalid: number;
  truncated: boolean;
};

const ALLOWED_PORTFOLIO_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.txt',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
];

function isAllowedPortfolioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_PORTFOLIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type InvalidRow = { raw: string; reason: string };

export default function WatchlistScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [showInvalid, setShowInvalid] = useState(false);

  const load = useCallback(async () => {
    const list = await listWatchlist(user?.uid);
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
  }, [user?.uid]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const remove = async (symbol: string) => {
    await removeWatchlistItem(symbol, user?.uid);
    setQuotes((prev) => prev.filter((x) => x.symbol !== symbol));
    setItems((prev) => prev.filter((x) => x.symbol !== symbol));
  };

  const formatSummary = (summary: ImportSummary) => {
    const parts = [
      `Imported ${summary.added}`,
      `duplicates ${summary.duplicates}`,
      `invalid ${summary.invalid}`,
    ];
    if (summary.truncated) parts.push('truncated');
    return parts.join(', ');
  };

  const onUploadPortfolio = async () => {
    if (importing) return;
    setImportError(null);
    setImportMessage(null);
    setInvalidRows([]);

    if (!user?.uid) {
      setImportError('Sign in to upload a portfolio to your watchlist.');
      return;
    }

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/tab-separated-values',
          'text/plain',
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled || !picked.assets?.length) return;

      const asset = picked.assets[0];
      const name = asset.name || 'portfolio.csv';
      if (!isAllowedPortfolioFile(name)) {
        setImportError('Please upload a CSV, TSV, PDF, or image file.');
        return;
      }

      setImporting(true);
      const result = await api.importWatchlistPortfolio({
        uri: asset.uri,
        name,
        mimeType: asset.mimeType,
        file: (asset as { file?: File }).file,
      });

      setImportMessage(formatSummary(result.summary));
      setInvalidRows(result.invalid || []);
      setLoading(true);
      await load();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setImportError(err.message || 'Import failed');
      } else {
        setImportError(err?.message || 'Import failed');
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="watchlist-screen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="watchlist-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.title}>Watchlist</Text>
          <Text style={styles.subtitle}>{items.length} tracked</Text>
        </View>
        <TouchableOpacity
          testID="upload-portfolio"
          onPress={onUploadPortfolio}
          style={styles.iconBtn}
          disabled={importing}
        >
          {importing ? (
            <ActivityIndicator color={theme.colors.text} size="small" />
          ) : (
            <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.text} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          testID="open-search"
          onPress={() => router.push('/search')}
          style={[styles.iconBtn, { marginLeft: 8 }]}
          disabled={importing}
        >
          <Ionicons name="add" size={22} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {importMessage ? (
        <View style={styles.banner} testID="import-summary">
          <Text style={styles.bannerText}>{importMessage}</Text>
          {invalidRows.length > 0 ? (
            <TouchableOpacity onPress={() => setShowInvalid(true)} testID="view-invalid">
              <Text style={styles.bannerLink}>View skipped</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {importError ? (
        <View style={[styles.banner, styles.bannerError]} testID="import-error">
          <Text style={styles.bannerText}>{importError}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (importing) return;
              setRefreshing(true);
              load();
            }}
            tintColor={theme.colors.text}
          />
        }
      >
        {importing ? (
          <LoadingState label="Extracting symbols…" />
        ) : loading ? (
          <LoadingState />
        ) : quotes.length === 0 ? (
          <View style={styles.emptyWrap} testID="watchlist-empty">
            <Ionicons name="bookmarks-outline" size={48} color={theme.colors.borderStrong} />
            <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
            <Text style={styles.emptySubtitle}>
              Tap a stock in Markets, Radar, or Screener to add it here — or upload a CSV, PDF, or image of your portfolio.
            </Text>
            <TouchableOpacity
              testID="empty-upload"
              onPress={onUploadPortfolio}
              style={styles.ctaBtn}
              disabled={importing}
            >
              <Text style={styles.ctaBtnText}>Upload portfolio</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="empty-cta" onPress={() => router.push('/(tabs)/screener')} style={[styles.ctaBtn, styles.ctaSecondary]}>
              <Text style={[styles.ctaBtnText, styles.ctaSecondaryText]}>Go to Screener</Text>
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
                disabled={importing}
              >
                <Ionicons name="trash-outline" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={showInvalid} transparent animationType="fade" onRequestClose={() => setShowInvalid(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Skipped rows</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {invalidRows.map((row, idx) => (
                <Text key={`${row.raw}-${idx}`} style={styles.modalRow}>
                  {row.raw} — {row.reason.replace(/_/g, ' ')}
                </Text>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowInvalid(false)} testID="close-invalid">
              <Text style={styles.ctaBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  banner: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 10,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  bannerError: { borderColor: '#c45c5c' },
  bannerText: { color: theme.colors.text, fontSize: 12, flex: 1 },
  bannerLink: { color: theme.colors.text, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  emptyWrap: { alignItems: 'center', padding: theme.spacing.xxxl, gap: theme.spacing.sm },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', marginTop: theme.spacing.md },
  emptySubtitle: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
  ctaBtn: { marginTop: theme.spacing.lg, height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' },
  ctaBtnText: { color: theme.colors.bg, fontWeight: '700' },
  ctaSecondary: { marginTop: theme.spacing.sm, backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border },
  ctaSecondaryText: { color: theme.colors.text },
  removeBtn: { width: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: theme.colors.bg2, borderRadius: 16, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700', marginBottom: theme.spacing.md },
  modalRow: { color: theme.colors.textMuted, fontSize: 13, marginBottom: 6 },
  modalClose: { marginTop: theme.spacing.lg, height: 44, borderRadius: 22, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' },
});
