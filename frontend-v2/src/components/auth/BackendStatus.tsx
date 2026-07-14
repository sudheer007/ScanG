import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

import { api, getBackendBaseUrl } from '@/src/api';
import { authTheme } from '@/src/auth/authTheme';
import { isExpoGo } from '@/src/utils/expoRuntime';

type Status = 'checking' | 'ok' | 'error';

export default function BackendStatus() {
  const [status, setStatus] = useState<Status>('checking');
  const base = getBackendBaseUrl();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.health();
        if (!cancelled) setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!base) {
    return (
      <Text style={[styles.text, styles.error]}>
        Set EXPO_PUBLIC_BACKEND_URL in .env (use your PC LAN IP for Expo Go on a phone).
      </Text>
    );
  }

  if (status === 'checking') {
    return <Text style={styles.text}>Checking API at {base}…</Text>;
  }

  if (status === 'ok') {
    return (
      <Text style={[styles.text, styles.ok]}>
        API connected ({base}){isExpoGo() ? ' · Expo Go' : ''}
      </Text>
    );
  }

  return (
    <Text style={[styles.text, styles.error]}>
        Cannot reach API at {base}. Start backend on 0.0.0.0:8000, set EXPO_PUBLIC_BACKEND_URL to your PC Wi‑Fi IP (yarn lan-ip), and allow port 8000 in Windows Firewall if needed.
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: authTheme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  ok: {
    color: '#15803d',
  },
  error: {
    color: authTheme.colors.error,
  },
});
