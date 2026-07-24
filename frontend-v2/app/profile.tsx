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
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '@/src/theme';
import { authTheme } from '@/src/auth/authTheme';
import { useAuth } from '@/src/hooks/useAuth';
import { useEntitlement } from '@/src/hooks/useEntitlement';
import AppRefreshControl from '@/src/components/AppRefreshControl';
import { LOGOUT } from '@/constants/testIds/auth';

const ACCENT = authTheme.colors.primary; // logo blue #1A82FF
const ACCENT_DIM = 'rgba(26, 130, 255, 0.14)';
const ACCENT_BORDER = 'rgba(26, 130, 255, 0.28)';
const ACCENT_DEEP = 'rgba(26, 130, 255, 0.22)';

const PREMIUM_GOLD = '#F5C542';
const PREMIUM_DIM = 'rgba(245, 197, 66, 0.16)';
const PREMIUM_BORDER = 'rgba(245, 197, 66, 0.45)';
const BASIC_SLATE = '#94A3B8';
const BASIC_DIM = 'rgba(148, 163, 184, 0.14)';
const BASIC_BORDER = 'rgba(148, 163, 184, 0.35)';

const SUPPORT_EMAIL = 'mahimukesh3176@gmail.com';
const PLAY_STORE_URL = 'https://play.google.com/store/apps';
const APP_STORE_URL = 'https://apps.apple.com';
const INVITE_URL = 'https://web-fin-2ssd.onrender.com';
const INVITE_TITLE = 'Join me on ScanG';
const INVITE_BLURB =
  'Check out ScanG — smarter stock discovery across US & India markets. Open this link and start screening with me:';

type ActionItem = {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
  onPress: () => void | Promise<void>;
};

type ShareChannel = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  border: string;
};

const SHARE_CHANNELS: ShareChannel[] = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: 'logo-whatsapp',
    color: '#25D366',
    bg: 'rgba(37, 211, 102, 0.14)',
    border: 'rgba(37, 211, 102, 0.35)',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: 'paper-plane',
    color: '#2AABEE',
    bg: 'rgba(42, 171, 238, 0.14)',
    border: 'rgba(42, 171, 238, 0.35)',
  },
  {
    key: 'sms',
    label: 'Messages',
    icon: 'chatbubble-ellipses',
    color: '#A78BFA',
    bg: 'rgba(167, 139, 250, 0.14)',
    border: 'rgba(167, 139, 250, 0.35)',
  },
  {
    key: 'email',
    label: 'Email',
    icon: 'mail',
    color: '#F472B6',
    bg: 'rgba(244, 114, 182, 0.14)',
    border: 'rgba(244, 114, 182, 0.35)',
  },
];

function inviteMessage(): string {
  return `${INVITE_BLURB}\n${INVITE_URL}`;
}

async function copyInviteLink(): Promise<boolean> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(INVITE_URL);
    return true;
  }
  // Native fallback without clipboard package: open share with the link.
  await Share.share(
    Platform.OS === 'ios'
      ? { message: INVITE_URL, url: INVITE_URL, title: 'ScanG invite link' }
      : { message: INVITE_URL, title: 'ScanG invite link' },
  );
  return false;
}

