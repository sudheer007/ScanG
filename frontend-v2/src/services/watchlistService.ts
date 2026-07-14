import { api, Market } from '@/src/api';
import { watchlist, WatchItem } from '@/src/storage-keys';

function mapServerItem(item: { symbol: string; market: string }): WatchItem {
  return {
    symbol: item.symbol,
    market: item.market as Market,
  };
}

export async function listWatchlist(userId?: string | null): Promise<WatchItem[]> {
  if (userId) {
    try {
      const res = await api.listWatchlist(userId);
      const items = (res.items || []).map(mapServerItem);
      await watchlist.replaceAll(items);
      return items;
    } catch {
      return watchlist.list();
    }
  }
  return watchlist.list();
}

export async function addWatchlistItem(
  item: WatchItem,
  userId?: string | null,
): Promise<void> {
  await watchlist.add(item);
  if (userId) {
    try {
      await api.addWatchlist({ symbol: item.symbol, market: item.market });
    } catch {
      /* local cache remains */
    }
  }
}

export async function removeWatchlistItem(
  symbol: string,
  userId?: string | null,
): Promise<void> {
  await watchlist.remove(symbol);
  if (userId) {
    try {
      await api.removeWatchlist(userId, symbol);
    } catch {
      /* local cache remains */
    }
  }
}

export async function hasWatchlistItem(
  symbol: string,
  userId?: string | null,
): Promise<boolean> {
  if (userId) {
    try {
      const res = await api.listWatchlist(userId);
      return (res.items || []).some((x) => x.symbol === symbol);
    } catch {
      return watchlist.has(symbol);
    }
  }
  return watchlist.has(symbol);
}
