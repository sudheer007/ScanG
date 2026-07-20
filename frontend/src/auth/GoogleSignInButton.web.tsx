// Web-only: Google Identity Services (GIS) "Sign in with Google" button.
// No extra npm dependency — GIS is a small script Google serves and expects
// you to load directly, so we load it lazily on first mount.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/src/theme';

import { useAuth } from './AuthContext';

declare global {
  interface Window {
    google?: any;
  }
}

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no document')); return; }
    if (window.google?.accounts?.id) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In script'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

export default function GoogleSignInButton() {
  const { signInWithGoogleIdToken } = useAuth();
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !hostRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (resp: { credential: string }) => {
            signInWithGoogleIdToken(resp.credential).catch((e: any) => {
              console.warn('Google sign-in failed', e?.message || e);
            });
          },
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(hostRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
        });
      })
      .catch((e) => console.warn(e?.message || e));

    return () => {
      cancelled = true;
    };
  }, [signInWithGoogleIdToken]);

  if (!CLIENT_ID) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Google Sign-In isn't configured yet</Text>
      </View>
    );
  }

  return <div ref={hostRef} />;
}

const styles = StyleSheet.create({
  fallback: { paddingVertical: 12, alignItems: 'center' },
  fallbackText: { color: theme.colors.textSubtle, fontSize: 12 },
});
