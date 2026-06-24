import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

interface Option<T extends string> { value: T; label: string; testID?: string }

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
  scrollable?: boolean;
}

export default function ChipRow<T extends string>({ options, value, onChange, testID, scrollable = true }: Props<T>) {
  const Inner = scrollable ? ScrollView : View;
  return (
    <Inner
      horizontal={scrollable}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={scrollable ? styles.row : undefined}
      style={scrollable ? styles.wrap : styles.rowStatic}
      testID={testID}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            testID={o.testID || `chip-${o.value}`}
            onPress={() => onChange(o.value)}
            activeOpacity={0.8}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </Inner>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 56 },
  row: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: theme.spacing.lg,
    height: 56,
  },
  rowStatic: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  chip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipSelected: {
    borderColor: theme.colors.text,
    backgroundColor: theme.colors.text,
  },
  chipText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  chipTextSelected: { color: theme.colors.bg },
});
