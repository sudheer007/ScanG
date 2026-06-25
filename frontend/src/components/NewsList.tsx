import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { NewsItem } from '@/src/api';
import { theme } from '@/src/theme';
import { relTime } from '@/src/utils/date';

const ACCENTS = ['#60A5FA', '#34D399', '#F59E0B', '#A78BFA', '#F472B6', '#22D3EE', '#FB7185'];
function accentFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return ACCENTS[h % ACCENTS.length];
}

export function NewsCard({ item, onTickerPress }: { item: NewsItem; onTickerPress?: (t: string) => void }) {
  const accent = accentFor(item.publisher || 'news');
  const open = () => {
    if (item.link) WebBrowser.openBrowserAsync(item.link).catch(() => {});
  };
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={open} style={styles.card} testID={`news-${item.uuid}`}>
      <View style={styles.row}>
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={styles.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: accent + '22' }]}>
            <Text style={[styles.thumbInitial, { color: accent }]}>{(item.publisher || 'N')[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={3}>{item.title}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.publisher} numberOfLines={1}>{item.publisher}</Text>
            {item.published_epoch ? <Text style={styles.time}> · {relTime(item.published_epoch)}</Text> : null}
          </View>
        </View>
      </View>
      {item.related_tickers && item.related_tickers.length > 0 && (
        <View style={styles.tickerRow}>
          {item.related_tickers.slice(0, 5).map((t) => (
            <TouchableOpacity
              key={t}
              style={styles.ticker}
              onPress={() => onTickerPress?.(t)}
              disabled={!onTickerPress}
            >
              <Text style={styles.tickerText}>{t.replace('.NS', '')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function NewsList({
  news,
  onTickerPress,
  emptyLabel = 'No headlines right now.',
}: {
  news: NewsItem[];
  onTickerPress?: (t: string) => void;
  emptyLabel?: string;
}) {
  const router = useRouter();
  const handleTicker = onTickerPress ?? ((t: string) => router.push({ pathname: '/stock/[symbol]', params: { symbol: t } }));
  if (!news || news.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="newspaper-outline" size={26} color={theme.colors.textSubtle} />
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {news.map((n) => (
        <NewsCard key={n.uuid || n.link} item={n} onTickerPress={handleTicker} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: theme.spacing.lg, gap: 10 },
  card: {
    backgroundColor: theme.colors.bg2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  row: { flexDirection: 'row', gap: 12 },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: theme.colors.bg3 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbInitial: { fontSize: 28, fontWeight: '800' },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  publisher: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600', maxWidth: '55%' },
  time: { color: theme.colors.textSubtle, fontSize: 11 },
  tickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  ticker: { backgroundColor: theme.colors.bg3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tickerText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { color: theme.colors.textSubtle, fontSize: 13 },
});
