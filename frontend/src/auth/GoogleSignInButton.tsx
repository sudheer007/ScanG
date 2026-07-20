// Native (iOS/Android) fallback. Google Sign-In here is currently web-only —
// the live app is the Cloudflare Pages web build, so that's where it's wired
// up. Native OAuth (its own client IDs + redirect config) can follow later
// without touching this call site.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/src/theme';

export default function GoogleSignInButton() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>Sign-in is available on the web app for now.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  text: { color: theme.colors.textSubtle, fontSize: 12, textAlign: 'center' },
});
