import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StockEvents } from '@/src/api';
import { theme, fmtNum } from '@/src/theme';
import { fmtDay, daysUntilLabel, relTime } from '@/src/utils/date';

type Tab = 'calendar' | 'analysts' | 'earnings';

export default function EventsWidget({ events, currency }: { events: StockEvents | null; currency: string }) {
  const [tab, setTab] = useState<Tab>('calendar');
  if (!events) return null;
  const cal = events.calendar;
  const hasCal = cal.next_earnings_epoch || cal.ex_dividend_epoch || cal.dividend_date_epoch;
  const actions = events.analyst_actions || [];
  const earnings = events.earnings_history || [];

  const tabs: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; count?: number }[] = [
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'analysts', label: 'Analyst Actions', icon: 'people', count: actions.length },
    { key: 'earnings', label: 'Earnings', icon: 'podium', count: earnings.length },
  ];

  return (
    <View style={styles.wrap}>
      {/* inner tab selector */}
      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <View key={t.key} style={{ flex: 1 }}>
              <Text
                onPress={() => setTab(t.key)}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                testID={`events-tab-${t.key}`}
              >
                {t.label}{typeof t.count === 'number' && t.count > 0 ? ` (${t.count})` : ''}
              </Text>
            </View>
          );
        })}
      </View>

      {tab === 'calendar' && (
        <View style={{ gap: 10 }}>
          {!hasCal ? (
            <Empty icon="calendar-outline" text="No scheduled events." />
          ) : (
            <View style={styles.calRow}>
              <CalTile
                icon="podium"
                accent="#60A5FA"
                label="Next Earnings"
                date={fmtDay(cal.next_earnings_epoch)}
                badge={daysUntilLabel(cal.next_earnings_epoch)}
              />
              <CalTile
                icon="cash"
                accent="#34D399"
                label="Ex-Dividend"
                date={fmtDay(cal.ex_dividend_epoch)}
                badge={daysUntilLabel(cal.ex_dividend_epoch)}
              />
              <CalTile
                icon="wallet"
                accent="#A78BFA"
                label="Dividend Pay"
                date={fmtDay(cal.dividend_date_epoch)}
                badge={daysUntilLabel(cal.dividend_date_epoch)}
              />
            </View>
          )}
          {cal.eps_estimate_avg != null && (
            <View style={styles.estCard}>
              <Text style={styles.estTitle}>Next Report — EPS Estimate</Text>
              <View style={styles.estRow}>
                <Est label="Low" value={fmtNum(cal.eps_estimate_low)} />
                <Est label="Avg" value={fmtNum(cal.eps_estimate_avg)} highlight />
                <Est label="High" value={fmtNum(cal.eps_estimate_high)} />
              </View>
            </View>
          )}
        </View>
      )}

      {tab === 'analysts' && (
        <View>
          {actions.length === 0 ? (
            <Empty icon="people-outline" text="No recent analyst actions." />
          ) : (
            <View style={styles.timeline}>
              {actions.slice(0, 10).map((a, i) => {
                const color = a.tone === 'pos' ? theme.colors.success : a.tone === 'neg' ? theme.colors.error : theme.colors.textMuted;
                const isLast = i === Math.min(actions.length, 10) - 1;
                return (
                  <View key={i} style={styles.tlRow}>
                    <View style={styles.tlGutter}>
                      <View style={[styles.tlDot, { backgroundColor: color }]} />
                      {!isLast && <View style={styles.tlLine} />}
                    </View>
                    <View style={styles.tlBody}>
                      <View style={styles.tlHead}>
                        <Text style={styles.tlFirm} numberOfLines={1}>{a.firm || 'Analyst'}</Text>
                        <Text style={styles.tlTime}>{relTime(a.date_epoch)}</Text>
                      </View>
                      <View style={styles.tlGrades}>
                        {a.from_grade && a.from_grade !== a.to_grade ? (
                          <>
                            <Text style={styles.gradeFrom}>{a.from_grade}</Text>
                            <Ionicons name="arrow-forward" size={11} color={theme.colors.textSubtle} />
                          </>
                        ) : null}
                        <Text style={[styles.gradeTo, { color }]}>{a.to_grade || a.action || '—'}</Text>
                        <ActionBadge action={a.action} tone={a.tone} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {tab === 'earnings' && (
        <View>
          {earnings.length === 0 ? (
            <Empty icon="podium-outline" text="No earnings history." />
          ) : (
            <View style={{ gap: 8 }}>
              {earnings.map((e, i) => {
                const beat = (e.surprise_pct ?? 0) >= 0;
                const color = beat ? theme.colors.success : theme.colors.error;
                return (
                  <View key={i} style={styles.earnRow}>
                    <Text style={styles.earnQ}>{fmtDay(e.quarter_epoch)}</Text>
                    <View style={styles.earnMid}>
                      <Text style={styles.earnEps}>
                        <Text style={styles.earnEpsActual}>{fmtNum(e.eps_actual)}</Text>
                        <Text style={styles.earnEpsEst}>  est {fmtNum(e.eps_estimate)}</Text>
                      </Text>
                    </View>
                    <View style={[styles.surpBadge, { backgroundColor: color + '22' }]}>
                      <Ionicons name={beat ? 'trending-up' : 'trending-down'} size={11} color={color} />
                      <Text style={[styles.surpText, { color }]}>
                        {beat ? 'Beat' : 'Miss'} {e.surprise_pct != null ? `${Math.abs(e.surprise_pct).toFixed(1)}%` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function ActionBadge({ action, tone }: { action: string | null; tone: string }) {
  if (!action) return null;
  const map: Record<string, string> = { up: 'Upgrade', down: 'Downgrade', init: 'Initiated', reit: 'Reiterated', main: 'Maintained' };
  const label = map[action] || action;
  const color = tone === 'pos' ? theme.colors.success : tone === 'neg' ? theme.colors.error : theme.colors.textMuted;
  return (
    <View style={[styles.actBadge, { backgroundColor: color + '1A' }]}>
      <Text style={[styles.actBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function CalTile({ icon, accent, label, date, badge }: { icon: keyof typeof Ionicons.glyphMap; accent: string; label: string; date: string; badge: string }) {
  return (
    <View style={[styles.calTile, { borderColor: accent + '44' }]}>
      <View style={[styles.calIcon, { backgroundColor: accent + '22' }]}>
        <Ionicons name={icon} size={15} color={accent} />
      </View>
      <Text style={styles.calLabel}>{label}</Text>
      <Text style={styles.calDate}>{date}</Text>
      {badge ? <Text style={[styles.calBadge, { color: accent }]}>{badge}</Text> : null}
    </View>
  );
}

function Est({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.est}>
      <Text style={styles.estLabel}>{label}</Text>
      <Text style={[styles.estValue, highlight && { color: theme.colors.text, fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={22} color={theme.colors.textSubtle} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  tabBar: { flexDirection: 'row', backgroundColor: theme.colors.bg2, borderRadius: theme.radius.pill, padding: 3, borderWidth: 1, borderColor: theme.colors.border },
  tabBtn: { textAlign: 'center', color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', paddingVertical: 8, borderRadius: 999, overflow: 'hidden' },
  tabBtnActive: { backgroundColor: theme.colors.text, color: theme.colors.bg },
  calRow: { flexDirection: 'row', gap: 8 },
  calTile: { flex: 1, backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.sm, alignItems: 'flex-start' },
  calIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  calLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '600' },
  calDate: { color: theme.colors.text, fontSize: 12, fontWeight: '700', marginTop: 3 },
  calBadge: { fontSize: 10, fontWeight: '700', marginTop: 3 },
  estCard: { backgroundColor: theme.colors.bg2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.md },
  estTitle: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  estRow: { flexDirection: 'row', justifyContent: 'space-around' },
  est: { alignItems: 'center' },
  estLabel: { color: theme.colors.textSubtle, fontSize: 10, fontWeight: '600' },
  estValue: { color: theme.colors.textMuted, fontSize: 15, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  timeline: { paddingLeft: 2 },
  tlRow: { flexDirection: 'row', gap: 12 },
  tlGutter: { width: 12, alignItems: 'center' },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  tlLine: { flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 2 },
  tlBody: { flex: 1, paddingBottom: 16 },
  tlHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tlFirm: { color: theme.colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  tlTime: { color: theme.colors.textSubtle, fontSize: 11 },
  tlGrades: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  gradeFrom: { color: theme.colors.textSubtle, fontSize: 12, textDecorationLine: 'line-through' },
  gradeTo: { fontSize: 13, fontWeight: '700' },
  actBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  actBadgeText: { fontSize: 10, fontWeight: '700' },
  earnRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg2, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.md, paddingVertical: 10 },
  earnQ: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600', width: 92 },
  earnMid: { flex: 1 },
  earnEps: { fontSize: 13 },
  earnEpsActual: { color: theme.colors.text, fontWeight: '700' },
  earnEpsEst: { color: theme.colors.textSubtle, fontSize: 11 },
  surpBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  surpText: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 26, gap: 8 },
  emptyText: { color: theme.colors.textSubtle, fontSize: 12 },
});
