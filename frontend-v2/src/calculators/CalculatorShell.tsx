import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';

import { DonutChart } from '@/src/calculators/DonutChart';
import { ValueSlider } from '@/src/calculators/ValueSlider';
import { fmtInrCompact, type CalcResult } from '@/src/calculators/calcMath';
import { authTheme } from '@/src/auth/authTheme';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';

const SIP_BLUE_START = '#061D3E';
const SIP_BLUE_END = '#040A16';
const PRINCIPAL_COLOR = authTheme.colors.primary;
const RETURNS_COLOR = '#FFFFFF';
const BODY_BG = '#0A0A0C';

export type SliderSpec = {
  testID: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  onChange: (v: number) => void;
};

type Props = {
  testID: string;
  title: string;
  result: CalcResult;
  sliders: SliderSpec[];
  investedLabel?: string;
  returnsLabel?: string;
  totalLabel?: string;
};

export function CalculatorShell({
  testID,
  title,
  result,
  sliders,
  investedLabel = 'Principal Investment',
  returnsLabel = 'Expected Returns',
  totalLabel = 'Total Wealth',
}: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const principalRatio =
    result.maturity > 0 ? clamp(result.invested / result.maturity, 0, 1) : 1;
  const centerPct = `${Math.round(result.returnsPct)}%`;

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 350);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID={testID}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[SIP_BLUE_START, SIP_BLUE_END]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.headerBar}>
          <TouchableOpacity
            testID="calculator-detail-back"
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.backBtnGhost} />
        </View>

        <AppScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.resultsPanel}>
            <View style={styles.resultsRow}>
              <View style={styles.metrics}>
                <Metric
                  swatch={PRINCIPAL_COLOR}
                  label={investedLabel}
                  value={fmtInrCompact(result.invested)}
                />
                <Metric
                  swatch={RETURNS_COLOR}
                  label={returnsLabel}
                  value={fmtInrCompact(result.gains)}
                />
                <Metric label={totalLabel} value={fmtInrCompact(result.maturity)} bold />
              </View>
              <DonutChart
                principalRatio={principalRatio}
                centerLabel={centerPct}
                principalColor={PRINCIPAL_COLOR}
                returnsColor={RETURNS_COLOR}
              />
            </View>
          </View>

          <View style={styles.inputs}>
            {sliders.map((s) => (
              <ValueSlider
                key={s.testID}
                testID={s.testID}
                label={s.label}
                value={s.value}
                min={s.min}
                max={s.max}
                step={s.step}
                formatValue={s.formatValue}
                onChange={s.onChange}
              />
            ))}
          </View>
        </AppScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

function Metric({
  label,
  value,
  swatch,
  bold,
}: {
  label: string;
  value: string;
  swatch?: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricLabelRow}>
        {swatch ? <View style={[styles.swatch, { backgroundColor: swatch }]} /> : null}
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={[styles.metricValue, bold && styles.metricValueBold]}>{value}</Text>
    </View>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SIP_BLUE_START },
  gradient: { flex: 1 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnGhost: { width: 40, height: 40 },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: { flexGrow: 1 },
  resultsPanel: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
  },
  resultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metrics: { flex: 1, gap: 16, paddingRight: 4 },
  metric: { gap: 4 },
  metricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: {
    width: 4,
    height: 14,
    borderRadius: 2,
  },
  metricLabel: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    fontWeight: '500',
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  metricValueBold: {
    fontSize: 24,
    fontWeight: '800',
  },
  inputs: {
    flexGrow: 1,
    backgroundColor: BODY_BG,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 14,
  },
});
