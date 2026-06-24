import { storage } from '@/src/utils/storage';

const WATCHLIST_KEY = 'radar.watchlist.v1';
const SAVED_SCREENS_KEY = 'radar.screens.v1';
const MARKET_KEY = 'radar.market.v1';

export type WatchItem = { symbol: string; market: 'US' | 'IN'; name?: string };

export const watchlist = {
  async list(): Promise<WatchItem[]> {
    const raw = await storage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as WatchItem[]; } catch { return []; }
  },
  async add(item: WatchItem) {
    const list = await this.list();
    if (!list.find((x) => x.symbol === item.symbol)) {
      list.push(item);
      await storage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    }
    return list;
  },
  async remove(symbol: string) {
    const list = (await this.list()).filter((x) => x.symbol !== symbol);
    await storage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    return list;
  },
  async has(symbol: string) {
    return (await this.list()).some((x) => x.symbol === symbol);
  },
};

export type SavedScreen = {
  id: string;
  name: string;
  market: 'US' | 'IN';
  filters: Record<string, any>;
  createdAt: number;
};

export const savedScreens = {
  async list(): Promise<SavedScreen[]> {
    const raw = await storage.getItem(SAVED_SCREENS_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  },
  async save(s: SavedScreen) {
    const list = await this.list();
    list.unshift(s);
    await storage.setItem(SAVED_SCREENS_KEY, JSON.stringify(list));
  },
  async remove(id: string) {
    const list = (await this.list()).filter((x) => x.id !== id);
    await storage.setItem(SAVED_SCREENS_KEY, JSON.stringify(list));
  },
};

export const marketPref = {
  async get(): Promise<'US' | 'IN'> {
    const v = await storage.getItem(MARKET_KEY);
    return (v as 'US' | 'IN') || 'US';
  },
  async set(m: 'US' | 'IN') {
    await storage.setItem(MARKET_KEY, m);
  },
};
