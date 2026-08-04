import React from 'react';
import { Redirect, Tabs, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PlatformPressable } from '@react-navigation/elements';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { theme } from '@/src/theme';
import {
  Platform,
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';

import { useAuth } from '@/src/hooks/useAuth';
import { useEntitlement } from '@/src/hooks/useEntitlement';

/** Same threshold React Navigation uses for beside-icon tab labels. */
const LAPTOP_MIN = 768;

function TabIcon({ name, color }: { name: keyof typeof Ionicons.glyphMap; color: string }) {
  return <Ionicons name={name} size={22} color={color} />;
}

function ProTag() {
  return (
    <View style={proStyles.tag} testID="tab-discover-pro">
      <Text style={proStyles.tagText}>PRO</Text>
    </View>
  );
}

const proStyles = StyleSheet.create({
  tag: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
  },
  tagText: {
    color: '#0A0A0C',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.4,
    lineHeight: 11,
  },
});

/**
 * Mobile (<768): icon → PRO → Discover (stacked, no overlap).
 * Laptop (≥768): [icon Discover] row, PRO centered under both.
 */
function DiscoverTabButton({
  showPro,
  children: _children,
  style,
  ...rest
}: BottomTabBarButtonProps & { showPro: boolean }) {
  const { width } = useWindowDimensions();
  const isLaptop = width >= LAPTOP_MIN;
  const focused = rest['aria-selected'] === true;
  const color = focused ? theme.colors.text : theme.colors.textSubtle;

  if (isLaptop) {
    return (
      <PlatformPressable
        {...rest}
        style={[style, discoverStyles.laptopBtn]}
        testID="tab-discover"
      >
        <View style={discoverStyles.laptopRow}>
          <Ionicons name="sparkles" size={22} color={color} />
          <Text style={[discoverStyles.label, { color }]}>Discover</Text>
        </View>
        {showPro ? (
          <View style={discoverStyles.laptopPro}>
            <ProTag />
          </View>
        ) : null}
      </PlatformPressable>
    );
  }

  return (
    <PlatformPressable
      {...rest}
      style={[style, discoverStyles.mobileBtn]}
      testID="tab-discover"
    >
      <Ionicons name="sparkles" size={22} color={color} />
      {showPro ? (
        <View style={discoverStyles.mobilePro}>
          <ProTag />
        </View>
      ) : null}
      <Text style={[discoverStyles.label, { color }]}>Discover</Text>
    </PlatformPressable>
  );
}

const discoverStyles = StyleSheet.create({
  mobileBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobilePro: {
    marginTop: 3,
    marginBottom: 2,
  },
  laptopBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laptopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  laptopPro: {
    marginTop: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default function TabsLayout() {
  const { user, loading, needsOnboarding } = useAuth();
  const { isPremium, hydrated } = useEntitlement();
  const showDiscoverPro = hydrated && isPremium;
  const { width } = useWindowDimensions();
  const isLaptop = width >= LAPTOP_MIN;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href={'/login' as Href} />;
  }

  if (needsOnboarding) {
    return <Redirect href={'/welcome' as Href} />;
  }

  // Extra height on mobile so PRO between icon + label does not clip.
  const tabBarHeight = isLaptop
    ? showDiscoverPro
      ? 64
      : 56
    : 64 + (showDiscoverPro ? 16 : 0) + (Platform.OS === 'ios' ? 24 : 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.colors.textSubtle,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(10,10,12,0.96)',
          borderTopColor: theme.colors.border,
          borderTopWidth: 0.5,
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 24 : 10,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView intensity={70} tint="dark" style={{ flex: 1 }} />
          ) : (
            <View style={{ flex: 1, backgroundColor: 'rgba(10,10,12,0.96)' }} />
          ),
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Markets',
          tabBarIcon: ({ color }) => <TabIcon name="trending-up" color={color} />,
          tabBarTestID: 'tab-markets',
        }}
      />
      <Tabs.Screen
        name="radar"
        options={{
          title: 'Radar',
          tabBarIcon: ({ color }) => <TabIcon name="radio" color={color} />,
          tabBarTestID: 'tab-radar',
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: () => null,
          tabBarLabel: () => null,
          tabBarButton: (props) => (
            <DiscoverTabButton {...props} showPro={showDiscoverPro} />
          ),
        }}
      />
      <Tabs.Screen
        name="screener"
        options={{
          title: 'Screener',
          tabBarIcon: ({ color }) => <TabIcon name="options" color={color} />,
          tabBarTestID: 'tab-screener',
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => <TabIcon name="ellipsis-horizontal-circle" color={color} />,
          tabBarTestID: 'tab-more',
        }}
      />
    </Tabs>
  );
}
