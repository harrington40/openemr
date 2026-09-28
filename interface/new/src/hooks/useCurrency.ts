import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import nestClient from '../api/nest-client';
import { getUserCurrency, setUserCurrency, clearUserCurrency, type Currency } from '../utils/currency';

export const CURRENCY_CHANGE_EVENT = 'openrx-currency-change';

/**
 * Resolve the effective billing currency:
 * - Individual user preference (localStorage) overrides the system-wide setting.
 * - Otherwise the admin-configured system-wide currency is used.
 */
export function useCurrency() {
  const [local, setLocal] = useState<Currency | null>(getUserCurrency());

  useEffect(() => {
    const handler = () => setLocal(getUserCurrency());
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  const { data: system } = useQuery({
    queryKey: ['billing-settings'],
    queryFn: async () => { const r = await nestClient.get('/billing/settings'); return r.data; },
  });

  const currency: Currency = local || system?.currency || 'USD';
  const exchangeRate = system?.exchangeRate || 193;

  const setCurrency = (c: Currency | null) => {
    if (c) setUserCurrency(c);
    else clearUserCurrency();
    window.dispatchEvent(new Event(CURRENCY_CHANGE_EVENT));
  };

  return {
    currency,
    exchangeRate,
    systemCurrency: system?.currency as Currency | undefined,
    localOverride: !!local,
    setCurrency,
  };
}
