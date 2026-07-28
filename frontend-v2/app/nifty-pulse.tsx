import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  api,
  type NiftyDirection,
  type NiftyPredictResponse,
  type NiftyPredictionDailyLogItem,
  type NiftyPredictionDailyLogsResponse,
  type NiftyPredictionLogDate,
  type NiftySignals,
} from '@/src/api';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';
import ChipRow from '@/src/components/ChipRow';
import Sparkline from '@/src/components/Sparkline';
import ScoreBar from '@/src/components/widgets/ScoreBar';
import { LoadingState, ErrorState } from '@/src/components/States';
import { theme, fmtPrice, fmtPct, changeColor } from '@/src/theme';
import { storage } from '@/src/utils/storage';

type Horizon = '5' | '10' | '15' | '30' | '60';

const HORIZON_OPTIONS: { value: Horizon; label: string }[] = [
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '1m' },
];
const HORIZON_VALUES = new Set<string>(HORIZON_OPTIONS.map((o) => o.value));
const HORIZON_STORAGE_KEY = 'nifty_pulse_horizon';

function parseHorizon(value: unknown, fallback: Horizon = '10'): Horizon {
  const raw = Array.isArray(value) ? value[0] : value;
  const s = String(raw ?? '');
  return HORIZON_VALUES.has(s) ? (s as Horizon) : fallback;
}

