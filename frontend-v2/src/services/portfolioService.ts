import { api, Market } from '@/src/api';
import { portfolio, PortfolioItem } from '@/src/storage-keys';

function mapServerItem(item: {
  symbol: string;
  market: string;
  quantity: number;
  avg_price: number;
}): PortfolioItem {
  return {
    symbol: item.symbol,
    market: item.market as Market,
    quantity: Number(item.quantity) || 0,
    avg_price: Number(item.avg_price) || 0,
  };
}

function mergeBySymbol(serverItems: PortfolioItem[], localItems: PortfolioItem[]): PortfolioItem[] {
  const bySymbol = new Map<string, PortfolioItem>();
  for (const item of localItems) bySymbol.set(item.symbol, item);
  // Server wins on conflict (authoritative after import)
  for (const item of serverItems) bySymbol.set(item.symbol, item);
  return Array.from(bySymbol.values());
}

export async function listPortfolio(userId?: string | null): Promise<PortfolioItem[]> {
  if (userId) {
    try {
      const res = await api.listPortfolio(userId);
      const serverItems = (res.items || []).map(mapServerItem);
      const localItems = await portfolio.list();

      if (serverItems.length === 0 && localItems.length > 0) {
        await Promise.all(
          localItems.map((item) =>
            api
              .upsertPortfolioHolding({
                symbol: item.symbol,
                market: item.market,
                quantity: item.quantity,
                avg_price: item.avg_price,
              })
              .catch((err) => {
                console.warn('[portfolio] failed to sync holding', item.symbol, err);
              }),
          ),
        );
        return localItems;
      }

      const merged = mergeBySymbol(serverItems, localItems);
      await portfolio.replaceAll(merged);
      return merged;
    } catch {
      return portfolio.list();
    }
  }
  return portfolio.list();
}

export async function removePortfolioItem(
  symbol: string,
  userId?: string | null,
): Promise<void> {
  await portfolio.remove(symbol);
  if (userId) {
    try {
      await api.removePortfolioHolding(userId, symbol);
    } catch (err) {
      console.warn('[portfolio] DELETE failed — kept local removal', symbol, err);
    }
  }
}

export async function upsertPortfolioItem(
  item: PortfolioItem,
  userId?: string | null,
): Promise<void> {
  await portfolio.upsert(item);
  if (userId) {
    try {
      await api.upsertPortfolioHolding({
        symbol: item.symbol,
        market: item.market,
        quantity: item.quantity,
        avg_price: item.avg_price,
      });
    } catch (err) {
      console.warn('[portfolio] upsert failed — kept local only', item.symbol, err);
    }
  }
}
