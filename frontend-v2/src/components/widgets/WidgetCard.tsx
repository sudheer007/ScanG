import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: string; // border/icon tint
  rightBadge?: { label: string; tone?: 'pos' | 'neg' | 'neutral' };
  children: React.ReactNode;
  testID?: string;
}

export default function WidgetCard({ id, title, subtitle, icon, accent, rightBadge, children, testID }: Props) {
  const router = useRouter();
  return (
    <TouchableOpacity
      testID={testID || `widget-card-${id}`}
      activeOpacity={0.85}
      onPress={() => router.push({ pathname: '/discover/[id]', params: { id } })}
      style={[styles.card, accent ? { borderColor: accent + '55' } : null]}
    >
      <View style={styles.header}>
        <View style={[styles.iconWrap, accent ? { backgroundColor: accent + '22' } : null]}>
          <Ionicons name={icon} size={18} color={accent || theme.colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {rightBadge ? (
          <View style={[
            styles.badge,
            rightBadge.tone === 'pos' && { backgroundColor: 'rgba(16,185,129,0.18)' },
            rightBadge.tone === 'neg' && { backgroundColor: 'rgba(239,68,68,0.18)' },
          ]}>
            <Text style={[
              styles.badgeText,
              rightBadge.tone === 'pos' && { color: theme.colors.success },
              rightBadge.tone === 'neg' && { color: theme.colors.error },
            ]}>{rightBadge.label}</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textSubtle} />
        )}
      </View>
      <View style={styles.body}>{children}</View>
      <View style={styles.footer}>
        <Text style={styles.tapHint}>Tap to explore →</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    gap: 10,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: theme.colors.bg3,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.bg3,
  },
  badgeText: { color: theme.colors.text, fontSize: 11, fontWeight: '700' },
  body: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  footer: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    backgroundColor: theme.colors.bg,
  },
  tapHint: { color: theme.colors.textSubtle, fontSize: 11, fontWeight: '600' },
});
