import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { Platform, View } from 'react-native';
import { BlurView } from 'expo-blur';

function TabIcon({ name, color }: { name: keyof typeof Ionicons.glyphMap; color: string }) {
  return <Ionicons name={name} size={22} color={color} />;
}

export default function TabsLayout() {
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
          height: 64 + (Platform.OS === 'ios' ? 24 : 8),
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
        name="screener"
        options={{
          title: 'Screener',
          tabBarIcon: ({ color }) => <TabIcon name="options" color={color} />,
          tabBarTestID: 'tab-screener',
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Watchlist',
          tabBarIcon: ({ color }) => <TabIcon name="bookmark" color={color} />,
          tabBarTestID: 'tab-watchlist',
        }}
      />
    </Tabs>
  );
}
