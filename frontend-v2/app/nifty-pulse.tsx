import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { api, type NiftyDirection, type NiftyPredictResponse, type NiftySignals } from '@/src/api';
import ChipRow from '@/src/components/ChipRow';
import Sparkline from '@/src/components/Sparkline';
import ScoreBar from '@/src/components/widgets/ScoreBar';
import { LoadingState, ErrorState } from '@/src/components/States';
import { theme, fmtPrice, fmtPct, changeColor } from '@/src/theme';

type Horizon = '5' | '10' | '15' | '30' | '60';

const HORIZON_OPTIONS: { value: Horizon; label: string }[] = [
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '1m' },
];

const POLL_MS = 5000; // match slower backend Yahoo poll; was 1.5s
const SPARK_WIDTH = Math.min(Dimensions.get('window').width - 48, 360);

function directionTone(d: NiftyDirection): 'pos' | 'neg' | 'neutral' {
  if (d === 'UP') return 'pos';
  if (d === 'DOWN') return 'neg';
  return 'neutral';
}

function directionColor(d: NiftyDirection): string {
  if (d === 'UP') return theme.colors.success;
  if (d === 'DOWN') return theme.colors.error;
  return theme.colors.warning;
}

function directionIcon(d: NiftyDirection): keyof typeof Ionicons.glyphMap {
  if (d === 'UP') return 'trending-up';
  if (d === 'DOWN') return 'trending-down';
  return 'remove';
}

function toneColor(tone: 'pos' | 'neg' | 'neutral'): string {
  if (tone === 'pos') return theme.colors.success;
  if (tone === 'neg') return theme.colors.error;
  return theme.colors.textMuted;
}

