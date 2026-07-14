import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import {
  User,
  UserCredential,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';

import { api } from '@/src/api';
import { auth } from '@/src/auth/firebase';
import { mapFirebaseAuthError } from '@/src/auth/validation';
import { setTokenGetter } from '@/src/auth/tokenBridge';

// Native Google Sign-In (dev builds only — not usable in Expo Go).
// expo-auth-session's Google provider is deprecated by Expo and rejected by
// Google's OAuth policy for standalone/dev-client apps, so we use the
// official native SDK instead. Web keeps using Firebase's popup flow.
if (Platform.OS !== 'web') {
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    offlineAccess: false,
  });
}

export type UserProfile = {
  uid: string;
  email?: string | null;
  display_name?: string | null;
  onboarding_completed: boolean;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  needsOnboarding: boolean;
  signInWithGoogle: () => Promise<void>;
  completeOnboarding: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function withAuthError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error));
  }
}

/** True when Firebase creation + last sign-in are nearly the same (first session). */
function isLikelyFirstSession(user: User): boolean {
  const created = user.metadata?.creationTime;
  const lastSignIn = user.metadata?.lastSignInTime;
  if (!created || !lastSignIn) return true;
  const createdMs = Date.parse(created);
  const lastMs = Date.parse(lastSignIn);
  if (Number.isNaN(createdMs) || Number.isNaN(lastMs)) return true;
  return Math.abs(lastMs - createdMs) < 5 * 60 * 1000;
}

function fallbackProfile(user: User, onboardingCompleted: boolean): UserProfile {
  return {
    uid: user.uid,
    email: user.email,
    display_name: user.displayName,
    onboarding_completed: onboardingCompleted,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Set from Google credential; survives a failed /me so new users still see welcome.
  const [googleIsNewUser, setGoogleIsNewUser] = useState(false);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  useEffect(() => {
    setTokenGetter(getIdToken);
  }, [getIdToken]);

  const refreshProfile = useCallback(async (nextUser: User | null, isNewUser = false) => {
    if (!nextUser) {
      setProfile(null);
      return;
    }
    try {
      let me = await api.getMe();
      // Firebase says this is a brand-new account — never skip the name screen,
      // even if an older buggy profile row marked onboarding complete.
      if (isNewUser) {
        setGoogleIsNewUser(true);
        if (me.onboarding_completed) {
          me = { ...me, onboarding_completed: false };
        }
      } else if (me.onboarding_completed) {
        setGoogleIsNewUser(false);
      }
      setProfile(me);
    } catch {
      // Backend unreachable (common with localhost on a physical device).
      // Still gate new / first-session users onto the welcome screen.
      const needsName = isNewUser || isLikelyFirstSession(nextUser);
      setProfile(fallbackProfile(nextUser, !needsName));
      if (needsName) setGoogleIsNewUser(true);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(true);
      void (async () => {
        await refreshProfile(nextUser);
        setLoading(false);
      })();
    });
    return unsub;
  }, [refreshProfile]);

  const applyCredential = useCallback(
    async (credential: UserCredential) => {
      const info = getAdditionalUserInfo(credential);
      const isNewUser = Boolean(info?.isNewUser);
      if (isNewUser) setGoogleIsNewUser(true);
      setUser(credential.user);
      setLoading(true);
      await refreshProfile(credential.user, isNewUser);
      setLoading(false);
    },
    [refreshProfile],
  );

  const signInWithGoogle = useCallback(async () => {
    await withAuthError(async () => {
      if (Platform.OS === 'web') {
        const credential = await signInWithPopup(auth, new GoogleAuthProvider());
        await applyCredential(credential);
        return;
      }
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        throw new Error('Google sign-in was cancelled');
      }
      const idToken = response.data.idToken;
      if (!idToken) {
        throw new Error('Google sign-in did not return an ID token');
      }
      const credential = await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(idToken),
      );
      await applyCredential(credential);
    });
  }, [applyCredential]);

  const completeOnboarding = useCallback(async (displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      throw new Error('Please enter your name');
    }
    try {
      const me = await api.completeOnboarding(trimmed.slice(0, 50));
      setProfile(me);
    } catch {
      // Persist locally if backend is down so the user can enter the app.
      if (!auth.currentUser) throw new Error('Could not save your name');
      setProfile(fallbackProfile(auth.currentUser, true));
      if (auth.currentUser.displayName !== trimmed) {
        // Keep the chosen name in local profile even if Firebase update isn't available.
        setProfile({
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
          display_name: trimmed.slice(0, 50),
          onboarding_completed: true,
        });
      }
    }
    setGoogleIsNewUser(false);
  }, []);

  const signOut = useCallback(async () => {
    await withAuthError(async () => {
      if (Platform.OS !== 'web') {
        try {
          await GoogleSignin.signOut();
        } catch {
          // Ignore native sign-out failures; Firebase sign-out is authoritative.
        }
      }
      await firebaseSignOut(auth);
      setUser(null);
      setProfile(null);
      setGoogleIsNewUser(false);
      setLoading(false);
    });
  }, []);

  const needsOnboarding = Boolean(
    user &&
      (googleIsNewUser ||
        (profile != null && !profile.onboarding_completed) ||
        (profile == null && isLikelyFirstSession(user))),
  );

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      needsOnboarding,
      signInWithGoogle,
      completeOnboarding,
      signOut,
      getIdToken,
    }),
    [
      user,
      profile,
      loading,
      needsOnboarding,
      signInWithGoogle,
      completeOnboarding,
      signOut,
      getIdToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return ctx;
}
