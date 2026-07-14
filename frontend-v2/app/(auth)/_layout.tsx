import { Redirect, Stack, usePathname, type Href } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { useAuth } from '@/src/hooks/useAuth';
import { authTheme } from '@/src/auth/authTheme';

export default function AuthLayout() {
  const { user, loading, needsOnboarding } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={authTheme.colors.primary} />
      </View>
    );
  }

  if (user && needsOnboarding) {
    const onWelcome = pathname?.includes('welcome');
    if (!onWelcome) {
      return <Redirect href={'/welcome' as Href} />;
    }
  } else if (user) {
    return <Redirect href={'/(tabs)' as Href} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.colors.bg,
  },
});