export default function NiftyPulseScreen() {
  const router = useRouter();
  const [horizon, setHorizon] = useState<Horizon>('10');
  const [data, setData] = useState<NiftyPredictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  /** Direction/confidence locked for the active countdown window (not live pulse). */
  const [lockedDirection, setLockedDirection] = useState<NiftyDirection>('FLAT');
  const [lockedConfidence, setLockedConfidence] = useState(0);
  const [lockedStartPrice, setLockedStartPrice] = useState<number | null>(null);
  const [lockedStartedAt, setLockedStartedAt] = useState<number | null>(null);
  const windowStartRef = useRef<number | null>(null);
  const windowHorizonRef = useRef<number>(10);
  const pendingResRef = useRef<NiftyPredictResponse | null>(null);
  const mountedRef = useRef(true);

  const startWindow = useCallback((res: NiftyPredictResponse) => {
    const startedAt = Date.now();
    windowStartRef.current = startedAt;
    windowHorizonRef.current = res.horizon_sec;
    setLockedDirection(res.direction);
    setLockedConfidence(res.confidence);
    setLockedStartPrice(res.price ?? null);
    setLockedStartedAt(startedAt);
    setCountdown(res.horizon_sec);
  }, []);

  const fetchPulse = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await api.niftyPredict(Number(horizon) as 5 | 10 | 15 | 30 | 60);
      if (!mountedRef.current) return;
      setData(res);
      setError(null);
      pendingResRef.current = res;

      // Start a window only if none is active (or horizon chip just changed).
      // Do NOT restart when live direction flips mid-window.
      if (windowStartRef.current == null) {
        startWindow(res);
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Failed to load Nifty pulse');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [horizon, startWindow]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      void fetchPulse(true);
      const id = setInterval(() => void fetchPulse(false), POLL_MS);
      return () => {
        mountedRef.current = false;
        clearInterval(id);
      };
    }, [fetchPulse]),
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (windowStartRef.current == null) {
        setCountdown(0);
        return;
      }
      const hz = windowHorizonRef.current;
      const elapsed = (Date.now() - windowStartRef.current) / 1000;
      const left = Math.max(0, hz - elapsed);
      setCountdown(left);

      // Window finished — open the next one from the latest poll (if any).
      if (left <= 0) {
        const next = pendingResRef.current;
        if (next) {
          startWindow(next);
        } else {
          windowStartRef.current = null;
        }
      }
    }, 200);
    return () => clearInterval(id);
  }, [startWindow]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchPulse(false);
  };

  const onHorizonChange = (v: Horizon) => {
    // New horizon = new window; clear so next fetch starts fresh.
    windowStartRef.current = null;
    pendingResRef.current = null;
    setCountdown(0);
    setHorizon(v);
  };

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => router.back()} />
        <LoadingState label="Starting Nifty pulse…" />
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => router.back()} />
        <ErrorState message={error} onRetry={() => void fetchPulse(true)} />
      </SafeAreaView>
    );
  }

  const direction = lockedDirection;
  const conf = lockedConfidence;
  const hitKey = `hit_rate_${horizon}s`;
  const hitRate = data?.stats?.[hitKey];
  const sparkData = (data?.ticks || []).map((t) => t.p);
  const sessionOpen = data?.session === 'open';
  const tone = directionTone(direction);
  const dColor = directionColor(direction);
  const lockedPriceLabel = fmtPrice(lockedStartPrice, 'INR');
  const lockedAtLabel = lockedStartedAt
    ? new Date(lockedStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  let predictionHeadline = 'No clear edge for this window';
  let predictionSubline = 'Wait for the next locked call.';
  if (direction === 'UP') {
    predictionHeadline = `Nifty likely to close HIGHER than ${lockedPriceLabel}`;
    predictionSubline = `The model expects the price to finish above ${lockedPriceLabel} when this ${horizon}s window ends.`;
  } else if (direction === 'DOWN') {
    predictionHeadline = `Nifty likely to close LOWER than ${lockedPriceLabel}`;
    predictionSubline = `The model expects the price to finish below ${lockedPriceLabel} when this ${horizon}s window ends.`;
  } else if (lockedStartPrice != null) {
    predictionHeadline = `Nifty likely to stay near ${lockedPriceLabel}`;
    predictionSubline = `The model does not see a strong directional edge before this ${horizon}s window ends.`;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="nifty-pulse-screen">
      <Header onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.priceBlock}>
          <Text style={styles.symbolLabel}>NIFTY 50</Text>
          <Text style={styles.price} testID="nifty-price">
            {fmtPrice(data?.price, 'INR')}
          </Text>
          <Text style={[styles.change, { color: changeColor(data?.change_pct) }]}>
            {fmtPct(data?.change_pct)}
            {data?.change != null ? `  (${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)})` : ''}
          </Text>
          <View style={[styles.sessionBadge, sessionOpen ? styles.sessionOpen : styles.sessionClosed]}>
            <View style={[styles.sessionDot, { backgroundColor: sessionOpen ? theme.colors.success : theme.colors.textSubtle }]} />
            <Text style={styles.sessionText}>{sessionOpen ? 'NSE session open' : 'NSE session closed'}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Horizon</Text>
        <ChipRow
          options={HORIZON_OPTIONS}
          value={horizon}
          onChange={onHorizonChange}
          testID="nifty-horizon-chips"
        />

        <View style={[styles.pulseCard, { borderColor: dColor + '55' }]} testID="nifty-direction-card">
          <View style={styles.pulseRow}>
            <Ionicons name={directionIcon(direction)} size={36} color={dColor} />
            <Text style={[styles.directionText, { color: dColor }]}>{direction}</Text>
          </View>
          <Text style={styles.predictionEyebrow}>{horizon}s prediction</Text>
          <Text style={styles.predictionHeadline}>{predictionHeadline}</Text>
          <Text style={styles.predictionSubline}>{predictionSubline}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Text style={styles.metaLabel}>Start price</Text>
              <Text style={styles.metaValue}>{lockedPriceLabel}</Text>
            </View>
            <View style={styles.metaPill}>
              <Text style={styles.metaLabel}>Locked at</Text>
              <Text style={styles.metaValue}>{lockedAtLabel ?? '—'}</Text>
            </View>
          </View>
          <Text style={styles.countdown}>
            {sessionOpen
              ? countdown > 0
                ? `Window ${countdown.toFixed(1)}s`
                : 'Refreshing…'
              : 'Predictions pause outside market hours'}
          </Text>
          <ScoreBar label="Confidence" value={conf} tone={tone} />
          <View style={styles.hitRow}>
            <Text style={styles.hitLabel}>Hit rate ({horizon}s)</Text>
            <Text style={styles.hitValue}>
              {hitRate != null && data?.stats?.n
                ? `${(hitRate * 100).toFixed(0)}% · n=${data.stats.n}`
                : 'Collecting…'}
            </Text>
          </View>
        </View>

        {data?.signals ? <SignalsPanel signals={data.signals} /> : null}

        <View style={styles.sparkWrap}>
          <Text style={styles.sectionLabel}>Recent ticks</Text>
          <Sparkline
            data={sparkData}
            width={SPARK_WIDTH}
            height={64}
            strokeWidth={2}
            fill
            color={dColor}
          />
          <Text style={styles.tickMeta}>{sparkData.length} ticks · poll #{data?.poll_count ?? 0}</Text>
        </View>

        {data?.disclaimer ? (
          <Text style={styles.disclaimer}>{data.disclaimer}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SignalsPanel({ signals }: { signals: NiftySignals }) {
  const bankTone: 'pos' | 'neg' | 'neutral' =
    signals.bank_nifty.confirms === 'up' ? 'pos' : signals.bank_nifty.confirms === 'down' ? 'neg' : 'neutral';
  const vixTone: 'pos' | 'neg' | 'neutral' =
    signals.india_vix.pressure === 'bullish' ? 'pos' : signals.india_vix.pressure === 'bearish' ? 'neg' : 'neutral';
  const volTone: 'pos' | 'neg' | 'neutral' =
    signals.volume.label === 'high' ? 'pos' : signals.volume.label === 'low' ? 'neg' : 'neutral';
  const rangePct = Math.round(signals.range_position * 100);

  return (
    <View style={styles.signalsWrap}>
      <Text style={styles.sectionLabel}>Signals</Text>
      <View style={styles.signalsCard}>
        <SignalRow
          icon="business-outline"
          label="Bank Nifty"
          value={`${signals.bank_nifty.confirms.toUpperCase()} · ${signals.bank_nifty.mom_bps.toFixed(1)}bps`}
          tone={bankTone}
        />
        <SignalRow
          icon="pulse-outline"
          label="India VIX"
          value={`${signals.india_vix.pressure.toUpperCase()} · ${signals.india_vix.mom_bps.toFixed(1)}bps`}
          tone={vixTone}
        />
        <SignalRow
          icon="bar-chart-outline"
          label="ETF volume"
          value={`${signals.volume.label.toUpperCase()} · ${signals.volume.surge_ratio.toFixed(2)}x`}
          tone={volTone}
        />
        <View style={styles.rangeRow}>
          <View style={styles.rangeLabelRow}>
            <Ionicons name="resize-outline" size={14} color={theme.colors.textMuted} />
            <Text style={styles.signalLabel}>Day range position</Text>
            <Text style={styles.signalValue}>{rangePct}%</Text>
          </View>
          <View style={styles.rangeTrack}>
            <View style={[styles.rangeDot, { left: `${rangePct}%` }]} />
          </View>
          <View style={styles.rangeEnds}>
            <Text style={styles.rangeEndText}>Low</Text>
            <Text style={styles.rangeEndText}>High</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function SignalRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: 'pos' | 'neg' | 'neutral';
}) {
  return (
    <View style={styles.signalRow}>
      <Ionicons name={icon} size={14} color={theme.colors.textMuted} />
      <Text style={styles.signalLabel}>{label}</Text>
      <Text style={[styles.signalValue, { color: toneColor(tone) }]}>{value}</Text>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} testID="nifty-pulse-back" hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Nifty Pulse</Text>
        <Text style={styles.subtitle}>5–30s micro-momentum</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    gap: 4,
  },
  backBtn: { padding: 4, marginRight: 4 },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  scroll: { paddingBottom: 48 },
  priceBlock: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  symbolLabel: {
    color: theme.colors.textSubtle,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  price: {
    color: theme.colors.text,
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  change: { fontSize: 15, fontWeight: '600', marginTop: 4, fontVariant: ['tabular-nums'] },
  sessionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  sessionOpen: { borderColor: 'rgba(16,185,129,0.35)', backgroundColor: 'rgba(16,185,129,0.1)' },
  sessionClosed: { borderColor: theme.colors.border, backgroundColor: theme.colors.bg2 },
  sessionDot: { width: 6, height: 6, borderRadius: 3 },
  sessionText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
  sectionLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: theme.spacing.lg,
    marginBottom: 4,
    marginTop: theme.spacing.sm,
  },
  pulseCard: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    gap: 10,
  },
  pulseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  directionText: { fontSize: 40, fontWeight: '800', letterSpacing: 1 },
  predictionEyebrow: {
    color: theme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  predictionHeadline: {
    color: theme.colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  predictionSubline: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  metaPill: {
    minWidth: 132,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.bg3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metaLabel: { color: theme.colors.textSubtle, fontSize: 11, marginBottom: 2 },
  metaValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countdown: { color: theme.colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  hitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  hitLabel: { color: theme.colors.textSubtle, fontSize: 12 },
  hitValue: { color: theme.colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  signalsWrap: { marginTop: theme.spacing.lg },
  signalsCard: {
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 10,
  },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signalLabel: { flex: 1, color: theme.colors.textMuted, fontSize: 12.5 },
  signalValue: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rangeRow: { marginTop: 4 },
  rangeLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rangeTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.bg3,
    position: 'relative',
  },
  rangeDot: {
    position: 'absolute',
    top: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.text,
    marginLeft: -5,
  },
  rangeEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  rangeEndText: { color: theme.colors.textSubtle, fontSize: 10 },
  sparkWrap: { paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.xl },
  tickMeta: { color: theme.colors.textSubtle, fontSize: 11, marginTop: 8 },
  disclaimer: {
    color: theme.colors.textSubtle,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.xl,
  },
});
