import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { theme } from '@/src/theme';
import { downloadReceipt } from '@/src/payments/receipt';

const ACCENT = '#7CD3FF';
const ACCENT_DARK = '#1A82FF';
const SUCCESS_MINT = '#86EFAC';
const SUPPORT_EMAIL = 'mahimukesh3176@gmail.com';

function formatInr(paiseOrRupees: string | number | undefined): string {
  const n = Number(paiseOrRupees || 0);
  const rupees = n / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNow(): string {
  try {
    return new Date().toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date().toISOString();
  }
}

export default function PaymentResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    status?: string;
    paymentId?: string;
    amount?: string;
    currency?: string;
    planName?: string;
    reason?: string;
  }>();
  const [downloading, setDownloading] = useState(false);

  const success = (params.status || 'success') === 'success';
  const amountLabel = useMemo(() => formatInr(params.amount), [params.amount]);
  const when = useMemo(() => formatNow(), []);

  const onContactSupport = async () => {
    const subject = encodeURIComponent('ScanG Payment Support');
    const body = encodeURIComponent(
      `Hi ScanG team,\n\nI need help with a payment.\nTransaction ID: ${params.paymentId || 'n/a'}\nReason: ${params.reason || 'n/a'}\n\n`,
    );
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(mailto);
    } catch {
      Alert.alert('Contact Support', `Email us at ${SUPPORT_EMAIL}`);
    }
  };

  const onDownloadReceipt = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadReceipt({
        paymentId: String(params.paymentId || ''),
        amountLabel,
        planName: params.planName ? String(params.planName) : undefined,
        paidTo: 'ScanG',
        dateTime: when,
        status: 'Paid',
      });
    } catch (e: any) {
      Alert.alert('Download failed', e?.message || 'Unable to download receipt.');
    } finally {
      setDownloading(false);
    }
  }, [amountLabel, downloading, params.paymentId, params.planName, when]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="payment-result-screen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="payment-result-back"
          onPress={() => router.replace('/(tabs)/more' as Href)}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {amountLabel} • ScanG
        </Text>
        <View style={styles.lockWrap}>
          <Ionicons name="lock-closed-outline" size={18} color={ACCENT} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusWrap}>
          {success ? (
            <View style={styles.statusOkCircle}>
              <Ionicons name="checkmark" size={36} color="#14532D" />
            </View>
          ) : (
            <View style={styles.statusFailTile}>
              <View style={styles.statusFailInner}>
                <Text style={styles.statusFailMark}>!</Text>
              </View>
            </View>
          )}
          <Text style={styles.title}>{success ? 'Payment Successful' : 'Payment Failed'}</Text>
          <Text style={styles.subtitle}>
            {success
              ? 'Your transaction has been processed securely.'
              : 'Your transaction could not be processed. This might be due to an issue with your bank or insufficient funds.'}
          </Text>
        </View>

        <View style={styles.card}>
          <Row label="Transaction ID" value={params.paymentId || '—'} />
          <Row
            label={success ? 'Amount Paid' : 'Amount'}
            value={amountLabel}
            valueAccent={success}
          />
          {success ? (
            <>
              <Row label="Paid to" value="ScanG" />
              <Row label="Date & Time" value={when} />
              {params.planName ? <Row label="Plan" value={params.planName} /> : null}
            </>
          ) : (
            <Row
              label="Reason"
              value={params.reason || 'Bank Server Busy'}
              valueError
            />
          )}
        </View>

        {success ? (
          <>
            <TouchableOpacity
              testID="payment-download-receipt"
              style={[styles.primaryBtn, downloading && { opacity: 0.7 }]}
              disabled={downloading}
              onPress={onDownloadReceipt}
            >
              {downloading ? (
                <ActivityIndicator color="#0A0A0C" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={20} color="#0A0A0C" />
                  <Text style={styles.primaryBtnText}>Download Receipt</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              testID="payment-return-home"
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tabs)' as Href)}
            >
              <Text style={styles.secondaryBtnText}>Return to Home</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              testID="payment-retry"
              style={styles.primaryBtn}
              onPress={() => router.replace('/subscribe' as Href)}
            >
              <Text style={styles.primaryBtnText}>Retry Payment</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="payment-try-different"
              style={styles.outlineBtn}
              onPress={() => router.replace('/subscribe' as Href)}
            >
              <Text style={styles.outlineBtnText}>Try Different Method</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="payment-contact-support"
              style={styles.supportLink}
              onPress={onContactSupport}
            >
              <Ionicons name="headset-outline" size={18} color={ACCENT_DARK} />
              <Text style={styles.supportText}>Contact Support</Text>
            </TouchableOpacity>
          </>
        )}

        {success ? (
          <View style={styles.pci}>
            <Ionicons name="shield-checkmark" size={14} color={theme.colors.success} />
            <Text style={styles.pciText}>PCI-DSS Secure Payment</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  valueAccent,
  valueError,
}: {
  label: string;
  value: string;
  valueAccent?: boolean;
  valueError?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        {valueError ? <View style={styles.errorDot} /> : null}
        <Text
          style={[
            styles.rowValue,
            valueAccent && { color: ACCENT },
            valueError && { color: '#F97316' },
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
    </View>
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
    flex: 1,
    textAlign: 'center',
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
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
  lockWrap: { width: 40, alignItems: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
  statusWrap: { alignItems: 'center', marginTop: 24, marginBottom: 20 },
  statusOkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: SUCCESS_MINT,
  },
  statusFailTile: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: theme.colors.error,
  },
  statusFailInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusFailMark: {
    color: theme.colors.textSubtle,
    fontSize: 22,
    fontWeight: '800',
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  card: {
    backgroundColor: theme.colors.bg2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  rowLabel: { color: theme.colors.textSubtle, fontSize: 13 },
  rowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  rowValue: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: 200,
  },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F97316',
  },
  primaryBtn: {
    marginTop: 20,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  outlineBtn: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  supportLink: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  supportText: { color: ACCENT_DARK, fontSize: 14, fontWeight: '600' },
  pci: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pciText: { color: theme.colors.textSubtle, fontSize: 12 },
});
