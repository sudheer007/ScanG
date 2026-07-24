import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';

const BLUE = authTheme.colors.primary; // logo blue #1A82FF
const BLUE_DIM = 'rgba(26, 130, 255, 0.14)';
const BLUE_BORDER = 'rgba(26, 130, 255, 0.28)';
const BLUE_DEEP = 'rgba(26, 130, 255, 0.22)';

type CalcItem = {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CALCULATORS: CalcItem[] = [
  {
    id: 'sip',
    title: 'SIP Calculator',
    subtitle: 'Plan your monthly investments',
    icon: 'trending-up-outline',
  },
  {
    id: 'etf',
    title: 'ETF Calculator',
    subtitle: 'Calculate exchange-traded fund growth',
    icon: 'pie-chart-outline',
  },
  {
    id: 'bonds',
    title: 'Bonds Calculator',
    subtitle: 'Evaluate bond yields and interest',
    icon: 'wallet-outline',
  },
  {
    id: 'fd',
    title: 'FD Calculator',
    subtitle: 'Estimate fixed deposit maturity',
    icon: 'cash-outline',
  },
];

export default function CalculatorsScreen() {
  const router = useRouter();
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="calculators-screen">
      <LinearGradient
        colors={['rgba(26, 130, 255, 0.28)', 'rgba(26, 130, 255, 0.08)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGlow}
      >
        <View style={styles.header}>
          <TouchableOpacity
            testID="calculators-back"
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Calculators</Text>
          <View style={styles.iconBtnGhost} />
        </View>
      </LinearGradient>

      <AppScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <LinearGradient
          colors={['rgba(26, 130, 255, 0.32)', 'rgba(26, 130, 255, 0.12)', 'rgba(20, 20, 23, 0.9)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroBadge}>
            <Ionicons name="sparkles" size={14} color={BLUE} />
            <Text style={styles.heroBadgeText}>Planning tools</Text>
          </View>
          <Text style={styles.heroTitle}>Financial Planning</Text>
          <Text style={styles.heroSubtitle}>
            Select a specialized calculator to estimate your future wealth and optimize your
            investment strategy.
          </Text>
        </LinearGradient>

        <View style={styles.list}>
          {CALCULATORS.map((item) => (
            <Pressable
              key={item.id}
              testID={`calculator-${item.id}`}
              onPress={() => router.push(`/calculators/${item.id}` as Href)}
              onPressIn={() => setPressedId(item.id)}
              onPressOut={() => setPressedId(null)}
              style={[styles.card, pressedId === item.id && styles.cardPressed]}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={22} color={BLUE} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSub}>{item.subtitle}</Text>
              </View>
              <View style={styles.chevronWrap}>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
              </View>
            </Pressable>
          ))}
        </View>
      </AppScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  headerGlow: {
    paddingBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  iconBtnGhost: {
    width: 40,
    height: 40,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 40,
    paddingTop: theme.spacing.sm,
  },
  hero: {
    borderRadius: 20,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    borderWidth: 1,
    borderColor: BLUE_BORDER,
    overflow: 'hidden',
  },
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: BLUE_DIM,
    borderWidth: 1,
    borderColor: BLUE_BORDER,
    marginBottom: 14,
  },
  heroBadgeText: {
    color: BLUE,
    fontSize: 12,
    fontWeight: '700',
  },
  heroTitle: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 10,
  },
  heroSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  list: { gap: 14 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardPressed: {
    borderColor: BLUE_BORDER,
    backgroundColor: BLUE_DEEP,
    transform: [{ scale: 0.985 }],
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BLUE_DIM,
    borderWidth: 1,
    borderColor: BLUE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 4 },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardSub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  chevronWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});
