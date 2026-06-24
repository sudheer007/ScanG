import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { theme } from '@/src/theme';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center} testID="loading-state">
      <ActivityIndicator color={theme.colors.text} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, subtitle, testID = 'empty-state' }: { title: string; subtitle?: string; testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.label}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center} testID="error-state">
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.label}>{message}</Text>
      {onRetry && (
        <Text style={styles.retry} onPress={onRetry} testID="error-retry">Tap to retry</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    minHeight: 240,
  },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  label: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4 },
  retry: { color: theme.colors.text, marginTop: 16, fontWeight: '600', textDecorationLine: 'underline' },
});
