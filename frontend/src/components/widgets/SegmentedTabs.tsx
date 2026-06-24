import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { theme } from '@/src/theme';

export interface SegmentOption { value: string; label: string; count?: number }

interface Props {
  options: SegmentOption[];
  value: string;
  onChange: (v: string) => void;
  testID?: string;
}

export default function SegmentedTabs({ options, value, onChange, testID }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wrap} contentContainerStyle={styles.inner} testID={testID}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.tab, active && styles.tabActive]}
            testID={`seg-${o.value}`}
          >
            <Text style={[styles.text, active && styles.textActive]}>{o.label}</Text>
            {typeof o.count === 'number' ? (
              <View style={[styles.count, active && styles.countActive]}>
                <Text style={[styles.countText, active && styles.countTextActive]}>{o.count}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 0 },
  inner: { paddingHorizontal: theme.spacing.lg, gap: 8, paddingVertical: 6 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  tabActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  text: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  textActive: { color: theme.colors.bg },
  count: { backgroundColor: theme.colors.bg3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, minWidth: 18, alignItems: 'center' },
  countActive: { backgroundColor: 'rgba(0,0,0,0.15)' },
  countText: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' },
  countTextActive: { color: theme.colors.bg },
});
