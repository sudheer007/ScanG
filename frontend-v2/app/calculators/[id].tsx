import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { theme } from '@/src/theme';
import SipCalculatorScreen from '@/src/calculators/SipCalculatorScreen';
import EtfCalculatorScreen from '@/src/calculators/EtfCalculatorScreen';
import BondCalculatorScreen from '@/src/calculators/BondCalculatorScreen';
import FdCalculatorScreen from '@/src/calculators/FdCalculatorScreen';

type CalcId = 'sip' | 'etf' | 'bonds' | 'fd';

export default function CalculatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const calcId = (['sip', 'etf', 'bonds', 'fd'].includes(id || '') ? id : 'sip') as CalcId;

  if (calcId === 'sip') return <SipCalculatorScreen />;
  if (calcId === 'etf') return <EtfCalculatorScreen />;
  if (calcId === 'bonds') return <BondCalculatorScreen />;
  if (calcId === 'fd') return <FdCalculatorScreen />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Calculator not found</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: theme.colors.textMuted, fontSize: 15 },
});
