import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Share,
  Linking,
  Alert,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';

import { theme } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import { useAuth } from '@/src/hooks/useAuth';
import { LOGOUT } from '@/constants/testIds/auth';

const ACCENT = authTheme.colors.primary; // logo blue #1A82FF
const ACCENT_DIM = 'rgba(26, 130, 255, 0.14)';
const ACCENT_BORDER = 'rgba(26, 130, 255, 0.28)';
const ACCENT_DEEP = 'rgba(26, 130, 255, 0.22)';

const SUPPORT_EMAIL = 'support@scang.app';
const PLAY_STORE_URL = 'https://play.google.com/store/apps';
const APP_STORE_URL = 'https://apps.apple.com';

type ActionItem = {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
  onPress: () => void | Promise<void>;
};

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const name =
    profile?.display_name?.trim() ||
    user?.displayName?.trim() ||
    'Your account';

  const onReferFriend = useCallback(async () => {
    try {
      await Share.share({
        message:
          'Check out ScanG — a smarter way to discover stocks across US & India markets. Download the app and start screening with me!',
        title: 'Invite a friend to ScanG',
      });
    } catch {
      /* user dismissed share sheet */
    }
  }, []);

  const onHelpSupport = useCallback(async () => {
    const subject = encodeURIComponent('ScanG Help & Support');
    const body = encodeURIComponent(
      `Hi ScanG team,\n\nI need help with:\n\n\n—\nUser: ${name}\n`,
    );
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    try {
      const can = await Linking.canOpenURL(mailto);
      if (can) {
        await Linking.openURL(mailto);
        return;
      }
    } catch {
      /* fall through */
    }
    Alert.alert('Help & Support', `Email us at ${SUPPORT_EMAIL}`);
  }, [name]);

  const onRateUs = useCallback(async () => {
    const storeUrl = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
    const openStore = async () => {
      try {
        await Linking.openURL(storeUrl);
      } catch {
        Alert.alert('Thanks!', 'Rating will be available once the app is live on the store.');
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Rate on the App Store'],
          cancelButtonIndex: 0,
          title: 'Enjoying ScanG?',
          message: 'A quick rating helps more traders discover the app.',
        },
        (index) => {
          if (index === 1) void openStore();
        },
      );
      return;
    }

    Alert.alert('Enjoying ScanG?', 'A quick rating helps more traders discover the app.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Rate us', onPress: () => void openStore() },
    ]);
  }, []);

  const actions: ActionItem[] = [
    {
      key: 'refer',
      title: 'Refer a Friend',
      icon: 'gift-outline',
      testID: 'profile-refer',
      onPress: onReferFriend,
    },
    {
      key: 'help',
      title: 'Help & Support',
      icon: 'help-circle-outline',
      testID: 'profile-help',
      onPress: onHelpSupport,
    },
    {
      key: 'rate',
      title: 'Rate Us',
      icon: 'star-outline',
      testID: 'profile-rate',
      onPress: onRateUs,
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="profile-screen">
      <View style={styles.header}>
        <TouchableOpacity testID="profile-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.iconBtnGhost} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>Account & security</Text>
        <Text style={styles.sub}>Manage your account and get support.</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(name || 'U').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{name}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          {actions.map((item) => (
            <Pressable
              key={item.key}
              testID={item.testID}
              onPress={item.onPress}
              onPressIn={() => setPressedKey(item.key)}
              onPressOut={() => setPressedKey(null)}
              style={[styles.actionCard, pressedKey === item.key && styles.actionCardPressed]}
            >
              <View style={styles.actionIcon}>
                <Ionicons name={item.icon} size={22} color={ACCENT} />
              </View>
              <Text style={styles.actionTitle}>{item.title}</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
            </Pressable>
          ))}
        </View>

        <TouchableOpacity
          testID={LOGOUT.button}
          style={styles.logoutBtn}
          onPress={async () => {
            try {
              await signOut();
            } finally {
              router.replace('/login' as Href);
            }
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={18} color="#FCA5A5" />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  headerTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
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
  iconBtnGhost: { width: 40, height: 40 },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingBottom: 40 },
  lead: {
    color: ACCENT,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: theme.spacing.xl,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: theme.spacing.lg,
    borderRadius: 18,
    backgroundColor: theme.colors.bg2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.xl,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: ACCENT, fontSize: 24, fontWeight: '800' },
  name: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  actions: { gap: 12, marginBottom: theme.spacing.xl },
  actionCard: {
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
  actionCardPressed: {
    borderColor: ACCENT_BORDER,
    backgroundColor: ACCENT_DEEP,
    transform: [{ scale: 0.985 }],
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
  },
  logoutText: { color: '#FCA5A5', fontSize: 15, fontWeight: '700' },
});
