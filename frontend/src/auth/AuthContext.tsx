// Optional Google Sign-In session. The app works fully signed-out — this
// context just tracks whether a user has chosen to sign in, and carries the
// session token to api.ts so subsequent requests are authenticated.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { api, AuthUser, setAuthToken } from '@/src/api';
import { storage } from '@/src/utils/storage';

const TOKEN_KEY = 'radar.auth.token';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signInWithGoogleIdToken: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(TOKEN_KEY, '');
      if (token) {
        setAuthToken(token);
        try {
          const res = await api.authMe();
          setUser(res.user);
        } catch {
          // Expired/invalid session — drop it silently, app continues signed-out.
          setAuthToken(null);
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const signInWithGoogleIdToken = useCallback(async (idToken: string) => {
    const res = await api.authGoogle(idToken);
    setAuthToken(res.token);
    await storage.secureSet(TOKEN_KEY, res.token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogleIdToken, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
