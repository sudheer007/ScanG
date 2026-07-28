import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type SubscriptionEntitlement,
} from '@/src/api';
import { useAuth } from '@/src/hooks/useAuth';
import { storage } from '@/src/utils/storage';

const EMPTY: SubscriptionEntitlement = {
  is_premium: false,
  plan_id: null,
  status: null,
  current_period_end: null,
  subscription_id: null,
  cancel_at_cycle_end: false,
};

/** In-memory cache so remounts don't flash Basic → Premium. */
const memoryCache = new Map<string, SubscriptionEntitlement>();

function cacheKey(uid: string) {
  return `radar.entitlement.v1.${uid}`;
}

async function readDisk(uid: string): Promise<SubscriptionEntitlement | null> {
  const raw = await storage.getItem(cacheKey(uid), null);
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as SubscriptionEntitlement;
    if (typeof parsed?.is_premium !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDisk(uid: string, data: SubscriptionEntitlement): Promise<void> {
  // Store as a JSON string value (storage already JSON.stringifies the outer value).
  await storage.setItem(cacheKey(uid), JSON.stringify(data));
}

function applyCache(uid: string, data: SubscriptionEntitlement) {
  memoryCache.set(uid, data);
  void writeDisk(uid, data);
}

/**
 * Premium entitlement for the signed-in user.
 * Source of truth is the backend (webhook-activated subscription).
 * Last-known status is cached in memory + disk to avoid Basic→Premium flash.
 */
export function useEntitlement() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement>(() =>
    (uid && memoryCache.get(uid)) || EMPTY,
  );
  const [loading, setLoading] = useState(() => !(uid && memoryCache.has(uid)));
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(() => !!(uid && memoryCache.has(uid)));

  const refresh = useCallback(async () => {
    if (!uid) {
      setEntitlement(EMPTY);
      setError(null);
      setLoading(false);
      setHydrated(true);
      return EMPTY;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMySubscription();
      setEntitlement(data);
      applyCache(uid, data);
      return data;
    } catch (e: any) {
      setError(e?.message || 'Unable to load subscription');
      // Keep last known entitlement on network failure (don't force Basic).
      return memoryCache.get(uid) || EMPTY;
    } finally {
      setLoading(false);
      setHydrated(true);
    }
  }, [uid]);

  useEffect(() => {
    let cancelled = false;

    if (!uid) {
      setEntitlement(EMPTY);
      setLoading(false);
      setHydrated(true);
      return;
    }

    const cached = memoryCache.get(uid);
    if (cached) {
      setEntitlement(cached);
      setHydrated(true);
      void refresh();
      return;
    }

    (async () => {
      const disk = await readDisk(uid);
      if (cancelled) return;
      if (disk) {
        memoryCache.set(uid, disk);
        setEntitlement(disk);
        setHydrated(true);
      }
      await refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, refresh]);

  return {
    entitlement,
    isPremium: !!entitlement.is_premium,
    /** True once we have cache or a network response — use to avoid flashing Basic. */
    hydrated,
    loading,
    error,
    refresh,
  };
}
