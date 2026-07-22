import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type SubscriptionEntitlement,
} from '@/src/api';
import { useAuth } from '@/src/hooks/useAuth';

const EMPTY: SubscriptionEntitlement = {
  is_premium: false,
  plan_id: null,
  status: null,
  current_period_end: null,
  subscription_id: null,
  cancel_at_cycle_end: false,
};

/**
 * Premium entitlement for the signed-in user.
 * Source of truth is the backend (webhook-activated subscription).
 */
export function useEntitlement() {
  const { user } = useAuth();
  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.uid) {
      setEntitlement(EMPTY);
      setError(null);
      return EMPTY;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMySubscription();
      setEntitlement(data);
      return data;
    } catch (e: any) {
      setError(e?.message || 'Unable to load subscription');
      return EMPTY;
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    entitlement,
    isPremium: !!entitlement.is_premium,
    loading,
    error,
    refresh,
  };
}
