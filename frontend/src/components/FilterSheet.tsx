import React, { useEffect, useState } from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export type Range = { min?: number; max?: number };
export type ActiveFilters = Record<string, Range | string>;

interface FilterField {
  key: string;
  label: string;
  unit?: string;
  hint?: string;
}
interface FilterGroup { title: string; fields: FilterField[]; }

const GROUPS: FilterGroup[] = [
  {
    title: 'Fundamentals',
    fields: [
      { key: 'market_cap', label: 'Market Cap', unit: 'USD/INR', hint: 'e.g. min 1e9 (1B)' },
      { key: 'pe', label: 'P/E ratio' },
      { key: 'pb', label: 'P/B ratio' },
      { key: 'roe', label: 'ROE', unit: '%' },
      { key: 'debt_to_equity', label: 'Debt / Equity', unit: '%' },
      { key: 'dividend_yield', label: 'Dividend Yield', unit: '%' },
      { key: 'eps_growth', label: 'EPS Growth', unit: '%' },
      { key: 'revenue_growth', label: 'Revenue Growth', unit: '%' },
      { key: 'profit_margin', label: 'Profit Margin', unit: '%' },
    ],
  },
  {
    title: 'Technicals',
    fields: [
      { key: 'rsi', label: 'RSI (14)', hint: '0–100' },
      { key: 'change_pct', label: 'Today % change', unit: '%' },
      { key: 'volume_surge', label: 'Volume Surge', unit: 'x avg', hint: '>1 = above avg' },
      { key: 'from_52w_high_pct', label: 'From 52w high', unit: '%', hint: 'negative values' },
    ],
  },
];

interface Props {
  open: boolean;
  initial: ActiveFilters;
  onClose: () => void;
  onApply: (f: ActiveFilters) => void;
}

export default function FilterSheet({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<ActiveFilters>({});

  useEffect(() => { if (open) setDraft(initial || {}); }, [open, initial]);

  const setRange = (key: string, side: 'min' | 'max', txt: string) => {
    const v = txt.trim();
    setDraft((prev) => {
      const cur = (prev[key] as Range) || {};
      const next: Range = { ...cur };
      if (!v) delete next[side];
      else next[side] = Number(v);
      const out: ActiveFilters = { ...prev };
      if (next.min === undefined && next.max === undefined) delete out[key];
      else out[key] = next;
      return out;
    });
  };

  const clearAll = () => setDraft({});

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handleWrap}><View style={styles.handle} /></View>
            <View style={styles.header}>
              <Text style={styles.title}>Filters</Text>
              <TouchableOpacity testID="filter-close" onPress={onClose} style={styles.iconBtn}>
                <Ionicons name="close" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
              {GROUPS.map((g) => (
                <View key={g.title} style={styles.group}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  {g.fields.map((f) => {
                    const r = (draft[f.key] as Range) || {};
                    return (
                      <View key={f.key} style={styles.fieldRow} testID={`filter-field-${f.key}`}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fieldLabel}>{f.label}{f.unit ? <Text style={styles.fieldUnit}>{' '}({f.unit})</Text> : null}</Text>
                          {f.hint ? <Text style={styles.fieldHint}>{f.hint}</Text> : null}
                        </View>
                        <TextInput
                          testID={`filter-${f.key}-min`}
                          style={styles.input}
                          value={r.min !== undefined ? String(r.min) : ''}
                          placeholder="Min"
                          placeholderTextColor={theme.colors.textSubtle}
                          keyboardType="numbers-and-punctuation"
                          onChangeText={(t) => setRange(f.key, 'min', t)}
                        />
                        <TextInput
                          testID={`filter-${f.key}-max`}
                          style={styles.input}
                          value={r.max !== undefined ? String(r.max) : ''}
                          placeholder="Max"
                          placeholderTextColor={theme.colors.textSubtle}
                          keyboardType="numbers-and-punctuation"
                          onChangeText={(t) => setRange(f.key, 'max', t)}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity testID="filter-clear" onPress={clearAll} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="filter-apply" onPress={() => onApply(draft)} style={[styles.btn, styles.btnPrimary]}>
                <Text style={styles.btnPrimaryText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: theme.colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
    paddingHorizontal: theme.spacing.lg,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  group: { marginBottom: theme.spacing.lg },
  groupTitle: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: theme.spacing.sm },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  fieldLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  fieldUnit: { color: theme.colors.textSubtle, fontSize: 11, fontWeight: '500' },
  fieldHint: { color: theme.colors.textSubtle, fontSize: 10, marginTop: 2 },
  input: { width: 72, height: 38, borderRadius: 8, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 8, fontSize: 13, textAlign: 'center' },
  footer: { flexDirection: 'row', gap: 10, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },
  btnGhostText: { color: theme.colors.text, fontWeight: '600' },
  btnPrimary: { backgroundColor: theme.colors.text },
  btnPrimaryText: { color: theme.colors.bg, fontWeight: '700' },
});