async function openExternal(url: string) {
  try {
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const { isPremium, refresh: refreshEntitlement } = useEntitlement();
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const name =
    profile?.display_name?.trim() ||
    user?.displayName?.trim() ||
    'Your account';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshEntitlement();
    } finally {
      setRefreshing(false);
    }
  }, [refreshEntitlement]);

  const closeShare = useCallback(() => {
    setShowShare(false);
    setCopied(false);
    setSharing(false);
  }, []);

  const onReferFriend = useCallback(() => {
    setCopied(false);
    setShowShare(true);
  }, []);

  const onSystemShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      if (Platform.OS !== 'web') {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          /* ignore */
        }
      }
      const message = inviteMessage();
      await Share.share(
        Platform.OS === 'ios'
          ? { message, url: INVITE_URL, title: INVITE_TITLE }
          : { message, title: INVITE_TITLE },
      );
    } catch {
      /* user dismissed share sheet */
    } finally {
      setSharing(false);
    }
  }, [sharing]);

  const onCopyLink = useCallback(async () => {
    try {
      const didCopy = await copyInviteLink();
      if (didCopy) {
        setCopied(true);
        if (Platform.OS !== 'web') {
          try {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            /* ignore */
          }
        }
        setTimeout(() => setCopied(false), 2200);
      }
    } catch {
      Alert.alert('Couldn’t copy', 'Please try Share instead.');
    }
  }, []);

  const onShareChannel = useCallback(
    async (key: string) => {
      const text = inviteMessage();
      const encoded = encodeURIComponent(text);
      const encodedUrl = encodeURIComponent(INVITE_URL);
      const encodedTitle = encodeURIComponent(INVITE_TITLE);

      let url = '';
      if (key === 'whatsapp') {
        url = `https://wa.me/?text=${encoded}`;
      } else if (key === 'telegram') {
        url = `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(INVITE_BLURB)}`;
      } else if (key === 'sms') {
        url = Platform.OS === 'ios' ? `sms:&body=${encoded}` : `sms:?body=${encoded}`;
      } else if (key === 'email') {
        url = `mailto:?subject=${encodedTitle}&body=${encoded}`;
      }

      const opened = url ? await openExternal(url) : false;
      if (!opened) {
        await onSystemShare();
      }
    },
    [onSystemShare],
  );

  const onHelpSupport = useCallback(async () => {
    const userEmail = profile?.email?.trim() || user?.email?.trim() || '';
    const subject = encodeURIComponent('ScanG Help & Support');
    const body = encodeURIComponent(
      `Hi ScanG team,\n\nI need help with:\n\n\n—\nUser: ${name}\nEmail: ${userEmail || 'n/a'}\n`,
    );
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    try {
      // Prefer opening the mail client directly — canOpenURL is unreliable for mailto on web.
      await Linking.openURL(mailto);
      return;
    } catch {
      /* fall through */
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = mailto;
      return;
    }

    Alert.alert('Help & Support', `Email us at ${SUPPORT_EMAIL}`);
  }, [name, profile?.email, user?.email]);

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
      key: 'subscription',
      title: isPremium ? 'Manage Subscription' : 'Upgrade to Premium',
      icon: isPremium ? 'diamond' : 'diamond-outline',
      testID: 'profile-subscription',
      onPress: () => {
        router.push((isPremium ? '/subscription-manage' : '/subscribe') as Href);
      },
    },
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

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.lead}>Account & security</Text>
        <Text style={styles.sub}>Manage your account and get support.</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(name || 'U').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.profileMeta}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <View
              testID={isPremium ? 'profile-tag-premium' : 'profile-tag-basic'}
              style={[styles.planTag, isPremium ? styles.planTagPremium : styles.planTagBasic]}
            >
              <Ionicons
                name={isPremium ? 'diamond' : 'shield-outline'}
                size={11}
                color={isPremium ? PREMIUM_GOLD : BASIC_SLATE}
              />
              <Text style={[styles.planTagText, isPremium ? styles.planTagTextPremium : styles.planTagTextBasic]}>
                {isPremium ? 'Premium' : 'Basic'}
              </Text>
            </View>
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

      <Modal visible={showShare} transparent animationType="fade" onRequestClose={closeShare}>
        <View style={styles.shareBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeShare} testID="share-backdrop" />
          <View style={styles.shareSheet}>
            <View style={styles.shareHandle} />

            <LinearGradient
              colors={['rgba(26,130,255,0.22)', 'rgba(26,130,255,0.05)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.shareHero}
            >
              <View style={styles.shareHeroIcon}>
                <Ionicons name="gift" size={26} color={ACCENT} />
              </View>
              <Text style={styles.shareTitle}>Invite a friend</Text>
              <Text style={styles.shareSubtitle}>
                Share ScanG with friends — they’ll open your link on WhatsApp, Messages, Email, and more.
              </Text>
            </LinearGradient>

            <View style={styles.linkCard}>
              <View style={styles.linkIcon}>
                <Ionicons name="link-outline" size={18} color={ACCENT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkLabel}>Your invite link</Text>
                <Text style={styles.linkUrl} numberOfLines={1}>
                  {INVITE_URL.replace(/^https:\/\//, '')}
                </Text>
              </View>
              <Pressable
                testID="share-copy"
                onPress={() => void onCopyLink()}
                style={({ pressed }) => [
                  styles.copyBtn,
                  copied && styles.copyBtnDone,
                  pressed && styles.copyBtnPressed,
                ]}
              >
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={15}
                  color={copied ? theme.colors.success : ACCENT}
                />
                <Text style={[styles.copyBtnText, copied && styles.copyBtnTextDone]}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.channelLabel}>Share via</Text>
            <View style={styles.channelGrid}>
              {SHARE_CHANNELS.map((ch) => (
                <Pressable
                  key={ch.key}
                  testID={`share-channel-${ch.key}`}
                  onPress={() => void onShareChannel(ch.key)}
                  style={({ pressed }) => [
                    styles.channelBtn,
                    { backgroundColor: ch.bg, borderColor: ch.border },
                    pressed && styles.channelBtnPressed,
                  ]}
                >
                  <View style={styles.channelIcon}>
                    <Ionicons name={ch.icon} size={20} color={ch.color} />
                  </View>
                  <Text style={[styles.channelText, { color: ch.color }]}>{ch.label}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              testID="share-system"
              onPress={() => void onSystemShare()}
              disabled={sharing}
              style={({ pressed }) => [
                styles.primaryShareBtn,
                pressed && styles.primaryShareBtnPressed,
                sharing && { opacity: 0.75 },
              ]}
            >
              {sharing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="share-social" size={18} color="#fff" />
                  <Text style={styles.primaryShareText}>Share with any app</Text>
                </>
              )}
            </Pressable>

            <Pressable
              testID="share-close"
              onPress={closeShare}
              style={({ pressed }) => [styles.shareCancel, pressed && styles.shareCancelPressed]}
            >
              <Text style={styles.shareCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  profileMeta: { flex: 1, gap: 8 },
  name: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  planTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  planTagPremium: {
    backgroundColor: PREMIUM_DIM,
    borderColor: PREMIUM_BORDER,
  },
  planTagBasic: {
    backgroundColor: BASIC_DIM,
    borderColor: BASIC_BORDER,
  },
  planTagText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  planTagTextPremium: { color: PREMIUM_GOLD },
  planTagTextBasic: { color: BASIC_SLATE },
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

  shareBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  shareSheet: {
    zIndex: 2,
    backgroundColor: theme.colors.bg2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderBottomWidth: 0,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: Platform.OS === 'web' ? theme.spacing.xl : theme.spacing.xxl,
    gap: 14,
    ...Platform.select({
      web: {
        maxWidth: 480,
        width: '100%' as const,
        alignSelf: 'center' as const,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 24,
        borderBottomWidth: 1,
      },
      default: {},
    }),
  },
  shareHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: 4,
  },
  shareHero: {
    borderRadius: 18,
    padding: theme.spacing.lg,
    gap: 8,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  shareHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  shareTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  shareSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: theme.colors.bg3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: {
    color: theme.colors.textSubtle,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  linkUrl: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  copyBtnDone: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  copyBtnPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  copyBtnText: { color: ACCENT, fontSize: 12, fontWeight: '700' },
  copyBtnTextDone: { color: theme.colors.success },
  channelLabel: {
    color: theme.colors.textSubtle,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  channelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  channelBtn: {
    width: '47%',
    flexGrow: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  channelBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  channelIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelText: {
    fontSize: 13,
    fontWeight: '700',
  },
  primaryShareBtn: {
    marginTop: 4,
    height: 52,
    borderRadius: 16,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryShareBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  primaryShareText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  shareCancel: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  shareCancelPressed: {
    backgroundColor: theme.colors.border,
  },
  shareCancelText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
