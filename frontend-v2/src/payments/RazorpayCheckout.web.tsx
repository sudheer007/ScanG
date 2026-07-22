/**
 * Web: CheckoutShell + Razorpay Standard Checkout via sandboxed iframe.
 * Same UX as native WebView path — no bare document-level checkout.js modal.
 * Card/UPI secrets never touch ScanG — Razorpay handles PCI scope.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '@/src/theme';
import { buildCheckoutHtml } from './buildCheckoutHtml';
import { CheckoutShell } from './CheckoutShell';
import {
  CHECKOUT_MESSAGE_TYPES,
  type PaymentMethodId,
  type RazorpayCheckoutCallbacks,
  type RazorpayCheckoutOptions,
  type RazorpayFailurePayload,
  type RazorpaySuccessPayload,
} from './types';

export type {
  RazorpayCheckoutOptions,
  RazorpaySuccessPayload,
  RazorpayFailurePayload,
} from './types';

const IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

function parseHostMessage(data: unknown): { type: string; payload?: unknown } | null {
  try {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;
    if (!msg || typeof msg !== 'object') return null;
    const type = (msg as { type?: string }).type;
    if (!type || !CHECKOUT_MESSAGE_TYPES.has(type)) return null;
    return msg as { type: string; payload?: unknown };
  } catch {
    return null;
  }
}

export function useRazorpay() {
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<RazorpayCheckoutOptions | null>(null);
  const [hostActive, setHostActive] = useState(false);
  const [hostMethod, setHostMethod] = useState<PaymentMethodId | undefined>();
  const [loading, setLoading] = useState(true);
  const callbacksRef = useRef<RazorpayCheckoutCallbacks | null>(null);
  const listeningRef = useRef(false);

  const closeCheckout = useCallback(() => {
    setVisible(false);
    setOptions(null);
    setHostActive(false);
    setHostMethod(undefined);
    setLoading(true);
  }, []);

  const openCheckout = useCallback(
    (opts: RazorpayCheckoutOptions, cbs: RazorpayCheckoutCallbacks) => {
      callbacksRef.current = cbs;
      setOptions(opts);
      setHostActive(false);
      setHostMethod(undefined);
      setLoading(true);
      setVisible(true);
    },
    [],
  );

  const onStartHost = useCallback((method: PaymentMethodId) => {
    setHostMethod(method);
    setHostActive(true);
    setLoading(true);
  }, []);

  const handleHostMessage = useCallback(
    (raw: unknown) => {
      const msg = parseHostMessage(raw);
      if (!msg) return;
      const cbs = callbacksRef.current;
      if (msg.type === 'success') {
        closeCheckout();
        cbs?.onSuccess(msg.payload as RazorpaySuccessPayload);
      } else if (msg.type === 'failure') {
        closeCheckout();
        cbs?.onFailure((msg.payload || {}) as RazorpayFailurePayload);
      } else if (msg.type === 'close') {
        closeCheckout();
        cbs?.onClose?.();
      }
    },
    [closeCheckout],
  );

  useEffect(() => {
    if (!hostActive || typeof window === 'undefined') return;

    const onMessage = (event: MessageEvent) => {
      // srcDoc iframe is same-origin as parent; also accept razorpay API origin.
      const okOrigin =
        event.origin === window.location.origin ||
        event.origin === 'null' ||
        event.origin === 'https://api.razorpay.com' ||
        event.origin === 'https://checkout.razorpay.com';
      if (!okOrigin) return;
      handleHostMessage(event.data);
    };

    listeningRef.current = true;
    window.addEventListener('message', onMessage);
    return () => {
      listeningRef.current = false;
      window.removeEventListener('message', onMessage);
    };
  }, [hostActive, handleHostMessage]);

  const hostOptions = useMemo(() => {
    if (!options || !hostActive) return null;
    return { ...options, method: hostMethod };
  }, [options, hostActive, hostMethod]);

  const html = useMemo(
    () => (hostOptions ? buildCheckoutHtml(hostOptions, 'web') : ''),
    [hostOptions],
  );

  const hostNode =
    hostActive && hostOptions ? (
      <View style={styles.iframeWrap}>
        <iframe
          title="Razorpay Secure Checkout"
          srcDoc={html}
          sandbox={IFRAME_SANDBOX}
          style={iframeStyle}
          onLoad={() => setLoading(false)}
        />
      </View>
    ) : (
      <View style={styles.iframeWrap} />
    );

  const shellKey =
    options?.subscription_id || options?.order_id || String(options?.amount ?? '');

  const RazorpayUI =
    visible && options ? (
      <CheckoutShell
        key={shellKey}
        visible
        options={options}
        hostNode={hostNode}
        hostLoading={hostActive && loading}
        onClose={() => {
          closeCheckout();
          callbacksRef.current?.onClose?.();
        }}
        onStartHost={onStartHost}
      />
    ) : null;

  return { openCheckout, closeCheckout, RazorpayUI, isVisible: visible };
}

const iframeStyle = {
  border: 'none' as const,
  width: '100%',
  height: '100%',
  background: theme.colors.bg,
  flex: 1,
};

const styles = StyleSheet.create({
  iframeWrap: { flex: 1, backgroundColor: theme.colors.bg, minHeight: 480 },
});
