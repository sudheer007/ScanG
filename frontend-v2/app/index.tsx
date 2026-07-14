import { Redirect, type Href } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { useAuth } from '@/src/hooks/useAuth';
import { authTheme } from '@/src/auth/authTheme';

export default function Index() {
  const { user, loading, needsOnboarding } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={authTheme.colors.primary} />
      </View>
    );
  }

  if (user && needsOnboarding) {
    return <Redirect href={'/welcome' as Href} />;
  }

  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href={'/login' as Href} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.colors.bg,
  },
});
