/**
 * Shared checkout chrome for app + web.
 *
 * Visual card/UPI forms are UX-only — Pay never sends PAN/CVV/VPA to ScanG.
 * Real charge always happens inside the Razorpay host (WebView / iframe).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '@/src/theme';
import { formatCheckoutAmount, isValidVpa } from './buildCheckoutHtml';
import type { PaymentMethodId, RazorpayCheckoutOptions } from './types';

const ACCENT = '#1A82FF';
const ACCENT_LIGHT = '#7CD3FF';
const ACCENT_DIM = 'rgba(26, 130, 255, 0.14)';
const ACCENT_BORDER = 'rgba(26, 130, 255, 0.28)';
const PCI_BG = 'rgba(16, 185, 129, 0.08)';
const PCI_BORDER = 'rgba(16, 185, 129, 0.35)';
const UPI_PAY = '#527163';

export type CheckoutStep = 'methods' | 'card' | 'upi' | 'host';

type MethodRow = {
  id: PaymentMethodId;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const METHODS: MethodRow[] = [
  {
    id: 'card',
    title: 'Cards',
    subtitle: 'Visa, Mastercard, RuPay',
    icon: 'card-outline',
  },
  {
    id: 'upi',
    title: 'UPI',
    subtitle: 'Google Pay, PhonePe, BHIM',
    icon: 'wallet-outline',
  },
  {
    id: 'netbanking',
    title: 'Netbanking',
    subtitle: 'HDFC, SBI, ICICI',
    icon: 'business-outline',
  },
  {
    id: 'wallet',
    title: 'Wallets',
    subtitle: 'Paytm, Amazon Pay, Mobikwik',
    icon: 'phone-portrait-outline',
  },
];

export type CheckoutShellProps = {
  visible: boolean;
  options: RazorpayCheckoutOptions;
  hostNode: React.ReactNode;
  hostLoading?: boolean;
  onClose: () => void;
  /** Called when user confirms Pay / method that goes straight to Razorpay host. */
  onStartHost: (method: PaymentMethodId) => void;
};

