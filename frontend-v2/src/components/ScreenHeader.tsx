import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  testID?: string;
}

export default function ScreenHeader({ title, subtitle, right, testID }: Props) {
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
});
