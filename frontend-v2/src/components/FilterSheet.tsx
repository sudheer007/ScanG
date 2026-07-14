import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { Stock } from '@/src/api';
import { BUCKETS, Metric } from '@/src/screener/catalog';
import { ActiveFilters, Range } from '@/src/screener/types';
import { applyFilters } from '@/src/screener/engine';

export type { ActiveFilters } from '@/src/screener/types';

interface Props {
  open: boolean;
  initial: ActiveFilters;
  universe: Stock[];
  onClose: () => void;
  onApply: (f: ActiveFilters) => void;
}

export default function FilterSheet({ open, initial, universe, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<ActiveFilters>({});
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      const init = initial || {};
      setDraft(init);
      setQuery('');
      // expand buckets that already have active filters, else first bucket
      const withActive = new Set<string>();
      BUCKETS.forEach((b) => {
        if (b.metrics.some((m) => init[m.key] !== undefined)) withActive.add(b.id);
      });
      if (withActive.size === 0) withActive.add(BUCKETS[0].id);
      setExpanded(withActive);
    }
  }, [open, initial]);

  const matchCount = useMemo(() => applyFilters(universe, draft).length, [universe, draft]);
  const activeCount = useMemo(() => Object.keys(draft).length, [draft]);

  const setRange = (key: string, side: 'min' | 'max', txt: string) => {
    const v = txt.replace(/[^0-9.\-]/g, '');
    setDraft((prev) => {
      const cur = (prev[key] as Range) || {};
      const next: Range = { ...cur };
      if (!v || v === '-' || v === '.') delete next[side];
      else next[side] = Number(v);
      const out: ActiveFilters = { ...prev };
      if (next.min === undefined && next.max === undefined) delete out[key];
      else out[key] = next;
      return out;
    });
  };

  const toggleBucket = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const visibleBuckets = useMemo(() => {
    if (!searching) return BUCKETS.map((b) => ({ bucket: b, metrics: b.metrics }));
    return BUCKETS.map((b) => ({
      bucket: b,
      metrics: b.metrics.filter((m) => m.label.toLowerCase().includes(q)),
    })).filter((x) => x.metrics.length > 0);
  }, [q, searching]);

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handleWrap}><View style={styles.handle} /></View>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Custom Filters</Text>
                <Text style={styles.subtitle}>{activeCount} active • {matchCount} matches</Text>
              </View>
              <TouchableOpacity testID="filter-close" onPress={onClose} style={styles.iconBtn}>
                <Ionicons name="close" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={theme.colors.textSubtle} />
              <TextInput
                testID="filter-search"
                style={styles.searchInput}
                placeholder="Search 90+ metrics…"
                placeholderTextColor={theme.colors.textSubtle}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color={theme.colors.textSubtle} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
              {visibleBuckets.map(({ bucket, metrics }) => {
                const isOpen = searching || expanded.has(bucket.id);
                const bucketActive = bucket.metrics.filter((m) => draft[m.key] !== undefined).length;
                return (
                  <View key={bucket.id} style={styles.bucket}>
                    <TouchableOpacity
                      testID={`bucket-${bucket.id}`}
                      style={styles.bucketHeader}
                      activeOpacity={0.7}
                      onPress={() => !searching && toggleBucket(bucket.id)}
                    >
                      <View style={[styles.dot, { backgroundColor: bucket.color }]} />
                      <Text style={styles.bucketTitle}>{bucket.title}</Text>
                      {bucketActive > 0 && (
                        <View style={styles.countPill}><Text style={styles.countPillText}>{bucketActive}</Text></View>
                      )}
                      <View style={{ flex: 1 }} />
                      {!searching && (
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textMuted} />
                      )}
                    </TouchableOpacity>

                    {isOpen && metrics.map((m) => (
                      <MetricRow key={m.key} metric={m} range={draft[m.key] as Range} onChange={setRange} />
                    ))}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity testID="filter-clear" onPress={() => setDraft({})} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="filter-apply" onPress={() => onApply(draft)} style={[styles.btn, styles.btnPrimary]}>
                <Text style={styles.btnPrimaryText}>Show {matchCount} results</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function MetricRow({ metric, range, onChange }: { metric: Metric; range?: Range; onChange: (k: string, s: 'min' | 'max', t: string) => void }) {
  const r = range || {};
  if (!metric.available) {
    return (
      <View style={[styles.fieldRow, styles.fieldRowDisabled]} testID={`filter-field-${metric.key}`}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelDisabled}>{metric.label}</Text>
        </View>
        <View style={styles.soonTag}>
          <Text style={styles.soonText}>coming soon</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.fieldRow} testID={`filter-field-${metric.key}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{metric.label}{metric.unit ? <Text style={styles.fieldUnit}>{' '}{metric.unit}</Text> : null}</Text>
        {metric.hint ? <Text style={styles.fieldHint}>{metric.hint}</Text> : null}
      </View>
      <TextInput
        testID={`filter-${metric.key}-min`}
        style={styles.input}
        value={r.min !== undefined ? String(r.min) : ''}
        placeholder="Min"
        placeholderTextColor={theme.colors.textSubtle}
        keyboardType="numbers-and-punctuation"
        onChangeText={(t) => onChange(metric.key, 'min', t)}
      />
      <TextInput
        testID={`filter-${metric.key}-max`}
        style={styles.input}
        value={r.max !== undefined ? String(r.max) : ''}
        placeholder="Max"
        placeholderTextColor={theme.colors.textSubtle}
        keyboardType="numbers-and-punctuation"
        onChangeText={(t) => onChange(metric.key, 'max', t)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: theme.colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '92%',
    paddingHorizontal: theme.spacing.lg,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, height: 42, marginBottom: theme.spacing.sm },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 14, padding: 0 },
  bucket: { marginBottom: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  bucketHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  bucketTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  countPill: { backgroundColor: theme.colors.success, borderRadius: 999, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  countPillText: { color: theme.colors.bg, fontSize: 10, fontWeight: '800' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 19 },
  fieldRowDisabled: { opacity: 1 },
  fieldLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  fieldLabelDisabled: { color: theme.colors.textSubtle, fontSize: 13, fontWeight: '500' },
  fieldUnit: { color: theme.colors.textSubtle, fontSize: 11, fontWeight: '500' },
  fieldHint: { color: theme.colors.textSubtle, fontSize: 10, marginTop: 2 },
  soonTag: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  soonText: { color: theme.colors.textSubtle, fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },
  input: { width: 70, height: 38, borderRadius: 8, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 8, fontSize: 13, textAlign: 'center' },
  footer: { flexDirection: 'row', gap: 10, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { flex: 0.5, backgroundColor: theme.colors.bg2, borderWidth: 1, borderColor: theme.colors.border },
  btnGhostText: { color: theme.colors.text, fontWeight: '600' },
  btnPrimary: { backgroundColor: theme.colors.success },
  btnPrimaryText: { color: theme.colors.bg, fontWeight: '800' },
});