export function CheckoutShell({
  visible,
  options,
  hostNode,
  hostLoading = false,
  onClose,
  onStartHost,
}: CheckoutShellProps) {
  const [step, setStep] = useState<CheckoutStep>('methods');
  const [method, setMethod] = useState<PaymentMethodId | null>(null);

  // Visual-only card fields — never sent to ScanG or Razorpay options.
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [saveCard, setSaveCard] = useState(false);

  // Visual-only UPI — format-checked locally; never charged by us.
  const [vpa, setVpa] = useState('');
  const [vpaHint, setVpaHint] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  const amountLabel = useMemo(
    () => formatCheckoutAmount(options.amount, options.currency || 'INR'),
    [options.amount, options.currency],
  );
  const merchant = options.name || 'ScanG';

  const resetLocal = useCallback(() => {
    setStep('methods');
    setMethod(null);
    setCardNumber('');
    setCardName('');
    setExpiry('');
    setCvv('');
    setSaveCard(false);
    setVpa('');
    setVpaHint(null);
    setQrOpen(false);
  }, []);

  const handleClose = useCallback(() => {
    resetLocal();
    onClose();
  }, [onClose, resetLocal]);

  const selectMethod = useCallback(
    (id: PaymentMethodId) => {
      setMethod(id);
      if (id === 'card') {
        setStep('card');
      } else if (id === 'upi') {
        setStep('upi');
      } else {
        // Netbanking / wallets → straight to Razorpay hosted checkout
        setStep('host');
        onStartHost(id);
      }
    },
    [onStartHost],
  );

  const goHost = useCallback(
    (id: PaymentMethodId) => {
      // Discard visual form fields before opening Razorpay — never leave card data in memory during host.
      setCardNumber('');
      setCardName('');
      setExpiry('');
      setCvv('');
      setSaveCard(false);
      setVpa('');
      setVpaHint(null);
      setMethod(id);
      setStep('host');
      onStartHost(id);
    },
    [onStartHost],
  );

  const onVerifyVpa = useCallback(() => {
    if (!vpa.trim()) {
      setVpaHint('Enter your UPI ID');
      return;
    }
    if (!isValidVpa(vpa)) {
      setVpaHint('Use format username@bank');
      return;
    }
    setVpaHint('Looks good — continue to secure checkout');
  }, [vpa]);

  if (!visible) return null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {step === 'host' ? (
          <HostChrome
            amountLabel={amountLabel}
            merchant={merchant}
            loading={hostLoading}
            onClose={handleClose}
            onBack={() => {
              if (method === 'card') setStep('card');
              else if (method === 'upi') setStep('upi');
              else setStep('methods');
            }}
          >
            {hostNode}
          </HostChrome>
        ) : (
          <>
            <CheckoutHeader
              amountLabel={amountLabel}
              merchant={merchant}
              onBack={
                step === 'methods'
                  ? handleClose
                  : () => setStep('methods')
              }
            />
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {step === 'methods' ? (
                <MethodsStep amountLabel={amountLabel} onSelect={selectMethod} />
              ) : null}
              {step === 'card' ? (
                <CardStep
                  amountLabel={amountLabel}
                  cardNumber={cardNumber}
                  cardName={cardName}
                  expiry={expiry}
                  cvv={cvv}
                  saveCard={saveCard}
                  onChangeNumber={setCardNumber}
                  onChangeName={setCardName}
                  onChangeExpiry={setExpiry}
                  onChangeCvv={setCvv}
                  onToggleSave={() => setSaveCard((v) => !v)}
                  onPay={() => goHost('card')}
                />
              ) : null}
              {step === 'upi' ? (
                <UpiStep
                  amountLabel={amountLabel}
                  vpa={vpa}
                  vpaHint={vpaHint}
                  qrOpen={qrOpen}
                  onChangeVpa={(t) => {
                    setVpa(t);
                    setVpaHint(null);
                  }}
                  onVerify={onVerifyVpa}
                  onToggleQr={() => setQrOpen((v) => !v)}
                  onPay={() => goHost('upi')}
                />
              ) : null}
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function CheckoutHeader({
  amountLabel,
  merchant,
  onBack,
}: {
  amountLabel: string;
  merchant: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.headerBtn} testID="checkout-back">
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {amountLabel} • {merchant}
      </Text>
      <View style={styles.headerBtn}>
        <Ionicons name="lock-closed-outline" size={18} color={ACCENT_LIGHT} />
      </View>
    </View>
  );
}

function HostChrome({
  amountLabel,
  merchant,
  loading,
  onClose,
  onBack,
  children,
}: {
  amountLabel: string;
  merchant: string;
  loading: boolean;
  onClose: () => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.hostWrap}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {amountLabel} • {merchant}
        </Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.headerBtn}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <View style={styles.hostBody}>
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.loaderText}>Opening secure Razorpay checkout…</Text>
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

function MethodsStep({
  amountLabel,
  onSelect,
}: {
  amountLabel: string;
  onSelect: (id: PaymentMethodId) => void;
}) {
  return (
    <View>
      <Text style={styles.heroTitle}>Select Payment Method</Text>
      <Text style={styles.heroSub}>
        Choose a preferred way to pay {amountLabel} securely.
      </Text>

      <View style={styles.methodList}>
        {METHODS.map((m) => (
          <Pressable
            key={m.id}
            testID={`checkout-method-${m.id}`}
            onPress={() => onSelect(m.id)}
            style={({ pressed }) => [styles.methodRow, pressed && styles.pressed]}
          >
            <View style={styles.methodIcon}>
              <Ionicons name={m.icon} size={22} color={ACCENT_LIGHT} />
            </View>
            <View style={styles.methodText}>
              <Text style={styles.methodTitle}>{m.title}</Text>
              <Text style={styles.methodSub}>{m.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
          </Pressable>
        ))}
      </View>

      <View style={styles.pciBox}>
        <Ionicons name="shield-checkmark" size={20} color={theme.colors.success} />
        <Text style={styles.pciText}>
          Your payment is encrypted and handled by a secure PCI-DSS compliant server.
        </Text>
      </View>
    </View>
  );
}

function CardStep({
  amountLabel,
  cardNumber,
  cardName,
  expiry,
  cvv,
  saveCard,
  onChangeNumber,
  onChangeName,
  onChangeExpiry,
  onChangeCvv,
  onToggleSave,
  onPay,
}: {
  amountLabel: string;
  cardNumber: string;
  cardName: string;
  expiry: string;
  cvv: string;
  saveCard: boolean;
  onChangeNumber: (t: string) => void;
  onChangeName: (t: string) => void;
  onChangeExpiry: (t: string) => void;
  onChangeCvv: (t: string) => void;
  onToggleSave: () => void;
  onPay: () => void;
}) {
  // Display helpers only — values stay in React state and are discarded on Pay.
  const displayNumber = maskCardDisplay(cardNumber);
  const displayName = cardName.trim() || 'YOUR NAME';
  const displayExpiry = expiry.trim() || 'MM/YY';

  return (
    <View>
      <Text style={styles.heroTitle}>Secure Payment</Text>
      <Text style={styles.heroSub}>
        Complete your transaction using a credit or debit card. Your data is encrypted and
        protected.
      </Text>

      <View style={styles.cardPreview}>
        <View style={styles.cardPreviewTop}>
          <View style={styles.chip} />
          <Text style={styles.cardBrand}>VISA / MASTERCARD</Text>
        </View>
        <Text style={styles.cardDots}>{displayNumber}</Text>
        <View style={styles.cardPreviewBottom}>
          <View>
            <Text style={styles.cardLabel}>CARD HOLDER</Text>
            <Text style={styles.cardValue}>{displayName.toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.cardLabel}>EXPIRES</Text>
            <Text style={styles.cardValue}>{displayExpiry}</Text>
          </View>
        </View>
      </View>

      <FieldLabel>Card Number</FieldLabel>
      <View style={styles.inputRow}>
        <Ionicons name="card-outline" size={18} color={theme.colors.textSubtle} />
        <TextInput
          style={styles.input}
          placeholder="0000 0000 0000 0000"
          placeholderTextColor={theme.colors.textSubtle}
          keyboardType="number-pad"
          maxLength={19}
          value={cardNumber}
          onChangeText={(t) => onChangeNumber(formatCardNumber(t))}
          autoComplete="off"
          textContentType="none"
        />
      </View>

      <FieldLabel>Cardholder Name</FieldLabel>
      <View style={styles.inputRow}>
        <Ionicons name="person-outline" size={18} color={theme.colors.textSubtle} />
        <TextInput
          style={styles.input}
          placeholder="NAME AS ON CARD"
          placeholderTextColor={theme.colors.textSubtle}
          autoCapitalize="characters"
          value={cardName}
          onChangeText={onChangeName}
          autoComplete="off"
          textContentType="none"
        />
      </View>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <FieldLabel>Expiry (MM/YY)</FieldLabel>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={18} color={theme.colors.textSubtle} />
            <TextInput
              style={styles.input}
              placeholder="MM/YY"
              placeholderTextColor={theme.colors.textSubtle}
              keyboardType="number-pad"
              maxLength={5}
              value={expiry}
              onChangeText={(t) => onChangeExpiry(formatExpiry(t))}
              autoComplete="off"
              textContentType="none"
            />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <FieldLabel>CVV</FieldLabel>
          <View style={styles.inputRow}>
            <Ionicons name="shield-outline" size={18} color={theme.colors.textSubtle} />
            <TextInput
              style={styles.input}
              placeholder="•••"
              placeholderTextColor={theme.colors.textSubtle}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              value={cvv}
              onChangeText={(t) => onChangeCvv(t.replace(/\D/g, ''))}
              autoComplete="off"
              textContentType="none"
            />
          </View>
        </View>
      </View>

      <Pressable onPress={onToggleSave} style={styles.checkRow}>
        <View style={[styles.checkbox, saveCard && styles.checkboxOn]}>
          {saveCard ? <Ionicons name="checkmark" size={14} color="#0A0A0C" /> : null}
        </View>
        <Text style={styles.checkText}>Save card for future payments</Text>
      </Pressable>

      <View style={styles.trustRow}>
        <TrustBadge icon="shield-checkmark-outline" label="PCI-DSS Compliant" />
        <TrustBadge icon="lock-closed-outline" label="Norton Secured" />
      </View>

      <Text style={styles.secureNote}>
        Card details stay on this device for preview only. Payment is completed on Razorpay’s
        secure checkout — we never store or transmit card numbers.
      </Text>

      <Pressable
        testID="checkout-pay-card"
        onPress={onPay}
        style={({ pressed }) => [styles.payBtn, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.payBtnText}>Pay {amountLabel}</Text>
        <Ionicons name="arrow-forward" size={18} color="#0A0A0C" />
      </Pressable>
    </View>
  );
}

function UpiStep({
  amountLabel,
  vpa,
  vpaHint,
  qrOpen,
  onChangeVpa,
  onVerify,
  onToggleQr,
  onPay,
}: {
  amountLabel: string;
  vpa: string;
  vpaHint: string | null;
  qrOpen: boolean;
  onChangeVpa: (t: string) => void;
  onVerify: () => void;
  onToggleQr: () => void;
  onPay: () => void;
}) {
  return (
    <View style={styles.upiCard}>
      <Text style={styles.upiTitle}>UPI Payment</Text>

      <FieldLabel>UPI ID / VPA</FieldLabel>
      <View style={styles.upiRow}>
        <View style={[styles.inputRow, { flex: 1 }]}>
          <Text style={styles.at}>@</Text>
          <TextInput
            style={styles.input}
            placeholder="username@bank"
            placeholderTextColor={theme.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            value={vpa}
            onChangeText={onChangeVpa}
            autoComplete="off"
            textContentType="none"
          />
        </View>
        <Pressable onPress={onVerify} style={styles.verifyBtn} testID="checkout-verify-vpa">
          <Text style={styles.verifyText}>Verify</Text>
        </Pressable>
      </View>
      <View style={styles.hintRow}>
        <Ionicons name="information-circle-outline" size={14} color={theme.colors.textSubtle} />
        <Text style={styles.hintText}>
          {vpaHint || 'Enter your Virtual Payment Address to pay'}
        </Text>
      </View>

      <View style={styles.divider} />

      <Pressable onPress={onToggleQr} style={styles.qrRow}>
        <Ionicons name="qr-code-outline" size={22} color={ACCENT_LIGHT} />
        <Text style={styles.qrText}>Pay via QR</Text>
        <Ionicons
          name={qrOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.colors.textSubtle}
        />
      </Pressable>
      {qrOpen ? (
        <Text style={styles.qrHint}>
          QR payment opens inside Razorpay’s secure checkout on the next step.
        </Text>
      ) : null}

      <Pressable
        testID="checkout-pay-upi"
        onPress={onPay}
        style={({ pressed }) => [styles.upiPayBtn, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.upiPayText}>Pay {amountLabel}</Text>
        <Ionicons name="shield-checkmark" size={16} color="#0A0A0C" />
      </Pressable>

      <View style={styles.footerTrust}>
        <FooterTrust icon="shield-checkmark-outline" label="SECURE CHECKOUT" />
        <FooterTrust icon="lock-closed-outline" label="256-BIT SSL" />
        <FooterTrust icon="heart-outline" label="BUYER PROTECTION" />
      </View>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function TrustBadge({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.trustBadge}>
      <Ionicons name={icon} size={14} color={theme.colors.success} />
      <Text style={styles.trustLabel}>{label}</Text>
    </View>
  );
}

function FooterTrust({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.footerItem}>
      <Ionicons name={icon} size={14} color={theme.colors.textSubtle} />
      <Text style={styles.footerLabel}>{label}</Text>
    </View>
  );
}

function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function maskCardDisplay(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  if (!digits) return '••••  ••••  ••••  ••••';
  const padded = (digits + '••••••••••••••••').slice(0, 16);
  return padded.replace(/(.{4})/g, '$1 ').trim().replace(/\d/g, '•');
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerBtn: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  closeText: { color: ACCENT, fontSize: 15, fontWeight: '600' },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  heroTitle: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroSub: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  methodList: { gap: 10 },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pressed: { opacity: 0.85 },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodText: { flex: 1, gap: 2 },
  methodTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  methodSub: { color: theme.colors.textMuted, fontSize: 13 },
  pciBox: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: PCI_BG,
    borderWidth: 1,
    borderColor: PCI_BORDER,
  },
  pciText: {
    flex: 1,
    color: '#6EE7B7',
    fontSize: 13,
    lineHeight: 18,
  },
  cardPreview: {
    backgroundColor: theme.colors.bg2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 20,
    marginBottom: 20,
  },
  cardPreviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  chip: {
    width: 36,
    height: 28,
    borderRadius: 6,
    backgroundColor: theme.colors.bg3,
  },
  cardBrand: { color: theme.colors.textSubtle, fontSize: 11, fontWeight: '600' },
  cardDots: {
    color: theme.colors.text,
    fontSize: 20,
    letterSpacing: 2,
    fontWeight: '600',
    marginBottom: 24,
  },
  cardPreviewBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  cardLabel: { color: theme.colors.textSubtle, fontSize: 10, marginBottom: 4 },
  cardValue: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  fieldLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  row2: { flexDirection: 'row', gap: 12 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: ACCENT_LIGHT, borderColor: ACCENT_LIGHT },
  checkText: { color: theme.colors.textMuted, fontSize: 14 },
  trustRow: { flexDirection: 'row', gap: 16, marginTop: 18 },
  trustBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustLabel: { color: theme.colors.textSubtle, fontSize: 12 },
  secureNote: {
    marginTop: 14,
    color: theme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 17,
  },
  payBtn: {
    marginTop: 20,
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: ACCENT_LIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  payBtnText: { color: '#0A0A0C', fontSize: 16, fontWeight: '800' },
  upiCard: {
    backgroundColor: theme.colors.bg2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
  },
  upiTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  upiRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  at: { color: ACCENT_LIGHT, fontSize: 16, fontWeight: '700' },
  verifyBtn: {
    backgroundColor: 'rgba(26, 130, 255, 0.25)',
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyText: { color: ACCENT_LIGHT, fontWeight: '700', fontSize: 14 },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  hintText: { color: theme.colors.textSubtle, fontSize: 12, flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginVertical: 16,
  },
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  qrText: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  qrHint: {
    color: theme.colors.textSubtle,
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 34,
  },
  upiPayBtn: {
    marginTop: 16,
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: UPI_PAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  upiPayText: { color: '#0A0A0C', fontSize: 16, fontWeight: '800' },
  footerTrust: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 8,
  },
  footerItem: { alignItems: 'center', flex: 1, gap: 4 },
  footerLabel: {
    color: theme.colors.textSubtle,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  hostWrap: { flex: 1 },
  hostBody: { flex: 1, backgroundColor: theme.colors.bg },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    backgroundColor: 'rgba(10,10,12,0.72)',
    gap: 12,
  },
  loaderText: { color: theme.colors.textMuted, fontSize: 13 },
});
