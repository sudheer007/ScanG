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
  async replaceAll(items: WatchItem[]) {
    await storage.setItem(WATCHLIST_KEY, JSON.stringify(items));
    return items;
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

const SCREENER_SECTOR_KEY = 'radar.screener.sector.v1';

export type ScreenerSectorNav = { sector: string; market: 'US' | 'IN' };

export const screenerSectorPref = {
  async get(): Promise<ScreenerSectorNav | null> {
    return storage.getItem(SCREENER_SECTOR_KEY, null);
  },
  async set(sector: string, market: 'US' | 'IN') {
    await storage.setItem(SCREENER_SECTOR_KEY, { sector, market });
  },
  async clear() {
    await storage.removeItem(SCREENER_SECTOR_KEY);
  },
};

const PORTFOLIO_KEY = 'radar.portfolio.v1';

export type PortfolioItem = {
  symbol: string;
  market: 'US' | 'IN';
  quantity: number;
  avg_price: number;
  name?: string;
};

export const portfolio = {
  async list(): Promise<PortfolioItem[]> {
    const raw = await storage.getItem(PORTFOLIO_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PortfolioItem[];
    } catch {
      return [];
    }
  },
  async replaceAll(items: PortfolioItem[]) {
    await storage.setItem(PORTFOLIO_KEY, JSON.stringify(items));
    return items;
  },
  async upsert(item: PortfolioItem) {
    const list = await this.list();
    const idx = list.findIndex((x) => x.symbol === item.symbol);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    await storage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
    return list;
  },
  async remove(symbol: string) {
    const list = (await this.list()).filter((x) => x.symbol !== symbol);
    await storage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
    return list;
  },
};
