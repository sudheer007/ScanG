import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth/AuthContext';
import GoogleSignInButton from '@/src/auth/GoogleSignInButton';
import { theme } from '@/src/theme';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AccountSheet({ open, onClose }: Props) {
  const { user, signOut } = useAuth();

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handleWrap}><View style={styles.handle} /></View>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Account</Text>
              <Text style={styles.subtitle}>{user ? 'Signed in with Google' : 'Not signed in'}</Text>
            </View>
            <TouchableOpacity testID="account-close" onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          {user ? (
            <View style={styles.profile} testID="account-profile">
              {user.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{(user.name || user.email || '?').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user.name || 'Signed in'}</Text>
                {user.email ? <Text style={styles.email}>{user.email}</Text> : null}
              </View>
            </View>
          ) : (
            <View style={styles.signinWrap}>
              <Text style={styles.hint}>
                Optional — sign in with Google for a secure, verified account. Everything works fine without it.
              </Text>
              <GoogleSignInButton />
            </View>
          )}

          {user && (
            <TouchableOpacity
              testID="account-sign-out"
              onPress={() => { signOut(); onClose(); }}
              style={styles.signOutBtn}
            >
              <Ionicons name="log-out-outline" size={16} color={theme.colors.error} />
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: theme.spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.bg2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  email: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  signinWrap: { paddingVertical: theme.spacing.md, gap: theme.spacing.md, alignItems: 'center' },
  hint: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: theme.spacing.md, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border },
  signOutText: { color: theme.colors.error, fontSize: 13, fontWeight: '700' },
});
