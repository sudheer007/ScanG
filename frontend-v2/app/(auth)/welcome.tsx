import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/src/hooks/useAuth';
import { authTheme } from '@/src/auth/authTheme';
import { ONBOARDING } from '@/constants/testIds/auth';

const NAME_MAX = 50;
const FORM_MAX = 420;
const LAPTOP_MIN = 768;

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isLaptop = width >= LAPTOP_MIN;
  const { user, profile, needsOnboarding, completeOnboarding } = useAuth();
  const suggestedName = useMemo(() => {
    const fromProfile = profile?.display_name?.trim();
    if (fromProfile) return fromProfile.slice(0, NAME_MAX);
    return (user?.displayName || '').trim().slice(0, NAME_MAX);
  }, [profile?.display_name, user?.displayName]);

  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(suggestedName);
  }, [suggestedName]);

  useEffect(() => {
    if (!needsOnboarding) {
      router.replace('/(tabs)' as Href);
    }
  }, [needsOnboarding, router]);

  const onComplete = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding(trimmed);
      router.replace('/(tabs)' as Href);
    } catch (e: any) {
      const msg = e?.message || 'Could not save your name';
      setError(
        /reach|network|failed to fetch|API |Authentication|503|401/i.test(msg)
          ? `${msg}. Make sure the backend is running and EXPO_PUBLIC_BACKEND_URL is correct.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = name.trim().length > 0 && !busy;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, isLaptop && styles.scrollLaptop]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.form, isLaptop && styles.formLaptop]}>
            <View style={styles.center}>
              <Text style={styles.emoji} accessibilityLabel="Wave hello">
                👋
              </Text>

              <Text style={styles.welcomeLine}>Welcome to the</Text>
              <Text style={styles.accentLine}>future of finance</Text>

              <Text style={styles.question}>What's your name?</Text>

              <TextInput
                testID={ONBOARDING.nameInput}
                style={styles.input}
                value={name}
                onChangeText={(text) => {
                  setName(text.slice(0, NAME_MAX));
                  if (error) setError(null);
                }}
                placeholder="Enter your name"
                placeholderTextColor="#A3A3A3"
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={NAME_MAX}
                returnKeyType="done"
                onSubmitEditing={onComplete}
              />
              <Text style={styles.counter}>
                {name.length}/{NAME_MAX}
              </Text>

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>

            <Pressable
              testID={ONBOARDING.completeButton}
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={onComplete}
              disabled={!canSubmit}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.buttonRow}>
                  <Text style={styles.buttonText}>Complete</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: authTheme.colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 24,
  },
  scrollLaptop: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 40,
  },
  form: {
    flexGrow: 1,
    width: '100%',
    justifyContent: 'space-between',
  },
  formLaptop: {
    flexGrow: 0,
    width: '100%',
    maxWidth: FORM_MAX,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: 28,
  },
  center: {
    alignItems: 'center',
    paddingTop: 24,
    width: '100%',
  },
  emoji: {
    fontSize: 44,
    marginBottom: 18,
  },
  welcomeLine: {
    color: authTheme.colors.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 34,
  },
  accentLine: {
    color: authTheme.colors.primary,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: 28,
  },
  question: {
    color: authTheme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    width: '100%',
    maxWidth: FORM_MAX,
    borderWidth: 1,
    borderColor: authTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16,
    color: authTheme.colors.text,
    backgroundColor: '#FFFFFF',
  },
  counter: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: FORM_MAX,
    textAlign: 'right',
    color: '#A3A3A3',
    fontSize: 12,
    marginTop: 6,
  },
  error: {
    marginTop: 12,
    color: authTheme.colors.error,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: authTheme.colors.primary,
    borderRadius: 12,
    minHeight: 52,
    width: '100%',
    maxWidth: FORM_MAX,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
