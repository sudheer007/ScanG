import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useRazorpay } from '@/src/payments/RazorpayCheckout';

import { theme } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import { useAuth } from '@/src/hooks/useAuth';
import { useEntitlement } from '@/src/hooks/useEntitlement';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';
import {
  api,
  ApiError,
  type PaymentPlan,
} from '@/src/api';

const ACCENT = authTheme.colors.primary;
const ACCENT_DIM = 'rgba(26, 130, 255, 0.14)';
const ACCENT_BORDER = 'rgba(26, 130, 255, 0.28)';

function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function SubscribeScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { isPremium, refresh } = useEntitlement();
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();

  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [selectedId, setSelectedId] = useState<string>('premium_yearly');
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [paying, setPaying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadPlans = useCallback(async () => {
    const res = await api.getPlans();
    setPlans(res.items || []);
    if (res.items?.some((p) => p.id === 'premium_yearly')) {
      setSelectedId('premium_yearly');
    } else if (res.items?.[0]) {
      setSelectedId(res.items[0].id);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadPlans();
      } catch (e: any) {
        if (active) {
          Alert.alert('Unable to load plans', e?.message || 'Please try again.');
        }
      } finally {
        if (active) setLoadingPlans(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadPlans]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadPlans(), refresh()]);
    } catch (e: any) {
      Alert.alert('Unable to refresh', e?.message || 'Please try again.');
    } finally {
      setRefreshing(false);
    }
  }, [loadPlans, refresh]);

  const selected = plans.find((p) => p.id === selectedId) || plans[0];

  const onPay = useCallback(async () => {
    if (!selected || paying) return;
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to subscribe.');
      return;
    }
    if (isPremium) {
      router.push('/subscription-manage' as Href);
      return;
    }

    setPaying(true);
    try {
      const created = await api.createSubscription(selected.id);
      openCheckout(
        {
          key: created.key_id,
          amount: created.plan.amount,
          currency: created.plan.currency || 'INR',
          subscription_id: created.subscription_id,
          name: created.name || 'ScanG',
          description: created.description || selected.name,
          prefill: {
            email: created.prefill?.email || user.email || profile?.email || '',
            name: profile?.display_name || user.displayName || '',
          },
          theme: { color: created.theme?.color || ACCENT },
          notes: { plan_id: selected.id },
        } as any,
        {
          onSuccess: async (data: any) => {
            closeCheckout();
            try {
              const verified = await api.verifyPayment({
                razorpay_payment_id: data.razorpay_payment_id,
                razorpay_subscription_id:
                  data.razorpay_subscription_id || created.subscription_id,
                razorpay_signature: data.razorpay_signature,
              });
              await refresh();
              router.replace({
                pathname: '/payment-result',
                params: {
                  status: 'success',
                  paymentId: verified.payment_id || data.razorpay_payment_id,
                  amount: String(verified.amount ?? created.plan.amount),
                  currency: verified.currency || 'INR',
                  planName: selected.name,
                },
              } as any);
            } catch (err: any) {
              router.replace({
                pathname: '/payment-result',
                params: {
                  status: 'failed',
                  reason: err?.message || 'Verification failed',
                  paymentId: data.razorpay_payment_id || '',
                  amount: String(created.plan.amount),
                },
              } as any);
            } finally {
              setPaying(false);
            }
          },
          onFailure: (error: any) => {
            closeCheckout();
            setPaying(false);
            router.replace({
              pathname: '/payment-result',
              params: {
                status: 'failed',
                reason:
                  error?.description ||
                  error?.reason ||
                  error?.message ||
                  'Payment could not be completed',
                amount: String(created.plan.amount),
              },
            } as any);
          },
          onClose: () => {
            setPaying(false);
          },
        },
      );
    } catch (e: any) {
      setPaying(false);
      const msg =
        e instanceof ApiError
          ? e.message
          : e?.message || 'Unable to start payment';
      Alert.alert('Payment unavailable', msg);
    }
  }, [
    selected,
    paying,
    user,
    isPremium,
    router,
    openCheckout,
    closeCheckout,
    profile,
    refresh,
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="subscribe-screen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="subscribe-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Go Premium</Text>
        <View style={styles.iconBtnGhost} />
      </View>

      <AppScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.lead}>Unlock ScanG Premium</Text>
        <Text style={styles.sub}>
          Secure recurring billing via Razorpay. Cancel anytime from Manage Subscription.
        </Text>

        {isPremium ? (
          <Pressable
            style={styles.activeBanner}
            onPress={() => router.push('/subscription-manage' as Href)}
          >
            <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
            <Text style={styles.activeBannerText}>You already have Premium — manage it</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
          </Pressable>
        ) : null}

        {loadingPlans ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.planList}>
            {plans.map((plan) => {
              const selectedPlan = plan.id === selectedId;
              return (
                <Pressable
                  key={plan.id}
                  testID={`plan-${plan.id}`}
                  onPress={() => setSelectedId(plan.id)}
                  style={[styles.planCard, selectedPlan && styles.planCardSelected]}
                >
                  <View style={styles.planTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planName}>{plan.name}</Text>
                      <Text style={styles.planDesc}>{plan.description}</Text>
                    </View>
                    <View style={[styles.radio, selectedPlan && styles.radioOn]}>
                      {selectedPlan ? <View style={styles.radioDot} /> : null}
                    </View>
                  </View>
                  <Text style={styles.planPrice}>
                    {formatInr(plan.amount)}
                    <Text style={styles.planInterval}>
                      {' '}
                      / {plan.interval === 'yearly' ? 'year' : 'month'}
                    </Text>
                  </Text>
                  <View style={styles.features}>
                    {(plan.features || []).map((f) => (
                      <View key={f} style={styles.featureRow}>
                        <Ionicons name="checkmark" size={16} color={ACCENT} />
                        <Text style={styles.featureText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.secureBox}>
          <Ionicons name="shield-checkmark" size={18} color={theme.colors.success} />
          <Text style={styles.secureText}>
            Your payment is encrypted and handled by a secure PCI-DSS compliant server.
          </Text>
        </View>

        <Text style={styles.securedBy}>
          Secured by <Text style={{ color: ACCENT, fontWeight: '700' }}>Razorpay</Text>
        </Text>
      </AppScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          testID="subscribe-pay"
          style={[styles.payBtn, (paying || !selected || isPremium) && styles.payBtnDisabled]}
          disabled={paying || !selected || isPremium}
          onPress={onPay}
        >
          {paying ? (
            <ActivityIndicator color="#0A0A0C" />
          ) : (
            <Text style={styles.payBtnText}>
              {selected
                ? `Pay ${formatInr(selected.amount)}`
                : 'Select a plan'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {RazorpayUI}
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
  headerTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
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
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  lead: {
    marginTop: 12,
    color: ACCENT,
    fontSize: 28,
    fontWeight: '800',
  },
  sub: {
    marginTop: 8,
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  activeBanner: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.accentBg,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  activeBannerText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  planList: { marginTop: 20, gap: 12 },
  planCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  planCardSelected: {
    borderColor: ACCENT,
    backgroundColor: ACCENT_DIM,
  },
  planTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  planName: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  planDesc: { marginTop: 4, color: theme.colors.textMuted, fontSize: 13 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: ACCENT },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  planPrice: {
    marginTop: 14,
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '800',
  },
  planInterval: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textMuted,
  },
  features: { marginTop: 14, gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { color: theme.colors.textMuted, fontSize: 13, flex: 1 },
  secureBox: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  secureText: {
    flex: 1,
    color: '#86EFAC',
    fontSize: 13,
    lineHeight: 18,
  },
  securedBy: {
    marginTop: 16,
    textAlign: 'center',
    color: theme.colors.textSubtle,
    fontSize: 13,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  payBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
