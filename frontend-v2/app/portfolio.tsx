import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';

import { api, ApiError, Stock } from '@/src/api';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import { theme, changeColor } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import { PortfolioItem } from '@/src/storage-keys';
import { listPortfolio, removePortfolioItem } from '@/src/services/portfolioService';
import { useAuth } from '@/src/hooks/useAuth';
import { LoadingState } from '@/src/components/States';

const ACCENT = authTheme.colors.primary;
const ACCENT_DIM = 'rgba(26, 130, 255, 0.18)';
const ACCENT_BORDER = 'rgba(26, 130, 255, 0.45)';
const DANGER = theme.colors.error;
const DANGER_DIM = 'rgba(239, 68, 68, 0.14)';
const DANGER_BORDER = 'rgba(239, 68, 68, 0.35)';

type ImportSummary = {
  parsed: number;
  added: number;
  updated: number;
  invalid: number;
  truncated: boolean;
};

type InvalidRow = { raw: string; reason: string };

type HoldingRow = PortfolioItem & {
  ltp: number | null;
  changePct: number | null;
  invested: number;
  current: number | null;
  pnl: number | null;
  roi: number | null;
};

const ALLOWED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.pdf', '.jpg', '.jpeg', '.png', '.webp'];
/** Auto-refresh LTP / P&L while the portfolio screen is focused. */
const QUOTE_POLL_MS = 15_000;

function isAllowedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function displaySymbol(symbol: string): string {
  return symbol.replace(/\.NS$/i, '');
}

function fmtQty(value: number, market: 'US' | 'IN' = 'IN'): string {
  if (Number.isInteger(value)) {
    const locale = market === 'IN' ? 'en-IN' : 'en-US';
    return value.toLocaleString(locale);
  }
  return fmtAmount(value, market);
}

