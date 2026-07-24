import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, Market } from '@/src/api';
import { theme } from '@/src/theme';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import ScreenHeader from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState } from '@/src/components/States';
import type { IngestionRun, IngestionStatus } from '@/src/types/ingestion';

function statusColor(status: string) {
  if (status === 'completed' || status === 'dry_run') return theme.colors.success;
  if (status.includes('error') || status === 'failed') return theme.colors.error;
  if (status === 'queued' || status === 'running') return theme.colors.warning;
  return theme.colors.textMuted;
}

function RunRow({ run }: { run: IngestionRun }) {
  const label = run.symbol || run.partition || run.market || run.run_id.slice(0, 8);
  return (
    <View style={styles.runRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.runTitle}>{label}</Text>
        <Text style={styles.runMeta}>
          {run.run_type || 'run'} · {run.datasets?.length ?? 0} datasets
          {run.plan?.symbol_count != null ? ` · ${run.plan.symbol_count} symbols` : ''}
        </Text>
      </View>
      <Text style={[styles.runStatus, { color: statusColor(run.status) }]}>{run.status}</Text>
    </View>
  );
}

export default function IngestionScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('AAPL');
  const [market, setMarket] = useState<Market>('US');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      setError(null);
      const data = await api.ingestionStatus(force);
      setStatus(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load ingestion status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    try {
      setBusy(key);
      setLastAction(null);
      const res = await fn();
      setLastAction(JSON.stringify(res, null, 2));
      await load(true);
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !status) return <LoadingState message="Loading ingestion status…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Ingestion"
        subtitle="Investing.com batch sync & refresh"
        right={
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={theme.colors.textMuted} />
          </TouchableOpacity>
        }
      />

      {error ? <ErrorState message={error} onRetry={() => load(true)} /> : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={theme.colors.textMuted} />}
      >
        <Text style={styles.section}>Partitions</Text>
        {(status?.partitions || []).map((p) => (
          <View key={p.partition} style={styles.card}>
            <Text style={styles.cardTitle}>{p.label}</Text>
            <Text style={styles.cardMeta}>{p.partition} · {p.market} · {p.symbol_count} symbols</Text>
          </View>
        ))}

        <Text style={styles.section}>Smart scrape</Text>
        <View style={styles.card}>
          <Text style={styles.cardMeta}>
            Gated datasets: {(status?.smart_scrape?.datasets || []).length} total
          </Text>
          {status?.tiers ? (
            <Text style={styles.cardMeta}>
              Tiers: T1={status.tiers.tier1?.length ?? 0} · T2={status.tiers.tier2?.length ?? 0} · T3={status.tiers.tier3?.length ?? 0}
            </Text>
          ) : null}
          {status?.universe_coverage?.summary ? (
            <Text style={styles.cardMeta}>
              Universe coverage: US instruments {status.universe_coverage.summary.us_instruments_pct ?? 0}%
              · IN {status.universe_coverage.summary.in_instruments_pct ?? 0}%
            </Text>
          ) : null}
          {status?.freshness_summary ? (
            <Text style={styles.cardMeta}>
              Freshness: {Object.entries(status.freshness_summary).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </Text>
          ) : null}
          {status?.prerequisites ? (
            <Text style={[styles.cardMeta, { color: status.prerequisites.ok ? theme.colors.success : theme.colors.warning }]}>
              Prerequisites {status.prerequisites.ok ? 'OK' : 'needs attention'}
              {status.prerequisites.tier_coverage
                ? ` · T1 ${status.prerequisites.tier_coverage.tier1_pct}% · T3 ${status.prerequisites.tier_coverage.tier3_pct}%`
                : ''}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.chip, force && styles.chipActive, { alignSelf: 'flex-start' }]}
            onPress={() => setForce((v) => !v)}
          >
            <Text style={[styles.chipText, force && styles.chipTextActive]}>
              Force refresh {force ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>Quick refresh</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Symbol</Text>
          <TextInput
            style={styles.input}
            value={symbol}
            onChangeText={setSymbol}
            autoCapitalize="characters"
            placeholder="AAPL or RELIANCE.NS"
            placeholderTextColor={theme.colors.textSubtle}
          />
          <View style={styles.row}>
            {(['US', 'IN'] as Market[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.chip, market === m && styles.chipActive]}
                onPress={() => setMarket(m)}
              >
                <Text style={[styles.chipText, market === m && styles.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ActionButton
            label="Preview symbol (smart dry-run)"
            busy={busy === 'preview'}
            onPress={() =>
              runAction('preview', () =>
                api.ingestionPreviewSymbol(symbol.trim(), { market, force }),
              )
            }
          />
          <ActionButton
            label={force ? 'Refresh symbol — forced (async)' : 'Refresh symbol (async)'}
            busy={busy === 'symbol'}
            onPress={() => runAction('symbol', () => api.ingestionRefreshSymbol(symbol.trim(), { market, force }))}
          />
        </View>

        <View style={styles.card}>
          <ActionButton
            label={`Refresh ${market} market (async)`}
            busy={busy === 'market'}
            onPress={() => runAction('market', () => api.ingestionRefreshMarket({ market, limit: 5, force }))}
          />
          <ActionButton
            label="Nightly dry-run (sync)"
            busy={busy === 'nightly-dry'}
            onPress={() => runAction('nightly-dry', () => api.ingestionRefreshNightly({ dry_run: true, sync: true, limit: 3 }))}
          />
          <ActionButton
            label="Dataset dry-run: financial_statements (US, limit 3)"
            busy={busy === 'dataset'}
            onPress={() =>
              runAction('dataset', () =>
                api.ingestionRefreshDataset({
                  dataset: 'financial_statements',
                  market: 'US',
                  sync: true,
                  dry_run: true,
                  limit: 3,
                }),
              )
            }
          />
        </View>

        {lastAction ? (
          <View style={styles.card}>
            <Text style={styles.section}>Last response</Text>
            <Text style={styles.mono}>{lastAction}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>Recent runs</Text>
        {(status?.recent_runs || []).length === 0 ? (
          <Text style={styles.empty}>No ingestion runs yet.</Text>
        ) : (
          (status?.recent_runs || []).map((run) => <RunRow key={run.run_id} run={run} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color={theme.colors.text} size="small" /> : <Text style={styles.actionText}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.lg, paddingBottom: 48, gap: theme.spacing.sm },
  iconBtn: { padding: theme.spacing.sm },
  section: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  card: {
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12 },
  label: { color: theme.colors.textMuted, fontSize: 12 },
  input: {
    backgroundColor: theme.colors.bg3,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: 15,
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.accentBg, borderColor: theme.colors.success },
  chipText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: theme.colors.success },
  actionBtn: {
    backgroundColor: theme.colors.bg3,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  runTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  runMeta: { color: theme.colors.textSubtle, fontSize: 12, marginTop: 2 },
  runStatus: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  empty: { color: theme.colors.textSubtle, fontSize: 13 },
  mono: { color: theme.colors.textMuted, fontSize: 11, fontFamily: 'monospace' },
});
