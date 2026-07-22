import { api, Market } from '@/src/api';
import { watchlist, WatchItem } from '@/src/storage-keys';

function mapServerItem(item: { symbol: string; market: string }): WatchItem {
  return {
    symbol: item.symbol,
    market: item.market as Market,
  };
}

function mergeBySymbol(serverItems: WatchItem[], localItems: WatchItem[]): WatchItem[] {
  const bySymbol = new Map<string, WatchItem>();
  for (const item of serverItems) bySymbol.set(item.symbol, item);
  for (const item of localItems) {
    if (!bySymbol.has(item.symbol)) bySymbol.set(item.symbol, item);
  }
  return Array.from(bySymbol.values());
}

async function pushMissingToServer(
  localItems: WatchItem[],
  serverSymbols: Set<string>,
): Promise<void> {
  const missing = localItems.filter((item) => !serverSymbols.has(item.symbol));
  if (missing.length === 0) return;
  await Promise.all(
    missing.map((item) =>
      api.addWatchlist({ symbol: item.symbol, market: item.market }).catch((err) => {
        console.warn('[watchlist] failed to sync symbol to server', item.symbol, err);
      }),
    ),
  );
}

export async function listWatchlist(userId?: string | null): Promise<WatchItem[]> {
  if (userId) {
    try {
      const res = await api.listWatchlist(userId);
      const serverItems = (res.items || []).map(mapServerItem);
      const localItems = await watchlist.list();
      const serverSymbols = new Set(serverItems.map((i) => i.symbol));

      // Empty server + local stocks used to wipe local via replaceAll([]).
      // Push local → Mongo first, then keep the merged list.
      if (serverItems.length === 0 && localItems.length > 0) {
        await pushMissingToServer(localItems, serverSymbols);
        return localItems;
      }

      const merged = mergeBySymbol(serverItems, localItems);
      await pushMissingToServer(localItems, serverSymbols);
      await watchlist.replaceAll(merged);
      return merged;
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
    } catch (err) {
      console.warn('[watchlist] POST /api/watchlist failed — kept local only', item.symbol, err);
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
    } catch (err) {
      console.warn('[watchlist] DELETE /api/watchlist failed — kept local removal', symbol, err);
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
      const serverHas = (res.items || []).some((x) => x.symbol === symbol);
      if (serverHas) return true;
      // Local-only stock pending sync should still count as watched.
      return watchlist.has(symbol);
    } catch {
      return watchlist.has(symbol);
    }
  }
  return watchlist.has(symbol);
}
