import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import { useAuth } from '@/src/hooks/useAuth';
import { listWatchlist } from '@/src/services/watchlistService';
import { listPortfolio } from '@/src/services/portfolioService';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import AppScrollView from '@/src/components/AppScrollView';

const ACCENT = authTheme.colors.primary; // logo blue #1A82FF
const ACCENT_DIM = 'rgba(26, 130, 255, 0.14)';
const ACCENT_BORDER = 'rgba(26, 130, 255, 0.28)';

type MenuItem = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
  testID: string;
};

export default function MoreScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [watchCount, setWatchCount] = useState(0);
  const [portfolioCount, setPortfolioCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const reloadCounts = useCallback(async () => {
    const [watch, port] = await Promise.all([listWatchlist(user?.uid), listPortfolio(user?.uid)]);
    setWatchCount(watch.length);
    setPortfolioCount(port.length);
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void reloadCounts().then(() => {
        if (!active) return;
      });
      return () => {
        active = false;
      };
    }, [reloadCounts]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reloadCounts();
    } finally {
      setRefreshing(false);
    }
  }, [reloadCounts]);

  const displayName =
    profile?.display_name?.trim() ||
    user?.displayName?.trim() ||
    user?.email?.split('@')[0] ||
    'Trader';

  const items: MenuItem[] = [
    {
      key: 'subscribe',
      title: 'Upgrade to Premium',
      subtitle: 'Unlock full screener & analyzer',
      icon: 'diamond-outline',
      href: '/subscribe' as Href,
      testID: 'more-subscribe',
    },
    {
      key: 'nifty-pulse',
      title: 'Nifty Pulse',
      subtitle: '5–30s Nifty 50 up/down signal',
      icon: 'pulse-outline',
      href: '/nifty-pulse' as Href,
      testID: 'more-nifty-pulse',
    },
    {
      key: 'portfolio',
      title: 'Portfolio',
      subtitle:
        portfolioCount === 0
          ? 'Upload holdings to track P&L'
          : `${portfolioCount} holding${portfolioCount === 1 ? '' : 's'}`,
      icon: 'pie-chart-outline',
      href: '/portfolio' as Href,
      testID: 'more-portfolio',
    },
    {
      key: 'watchlist',
      title: 'Watchlist',
      subtitle:
        watchCount === 0
          ? 'No active trackers yet'
          : `${watchCount} active tracker${watchCount === 1 ? '' : 's'}`,
      icon: 'eye-outline',
      href: '/watchlist' as Href,
      testID: 'more-watchlist',
    },
    {
      key: 'calculators',
      title: 'Calculators',
      subtitle: 'Profit & margin analysis',
      icon: 'calculator-outline',
      href: '/calculators' as Href,
      testID: 'more-calculators',
    },
    {
      key: 'profile',
      title: 'Profile',
      subtitle: 'Account & security settings',
      icon: 'person-outline',
      href: '/profile' as Href,
      testID: 'more-profile',
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="more-screen">
      <AppScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>More</Text>
            <Text style={styles.subtitle}>Settings & tools</Text>
          </View>
        </View>

        <LinearGradient
          colors={['rgba(26, 130, 255, 0.22)', 'rgba(26, 130, 255, 0.06)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.heroEyebrow}>Hello, {displayName.split(' ')[0]}</Text>
          <Text style={styles.heroTitle}>Settings & Tools</Text>
          <Text style={styles.heroSubtitle}>
            Manage your trading environment and analytical tools.
          </Text>
        </LinearGradient>

        <View style={styles.list}>
          {items.map((item, index) => (
            <Pressable
              key={item.key}
              testID={item.testID}
              onPress={() => router.push(item.href)}
              style={({ pressed }) => [
                styles.row,
                index === 0 && styles.rowFirst,
                index === items.length - 1 && styles.rowLast,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={22} color={ACCENT} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text} />
            </Pressable>
          ))}
        </View>
      </AppScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { paddingBottom: 130 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xl,
  },
  title: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  hero: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    overflow: 'hidden',
  },
  heroEyebrow: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  heroTitle: {
    color: ACCENT,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  heroSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 320,
  },
  list: {
    marginHorizontal: theme.spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg2,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
    gap: 14,
  },
  rowFirst: {},
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.03)' },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 3 },
  rowTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
});
