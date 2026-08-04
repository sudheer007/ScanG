import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';

import AuthLayout from '@/src/components/auth/AuthLayout';
import GoogleSignInButton from '@/src/components/auth/GoogleSignInButton';
import { useAuth } from '@/src/hooks/useAuth';
import { authTheme } from '@/src/auth/authTheme';

export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // Auth layout / index redirect based on needsOnboarding after profile loads.
    } catch (e: any) {
      setError(e?.message || 'Google sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome" subtitle="Sign in with Google to continue">
      <GoogleSignInButton onPress={onGoogle} loading={busy} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: {
    color: authTheme.colors.error,
    fontSize: 13,
    textAlign: 'center',
  },
});
