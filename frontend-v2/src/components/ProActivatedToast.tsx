import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/src/theme';

const AUTO_DISMISS_MS = 4000;

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

/** Floating confirmation shown once per app/session after premium activates. */
export default function ProActivatedToast({ visible, onDismiss }: Props) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="pro-activated-toast">
      <View style={styles.toast}>
        <View style={styles.check}>
          <Ionicons name="checkmark" size={14} color="#fff" />
        </View>
        <Text style={styles.label}>Pro activated</Text>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Dismiss"
          testID="pro-activated-toast-dismiss"
        >
          <Ionicons name="close" size={16} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? 96 : 80,
    alignItems: 'center',
    zIndex: 50,
    elevation: 50,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: '#2C2C30',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.borderStrong,
    maxWidth: 280,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