const POLL_MS = 5000; // match slower backend Yahoo poll; was 1.5s
const LOGS_POLL_MS = 15000; // refresh 1m prediction log without pull-to-refresh
const SPARK_WIDTH = Math.min(Dimensions.get('window').width - 48, 360);
const IST_OFFSET_MINUTES = 330;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toIstDateString(date = new Date()): string {
  // Convert using a fixed UTC+5:30 offset (works even if Intl timeZone isn't supported)
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function formatLogTime(value: string | null): string {
  if (!value) return 'Pending';
  const raw = value.trim();

  // Backend returns ISO strings without an explicit timezone offset, so JS treats them as local.
  // Force UTC parsing by appending `Z` when no offset is present.
  const hasTz = /([zZ]|[+\-]\d{2}:\d{2})$/.test(raw);
  const utcMs = Date.parse(hasTz ? raw : `${raw}Z`);
  if (Number.isNaN(utcMs)) {
    // Fallback to device formatting.
    return new Date(raw).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  const istMs = utcMs + IST_OFFSET_MINUTES * 60 * 1000;
  const d = new Date(istMs);
  let hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${pad2(hours)}:${pad2(minutes)} ${ampm}`;
}

function formatMonthLabel(monthStart: string): string {
  return new Date(`${monthStart}T00:00:00`).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(monthStart: string, delta: number): string {
  const dt = new Date(`${monthStart}T00:00:00`);
  dt.setMonth(dt.getMonth() + delta);
  return formatLocalDateKey(dt).slice(0, 7) + '-01';
}

function verdictColor(verdict: 'pending' | 'correct' | 'wrong'): string {
  if (verdict === 'correct') return theme.colors.success;
  if (verdict === 'wrong') return theme.colors.error;
  return theme.colors.warning;
}

function buildCalendarCells(
  monthStart: string,
  selectedDate: string,
  countsByDate: Map<string, number>,
) {
  const monthDate = new Date(`${monthStart}T00:00:00`);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingStart = new Date(year, month, 1 - firstWeekday);
  const cells: {
    date: string;
    day: number;
    inMonth: boolean;
    isSelected: boolean;
    isToday: boolean;
    count: number;
  }[] = [];

  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(leadingStart);
    cellDate.setDate(leadingStart.getDate() + i);
    const date = formatLocalDateKey(cellDate);
    cells.push({
      date,
      day: cellDate.getDate(),
      inMonth: i >= firstWeekday && i < firstWeekday + daysInMonth,
      isSelected: date === selectedDate,
      isToday: date === toIstDateString(),
      count: countsByDate.get(date) ?? 0,
    });
  }

  return cells;
}

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
  return 'remove-outline';
}

function toneColor(tone: 'pos' | 'neg' | 'neutral'): string {
  if (tone === 'pos') return theme.colors.success;
  if (tone === 'neg') return theme.colors.error;
  return theme.colors.warning;
}

export default function NiftyPulseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ horizon?: string | string[] }>();
  const [horizon, setHorizon] = useState<Horizon>(() => parseHorizon(params.horizon, '10'));
  const [data, setData] = useState<NiftyPredictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  /** Direction/confidence locked for the active countdown window (not live pulse). */
  const [lockedDirection, setLockedDirection] = useState<NiftyDirection>('DOWN');
  const [lockedConfidence, setLockedConfidence] = useState(0);
  const [lockedStartPrice, setLockedStartPrice] = useState<number | null>(null);
  const [lockedStartedAt, setLockedStartedAt] = useState<number | null>(null);
  const windowStartRef = useRef<number | null>(null);
  const windowHorizonRef = useRef<number>(10);
  const pendingResRef = useRef<NiftyPredictResponse | null>(null);
  const mountedRef = useRef(true);
  const [selectedDate, setSelectedDate] = useState(() => toIstDateString());
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(toIstDateString()));
  const [logDates, setLogDates] = useState<NiftyPredictionLogDate[]>([]);
  const [logData, setLogData] = useState<NiftyPredictionDailyLogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const loadLogDates = useCallback(async () => {
    const res = await api.niftyPredictionLogDates(90);
    if (!mountedRef.current) return res;
    setLogDates(res.dates);
    return res;
  }, []);

  const loadLogs = useCallback(async (
    date: string,
    options: { refreshingMode?: boolean; silent?: boolean } = {},
  ) => {
    const { refreshingMode = false, silent = false } = options;
    if (refreshingMode) setLogsRefreshing(true);
    else if (!silent) {
      setLogsLoading(true);
      // Clear previous day's rows immediately so old data never flashes.
      setLogData({ symbol: '^NSEI', date, count: 0, logs: [], disclaimer: '' });
    }
    try {
      const res = await api.niftyPredictionLogsByDate(date, 500);
      if (!mountedRef.current) return;
      // Ignore stale responses if the user already picked another day.
      if (date !== selectedDateRef.current) return;
      setLogData(res);
      setLogsError(null);
    } catch (e: any) {
      if (!mountedRef.current) return;
      if (date !== selectedDateRef.current) return;
      if (!silent) {
        setLogData({ symbol: '^NSEI', date, count: 0, logs: [], disclaimer: '' });
      }
      setLogsError(e?.message || 'Failed to load 1m prediction logs');
    } finally {
      if (!mountedRef.current) return;
      if (date !== selectedDateRef.current) return;
      setLogsLoading(false);
      setLogsRefreshing(false);
    }
  }, []);

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
      void loadLogDates().catch(() => undefined);
      const pulseId = setInterval(() => void fetchPulse(false), POLL_MS);
      const logsId = setInterval(() => {
        void loadLogDates().catch(() => undefined);
        void loadLogs(selectedDateRef.current, { silent: true });
      }, LOGS_POLL_MS);
      return () => {
        mountedRef.current = false;
        clearInterval(pulseId);
        clearInterval(logsId);
      };
    }, [fetchPulse, loadLogDates, loadLogs]),
  );

  useEffect(() => {
    void loadLogs(selectedDate);
  }, [loadLogs, selectedDate]);

  useEffect(() => {
    const fromUrl = params.horizon != null ? parseHorizon(params.horizon) : null;
    if (fromUrl) {
      if (fromUrl !== horizon) setHorizon(fromUrl);
      return;
    }
    let cancelled = false;
    void storage.getItem(HORIZON_STORAGE_KEY, '10').then((saved) => {
      if (cancelled) return;
      const restored = parseHorizon(saved, '10');
      setHorizon(restored);
      router.setParams({ horizon: restored });
    });
    return () => {
      cancelled = true;
    };
    // Restore once from URL/storage on mount; chip changes update URL themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    void loadLogDates().catch(() => undefined);
    void loadLogs(selectedDate, { refreshingMode: true });
  };

  const onHorizonChange = (v: Horizon) => {
    // New horizon = new window; clear so next fetch starts fresh.
    windowStartRef.current = null;
    pendingResRef.current = null;
    setCountdown(0);
    setHorizon(v);
    void storage.setItem(HORIZON_STORAGE_KEY, v);
    router.setParams({ horizon: v });
  };

  const countsByDate = useMemo(
    () => new Map(logDates.map((item) => [item.date, item.count])),
    [logDates],
  );
  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth, selectedDate, countsByDate),
    [calendarMonth, countsByDate, selectedDate],
  );
  const visibleLogs = useMemo(() => {
    const rows = logData?.logs ?? [];
    // Only show rows for the currently selected day (guards against stale state).
    const filtered =
      logData?.date && logData.date !== selectedDate
        ? []
        : rows;
    return [...filtered].reverse();
  }, [logData, selectedDate]);

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

  const predictionHeadline = direction === 'FLAT'
    ? 'No clear edge — standing aside'
    : direction === 'UP'
      ? `Nifty likely to close HIGHER than ${lockedPriceLabel}`
      : `Nifty likely to close LOWER than ${lockedPriceLabel}`;
  const predictionSubline = direction === 'FLAT'
    ? 'Meta-model confidence is too low for a directional call this window.'
    : direction === 'UP'
      ? `The model expects the price to finish above ${lockedPriceLabel} when this ${horizon}s window ends.`
      : `The model expects the price to finish below ${lockedPriceLabel} when this ${horizon}s window ends.`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="nifty-pulse-screen">
      <Header onBack={() => router.back()} />
      <AppScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
            {countdown > 0 ? `Window ${countdown.toFixed(1)}s` : 'Refreshing…'}
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

        <View style={styles.logSection}>
          <View style={styles.logHeaderRow}>
            <Text style={styles.sectionLabel}>1m Prediction Log</Text>
            <Text style={styles.logHeaderMeta}>
              Shared for all users
            </Text>
          </View>

          <View style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity
                onPress={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}
                style={styles.calendarNavBtn}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="chevron-back" size={16} color={theme.colors.text} />
              </TouchableOpacity>
              <Text style={styles.calendarMonthLabel}>{formatMonthLabel(calendarMonth)}</Text>
              <TouchableOpacity
                onPress={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}
                style={styles.calendarNavBtn}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="chevron-forward" size={16} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((label) => (
                <View key={label} style={styles.weekdayCell}>
                  <Text style={styles.weekdayText}>{label.slice(0, 1)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {calendarCells.map((cell) => {
                const hasData = cell.count > 0;
                return (
                  <TouchableOpacity
                    key={cell.date}
                    style={styles.dayCellWrap}
                    activeOpacity={0.65}
                    onPress={() => {
                      setSelectedDate(cell.date);
                      setCalendarMonth(startOfMonth(cell.date));
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: cell.isSelected }}
                    accessibilityLabel={`${cell.date}${hasData ? `, ${cell.count} predictions` : ''}`}
                  >
                    <View
                      style={[
                        styles.dayCell,
                        cell.isToday && !cell.isSelected ? styles.dayCellToday : null,
                        cell.isSelected ? styles.dayCellSelected : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayCellText,
                          !cell.inMonth ? styles.dayCellTextMuted : null,
                          cell.isToday && !cell.isSelected ? styles.dayCellTextToday : null,
                          cell.isSelected ? styles.dayCellTextSelected : null,
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.dayDot,
                        hasData ? styles.dayDotVisible : null,
                        cell.isSelected && hasData ? styles.dayDotSelected : null,
                      ]}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.logsCard}>
            <View style={styles.logsTitleRow}>
              <View>
                <Text style={styles.logsTitle}>{selectedDate}</Text>
                {visibleLogs[0]?.predicted_at ? (
                  <Text style={styles.logsLatest}>
                    Latest: {formatLogTime(visibleLogs[0].predicted_at)} IST
                  </Text>
                ) : null}
              </View>
              <Text style={styles.logsCount}>
                {logsRefreshing ? 'Refreshing…' : `${logData?.count ?? 0} rows`}
              </Text>
            </View>

            {logsLoading ? (
              <Text style={styles.logsEmpty}>Loading daily logs…</Text>
            ) : logsError ? (
              <Text style={styles.logsEmpty}>{logsError}</Text>
            ) : (
              <>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, styles.priceColumn]}>Predicted price</Text>
                  <Text style={[styles.tableHeaderText, styles.priceColumn]}>Actual price</Text>
                  <Text style={[styles.tableHeaderText, styles.resultColumn]}>Result</Text>
                </View>
                {visibleLogs.length === 0 ? (
                  <View style={styles.emptyTableRow}>
                    <Text style={styles.logsEmpty}>No records for this date</Text>
                  </View>
                ) : (
                  visibleLogs.map((item) => (
                    <LogRow key={item.id} item={item} />
                  ))
                )}
              </>
            )}
          </View>
        </View>

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
      </AppScrollView>
    </SafeAreaView>
  );
}

function LogRow({ item }: { item: NiftyPredictionDailyLogItem }) {
  const verdict = item.verdict ?? 'pending';
  const resultColor = verdictColor(verdict);
  return (
    <View style={styles.tableRow}>
      <View style={styles.priceColumn}>
        <Text style={styles.tableValue}>{fmtPrice(item.predicted_price, 'INR')}</Text>
        <Text style={styles.tableMeta}>
          {formatLogTime(item.predicted_at)} · {item.direction}
        </Text>
      </View>
      <View style={styles.priceColumn}>
        <Text style={styles.tableValue}>
          {item.actual_price != null ? fmtPrice(item.actual_price, 'INR') : 'Pending'}
        </Text>
        <Text style={styles.tableMeta}>
          {item.actual_direction ?? 'Awaiting close'} · {formatLogTime(item.resolved_at)}
        </Text>
      </View>
      <View style={styles.resultColumn}>
        <View style={[styles.resultPill, { borderColor: resultColor + '55', backgroundColor: resultColor + '14' }]}>
          <Text style={[styles.resultPillText, { color: resultColor }]}>
            {verdict.toUpperCase()}
          </Text>
        </View>
      </View>
    </View>
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
  logSection: { marginTop: theme.spacing.xl, gap: theme.spacing.md },
  logHeaderRow: {
    paddingHorizontal: theme.spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logHeaderMeta: { color: theme.colors.textSubtle, fontSize: 11 },
  calendarCard: {
    marginHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.sm,
  },
  calendarNavBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg3,
  },
  calendarMonthLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 2 },
  weekdayCell: {
    width: '14.2857%',
    alignItems: 'center',
    paddingBottom: 2,
  },
  weekdayText: {
    color: theme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 2,
  },
  dayCellWrap: {
    width: '14.2857%',
    alignItems: 'center',
    paddingVertical: 2,
  },
  dayCell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: theme.colors.warning + '99',
  },
  dayCellSelected: {
    backgroundColor: theme.colors.radar,
  },
  dayCellText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dayCellTextMuted: { color: theme.colors.textSubtle, opacity: 0.45 },
  dayCellTextToday: { color: theme.colors.warning, fontWeight: '700' },
  dayCellTextSelected: { color: '#0B1220', fontWeight: '800' },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  dayDotVisible: { backgroundColor: theme.colors.success },
  dayDotSelected: { backgroundColor: theme.colors.radar },
  logsCard: {
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 10,
  },
  logsTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logsTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  logsLatest: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  logsCount: { color: theme.colors.textMuted, fontSize: 12 },
  logsEmpty: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  emptyTableRow: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 12,
  },
  tableHeaderText: {
    color: theme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  priceColumn: { flex: 1.25 },
  resultColumn: { flex: 0.9, alignItems: 'flex-start', justifyContent: 'center' },
  tableValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tableMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
  resultPill: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resultPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
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