/** Format amounts like the portfolio template (Indian grouping when market is IN). */
function fmtAmount(value: number | null | undefined, market: 'US' | 'IN' = 'IN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const locale = market === 'IN' ? 'en-IN' : 'en-US';
  return value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSignedAmount(value: number | null | undefined, market: 'US' | 'IN' = 'IN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  return `${sign}${fmtAmount(value, market)}`;
}

function fmtSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function stripPctParens(changePct: number | null): string {
  if (changePct === null || Number.isNaN(changePct)) return '';
  return `(${changePct.toFixed(2)}%)`;
}

export default function PortfolioScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [holdings, setHoldings] = useState<PortfolioItem[]>([]);
  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, Stock>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [showInvalid, setShowInvalid] = useState(false);
  const [actionTarget, setActionTarget] = useState<HoldingRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;

  const applyQuotes = useCallback((quotes: Stock[]) => {
    const map: Record<string, Stock> = {};
    quotes.forEach((q) => {
      map[q.symbol] = q;
    });
    setQuotesBySymbol(map);
  }, []);

  const refreshQuotes = useCallback(async () => {
    const list = holdingsRef.current;
    if (list.length === 0) {
      setQuotesBySymbol({});
      return;
    }
    try {
      const r = await api.batchLiveQuotes(list.map((x) => x.symbol));
      setQuotesBySymbol((prev) => {
        const next = { ...prev };
        for (const q of r.quotes || []) {
          const existing = next[q.symbol];
          next[q.symbol] = {
            ...(existing || {
              symbol: q.symbol,
              name: q.name,
              sparkline: [],
              currency: q.currency,
            }),
            price: q.price,
            change: q.change,
            change_pct: q.change_pct,
            volume: q.volume ?? existing?.volume ?? null,
            currency: q.currency || existing?.currency || 'USD',
            name: q.name || existing?.name || q.symbol,
          };
        }
        return next;
      });
    } catch {
      // Keep last quotes on background poll failure.
    }
  }, []);

  const load = useCallback(async () => {
    const list = await listPortfolio(user?.uid);
    setHoldings(list);
    if (list.length === 0) {
      setQuotesBySymbol({});
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const r = await api.batchQuotes(list.map((x) => x.symbol));
      applyQuotes((r.quotes || []) as Stock[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.uid, applyQuotes]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
      const id = setInterval(() => void refreshQuotes(), QUOTE_POLL_MS);
      return () => clearInterval(id);
    }, [load, refreshQuotes]),
  );

  const rows: HoldingRow[] = useMemo(() => {
    return holdings.map((h) => {
      const quote = quotesBySymbol[h.symbol];
      const ltp = quote?.price ?? null;
      const changePct = quote?.change_pct ?? null;
      const invested = h.quantity * h.avg_price;
      const current = ltp !== null ? h.quantity * ltp : null;
      const pnl = current !== null ? current - invested : null;
      const roi = invested > 0 && pnl !== null ? (pnl / invested) * 100 : null;
      return { ...h, ltp, changePct, invested, current, pnl, roi };
    });
  }, [holdings, quotesBySymbol]);

  const summary = useMemo(() => {
    let invested = 0;
    let current = 0;
    let hasCurrent = false;
    let primaryMarket: 'US' | 'IN' = 'IN';
    const inCount = rows.filter((r) => r.market === 'IN').length;
    if (inCount < rows.length / 2) primaryMarket = 'US';

    for (const r of rows) {
      invested += r.invested;
      if (r.current !== null) {
        current += r.current;
        hasCurrent = true;
      }
    }
    const pnl = hasCurrent ? current - invested : null;
    const pnlPct = invested > 0 && pnl !== null ? (pnl / invested) * 100 : null;
    return {
      invested,
      current: hasCurrent ? current : null,
      pnl,
      pnlPct,
      market: primaryMarket,
    };
  }, [rows]);

  const formatSummary = (s: ImportSummary) => {
    const parts = [`Imported ${s.added}`, `updated ${s.updated}`, `invalid ${s.invalid}`];
    if (s.truncated) parts.push('truncated');
    return parts.join(', ');
  };

  const onImport = async () => {
    if (importing) return;
    setImportError(null);
    setImportMessage(null);
    setInvalidRows([]);

    if (!user?.uid) {
      setImportError('Sign in to upload your portfolio.');
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
      if (!isAllowedFile(name)) {
        setImportError('Please upload a CSV, TSV, PDF, or image file.');
        return;
      }

      setImporting(true);
      const result = await api.importPortfolio({
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

  const openActionMenu = useCallback(async (row: HoldingRow) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Haptics unavailable on some platforms.
      }
    }
    setActionTarget(row);
  }, []);

  const closeActionMenu = useCallback(() => {
    if (deleting) return;
    setActionTarget(null);
  }, [deleting]);

  const remove = async (symbol: string) => {
    await removePortfolioItem(symbol, user?.uid);
    setHoldings((prev) => prev.filter((x) => x.symbol !== symbol));
    setQuotesBySymbol((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  };

  const confirmDelete = async () => {
    if (!actionTarget || deleting) return;
    setDeleting(true);
    try {
      if (Platform.OS !== 'web') {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // ignore
        }
      }
      await remove(actionTarget.symbol);
      setActionTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="portfolio-screen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="portfolio-back"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/more' as Href);
            }
          }}
          style={styles.iconBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Portfolio</Text>
          <View style={styles.titleDot} />
        </View>
        <TouchableOpacity
          testID="import-files"
          onPress={onImport}
          style={styles.importBtn}
          disabled={importing}
        >
          {importing ? (
            <ActivityIndicator color={ACCENT} size="small" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={16} color={ACCENT} />
              <Text style={styles.importBtnText}>Import Files</Text>
            </>
          )}
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
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <AppRefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (importing) return;
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        {importing ? (
          <LoadingState label="Extracting holdings…" />
        ) : loading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <View style={styles.emptyWrap} testID="portfolio-empty">
            <Ionicons name="pie-chart-outline" size={48} color={theme.colors.borderStrong} />
            <Text style={styles.emptyTitle}>No holdings yet</Text>
            <Text style={styles.emptySubtitle}>
              Upload a CSV, PDF, or image of your portfolio with Symbol, Qty, and Avg Price columns.
            </Text>
            <TouchableOpacity
              testID="empty-import"
              onPress={onImport}
              style={styles.ctaBtn}
              disabled={importing}
            >
              <Text style={styles.ctaBtnText}>Import Files</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>INVESTED</Text>
                <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtAmount(summary.invested, summary.market)}
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>CURRENT</Text>
                <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtAmount(summary.current, summary.market)}
                </Text>
              </View>
            </View>

            <View style={styles.pnlBar}>
              <Text style={styles.pnlLabel}>P&L</Text>
              <Text style={[styles.pnlValue, { color: changeColor(summary.pnl) }]}>
                {fmtSignedAmount(summary.pnl, summary.market)}
              </Text>
              <View style={styles.pnlPctPill}>
                <Text style={[styles.pnlPct, { color: changeColor(summary.pnlPct) }]}>
                  {fmtSignedPct(summary.pnlPct)}
                </Text>
              </View>
            </View>

            {rows.map((row) => {
              const selected = actionTarget?.symbol === row.symbol;
              return (
                <Pressable
                  key={row.symbol}
                  testID={`portfolio-row-${row.symbol}`}
                  onPress={() =>
                    router.push({ pathname: '/stock/[symbol]', params: { symbol: row.symbol } })
                  }
                  onLongPress={() => void openActionMenu(row)}
                  delayLongPress={350}
                  {...(Platform.OS === 'web'
                    ? {
                        onContextMenu: (e: { preventDefault?: () => void; stopPropagation?: () => void }) => {
                          e?.preventDefault?.();
                          e?.stopPropagation?.();
                          void openActionMenu(row);
                        },
                      }
                    : {})}
                  style={({ pressed }) => [
                    styles.holding,
                    (pressed || selected) && styles.holdingActive,
                    selected && styles.holdingSelected,
                  ]}
                >
                  <View style={styles.holdingTop}>
                    <Text style={styles.metaLeft}>
                      Qty. {fmtQty(row.quantity, row.market)} • Avg.{' '}
                      {fmtAmount(row.avg_price, row.market)}
                    </Text>
                    <Text style={[styles.roi, { color: changeColor(row.roi) }]}>
                      ROI {fmtSignedPct(row.roi)}
                    </Text>
                  </View>

                  <View style={styles.holdingMid}>
                    <Text style={styles.ticker}>{displaySymbol(row.symbol)}</Text>
                    <View style={styles.soldNowWrap}>
                      <Text style={styles.soldNowLabel}>Sold Now</Text>
                      <Text style={[styles.soldNowValue, { color: changeColor(row.pnl) }]}>
                        {fmtSignedAmount(row.pnl, row.market)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.holdingBot}>
                    <Text style={styles.metaLeft}>Invested {fmtAmount(row.invested, row.market)}</Text>
                    <Text style={styles.ltp}>
                      LTP {fmtAmount(row.ltp, row.market)}{' '}
                      <Text style={{ color: changeColor(row.changePct) }}>
                        {stripPctParens(row.changePct)}
                      </Text>
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </>
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

      <Modal
        visible={!!actionTarget}
        transparent
        animationType="fade"
        onRequestClose={closeActionMenu}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeActionMenu}
            testID="holding-action-backdrop"
          />
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetIconWrap}>
                <Ionicons name="briefcase-outline" size={20} color={ACCENT} />
              </View>
              <View style={styles.sheetHeaderText}>
                <Text style={styles.sheetSymbol}>
                  {actionTarget ? displaySymbol(actionTarget.symbol) : ''}
                </Text>
                <Text style={styles.sheetMeta}>
                  {actionTarget
                    ? `Qty ${fmtQty(actionTarget.quantity, actionTarget.market)} · Avg ${fmtAmount(actionTarget.avg_price, actionTarget.market)}`
                    : ''}
                </Text>
              </View>
              {actionTarget?.pnl != null ? (
                <Text style={[styles.sheetPnl, { color: changeColor(actionTarget.pnl) }]}>
                  {fmtSignedAmount(actionTarget.pnl, actionTarget.market)}
                </Text>
              ) : null}
            </View>

            <Text style={styles.sheetHint}>Remove this holding from your portfolio?</Text>

            <Pressable
              testID="holding-delete"
              onPress={() => void confirmDelete()}
              disabled={deleting}
              style={({ pressed }) => [
                styles.deleteBtn,
                pressed && styles.deleteBtnPressed,
                deleting && styles.deleteBtnDisabled,
              ]}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <View style={styles.deleteIconBubble}>
                    <Ionicons name="trash-outline" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deleteBtnTitle}>Delete holding</Text>
                    <Text style={styles.deleteBtnSub}>This can’t be undone</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                </>
              )}
            </Pressable>

            <Pressable
              testID="holding-action-cancel"
              onPress={closeActionMenu}
              disabled={deleting}
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelBtnPressed]}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    paddingBottom: theme.spacing.md,
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    zIndex: 2,
  },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 0 },
  title: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  titleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.colors.warning,
    marginTop: 4,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: theme.radius.pill,
    borderWidth: 1.5,
    borderColor: ACCENT_BORDER,
    backgroundColor: 'transparent',
  },
  importBtnText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '600',
  },
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
  bannerLink: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: ACCENT_DIM,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    minHeight: 78,
    justifyContent: 'center',
  },
  summaryLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  summaryValue: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  pnlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    gap: 10,
  },
  pnlLabel: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  pnlValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  pnlPctPill: {
    backgroundColor: theme.colors.bg3,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pnlPct: {
    fontSize: 13,
    fontWeight: '700',
  },
  holding: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
    gap: 6,
  },
  holdingActive: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  holdingSelected: {
    backgroundColor: DANGER_DIM,
    borderBottomColor: DANGER_BORDER,
  },
  holdingTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  holdingMid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  holdingBot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLeft: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  roi: {
    fontSize: 12,
    fontWeight: '600',
  },
  ticker: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  soldNowWrap: {
    alignItems: 'flex-end',
  },
  soldNowLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginBottom: 2,
  },
  soldNowValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  ltp: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    padding: theme.spacing.xxxl,
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: theme.spacing.md,
  },
  emptySubtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  ctaBtn: {
    marginTop: theme.spacing.lg,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: theme.colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnText: { color: theme.colors.bg, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.colors.bg2,
    borderRadius: 16,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.md,
  },
  modalRow: { color: theme.colors.textMuted, fontSize: 13, marginBottom: 6 },
  modalClose: {
    marginTop: theme.spacing.lg,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    zIndex: 2,
    backgroundColor: theme.colors.bg2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderBottomWidth: 0,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: Platform.OS === 'web' ? theme.spacing.xl : theme.spacing.xxl,
    gap: 14,
    ...Platform.select({
      web: {
        maxWidth: 480,
        width: '100%' as const,
        alignSelf: 'center' as const,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 24,
        borderBottomWidth: 1,
      },
      default: {},
    }),
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  sheetIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeaderText: { flex: 1, gap: 2 },
  sheetSymbol: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sheetMeta: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  sheetPnl: {
    fontSize: 14,
    fontWeight: '700',
  },
  sheetHint: {
    color: theme.colors.textSubtle,
    fontSize: 13,
    lineHeight: 18,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: DANGER,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  deleteBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  deleteBtnDisabled: {
    opacity: 0.7,
  },
  deleteIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  deleteBtnSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginTop: 1,
  },
  cancelBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cancelBtnPressed: {
    backgroundColor: theme.colors.border,
  },
  cancelBtnText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
