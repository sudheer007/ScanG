import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { authTheme } from '@/src/auth/authTheme';
import { LOGIN } from '@/constants/testIds/auth';

type Props = {
  onPress: () => void;
  loading?: boolean;
  label?: string;
};

export default function GoogleSignInButton({
  onPress,
  loading = false,
  label = 'Continue with Google',
}: Props) {
  return (
    <TouchableOpacity
      testID={LOGIN.googleSignInButton}
      style={[styles.btn, loading && styles.btnDisabled]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={authTheme.colors.text} />
      ) : (
        <View style={styles.inner}>
          <Ionicons name="logo-google" size={18} color="#EA4335" />
          <Text style={styles.label}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: authTheme.radius,
    borderWidth: 1,
    borderColor: authTheme.colors.border,
    backgroundColor: authTheme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    color: authTheme.colors.googleText,
    fontSize: 16,
    fontWeight: '600',
  },
});
