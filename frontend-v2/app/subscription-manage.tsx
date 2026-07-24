import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

import { theme } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import { useEntitlement } from '@/src/hooks/useEntitlement';
import { api, type PaymentHistoryItem } from '@/src/api';
import { downloadReceipt } from '@/src/payments/receipt';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';

const ACCENT = authTheme.colors.primary;

function formatInr(paise?: number | null): string {
  const n = Number(paise || 0) / 100;
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
}

export default function SubscriptionManageScreen() {
  const router = useRouter();
  const { entitlement, isPremium, loading, refresh } = useEntitlement();
  const [history, setHistory] = useState<PaymentHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [_, payments] = await Promise.all([
        refresh(),
        api.getPaymentHistory().catch(() => ({ items: [] as PaymentHistoryItem[] })),
      ]);
      setHistory(payments.items || []);
    } finally {
      setLoadingHistory(false);
    }
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onCancel = () => {
    Alert.alert(
      'Cancel subscription?',
      'You will keep Premium until the end of the current billing period.',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Cancel at period end',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.cancelSubscription();
              await refresh();
              Alert.alert('Scheduled', 'Your subscription will end after the current period.');
            } catch (e: any) {
              Alert.alert('Unable to cancel', e?.message || 'Please try again.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="subscription-manage-screen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="subscription-manage-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={styles.iconBtnGhost} />
      </View>

      <AppScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && !entitlement.status ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.summaryCard}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, isPremium ? styles.badgeOn : styles.badgeOff]}>
                <Text style={styles.badgeText}>{isPremium ? 'Premium' : 'Free'}</Text>
              </View>
              {entitlement.status ? (
                <Text style={styles.statusText}>{entitlement.status}</Text>
              ) : null}
            </View>
            <Text style={styles.planTitle}>
              {entitlement.plan_id === 'premium_yearly'
                ? 'Premium Yearly'
                : entitlement.plan_id === 'premium_monthly'
                  ? 'Premium Monthly'
                  : entitlement.plan_id || 'No active plan'}
            </Text>
            {entitlement.amount ? (
              <Text style={styles.amount}>{formatInr(entitlement.amount)}</Text>
            ) : null}
            <Text style={styles.meta}>
              Renews / ends: {formatDate(entitlement.current_period_end)}
            </Text>
            {entitlement.cancel_at_cycle_end ? (
              <Text style={styles.warn}>Cancellation scheduled at period end</Text>
            ) : null}
          </View>
        )}

        {!isPremium ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/subscribe' as Href)}
          >
            <Text style={styles.primaryBtnText}>Upgrade to Premium</Text>
          </TouchableOpacity>
        ) : !entitlement.cancel_at_cycle_end ? (
          <TouchableOpacity
            testID="subscription-cancel"
            style={styles.cancelBtn}
            disabled={cancelling}
            onPress={onCancel}
          >
            {cancelling ? (
              <ActivityIndicator color={theme.colors.error} />
            ) : (
              <Text style={styles.cancelBtnText}>Cancel Subscription</Text>
            )}
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionTitle}>Payment history</Text>
        {loadingHistory ? (
          <ActivityIndicator color={ACCENT} />
        ) : history.length === 0 ? (
          <Text style={styles.empty}>No payments yet.</Text>
        ) : (
          <View style={styles.historyList}>
            {history.map((item) => (
              <TouchableOpacity
                key={item.razorpay_payment_id || item.id}
                style={styles.historyRow}
                onPress={() => {
                  void downloadReceipt({
                    paymentId: item.razorpay_payment_id,
                    amountLabel: formatInr(item.amount),
                    planName: item.plan_id || undefined,
                    paidTo: 'ScanG',
                    dateTime: formatDate(item.created_at),
                    status: item.status || 'Paid',
                  });
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyId} numberOfLines={1}>
                    {item.razorpay_payment_id}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {formatDate(item.created_at)} · {item.status || '—'}
                    {item.method ? ` · ${item.method}` : ''}
                  </Text>
                  <Text style={styles.historyHint}>Tap to download receipt</Text>
                </View>
                <Text style={styles.historyAmount}>{formatInr(item.amount)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </AppScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  iconBtnGhost: { width: 40, height: 40 },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
  summaryCard: {
    marginTop: 12,
    padding: 18,
    borderRadius: 18,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeOn: { backgroundColor: 'rgba(26, 130, 255, 0.2)' },
  badgeOff: { backgroundColor: theme.colors.bg3 },
  badgeText: { color: ACCENT, fontSize: 12, fontWeight: '700' },
  statusText: { color: theme.colors.textSubtle, fontSize: 12, textTransform: 'capitalize' },
  planTitle: {
    marginTop: 12,
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  amount: { marginTop: 6, color: ACCENT, fontSize: 22, fontWeight: '800' },
  meta: { marginTop: 8, color: theme.colors.textMuted, fontSize: 13 },
  warn: { marginTop: 8, color: theme.colors.warning, fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  cancelBtn: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { color: theme.colors.error, fontSize: 15, fontWeight: '700' },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 12,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  empty: { color: theme.colors.textSubtle, fontSize: 14 },
  historyList: { gap: 10 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  historyId: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  historyMeta: { marginTop: 4, color: theme.colors.textSubtle, fontSize: 12 },
  historyHint: { marginTop: 4, color: ACCENT, fontSize: 11, fontWeight: '600' },
  historyAmount: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
});
