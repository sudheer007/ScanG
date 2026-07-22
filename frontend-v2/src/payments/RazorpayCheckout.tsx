/**
 * Native (iOS/Android): CheckoutShell + Razorpay Standard Checkout via WebView.
 * Card/UPI details never touch our servers — Razorpay handles PCI scope.
 * Web uses RazorpayCheckout.web.tsx (Metro platform extension) with the same shell + iframe.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

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

export function useRazorpay() {
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<RazorpayCheckoutOptions | null>(null);
  const [hostActive, setHostActive] = useState(false);
  const [hostMethod, setHostMethod] = useState<PaymentMethodId | undefined>();
  const [loading, setLoading] = useState(true);
  const callbacksRef = useRef<RazorpayCheckoutCallbacks | null>(null);

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

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (!CHECKOUT_MESSAGE_TYPES.has(msg?.type)) return;
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
      } catch {
        /* ignore malformed */
      }
    },
    [closeCheckout],
  );

  const hostOptions = useMemo(() => {
    if (!options || !hostActive) return null;
    return { ...options, method: hostMethod };
  }, [options, hostActive, hostMethod]);

  const html = useMemo(
    () => (hostOptions ? buildCheckoutHtml(hostOptions, 'rn') : ''),
    [hostOptions],
  );

  const hostNode =
    hostActive && hostOptions ? (
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://api.razorpay.com' }}
        onMessage={onMessage}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        style={styles.webview}
        setSupportMultipleWindows={false}
      />
    ) : (
      <View style={styles.webview} />
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

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: theme.colors.bg },
});
