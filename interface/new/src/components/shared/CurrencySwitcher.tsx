import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { useCurrency, CURRENCY_CHANGE_EVENT } from '../../hooks/useCurrency';

export default function CurrencySwitcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { currency, systemCurrency, localOverride, setCurrency } = useCurrency();
  const isAdmin = user?.role === 'admin';

  const [systemChoice, setSystemChoice] = useState<string>(systemCurrency || 'LRD');

  const saveSystem = useMutation({
    mutationFn: (c: string) => nestClient.put('/billing/settings', { currency: c }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      window.dispatchEvent(new Event(CURRENCY_CHANGE_EVENT));
    },
  });

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      {isAdmin ? (
        <div className="d-flex align-items-center gap-1">
          <span className="small text-muted text-nowrap">System currency:</span>
          <select
            className="form-select form-select-sm"
            style={{ width: '110px' }}
            value={systemChoice}
            onChange={(e) => { setSystemChoice(e.target.value); saveSystem.mutate(e.target.value); }}
          >
            <option value="USD">USD ($)</option>
            <option value="LRD">LRD (L$)</option>
          </select>
        </div>
      ) : (
        <span className="small text-muted">System: {systemCurrency || 'USD'}</span>
      )}

      <div className="d-flex align-items-center gap-1">
        <span className="small text-muted text-nowrap">My view:</span>
        <select
          className="form-select form-select-sm"
          style={{ width: '120px' }}
          value={localOverride ? currency : 'system'}
          onChange={(e) => setCurrency(e.target.value === 'system' ? null : (e.target.value as 'USD' | 'LRD'))}
        >
          <option value="system">System ({systemCurrency || 'USD'})</option>
          <option value="USD">USD ($)</option>
          <option value="LRD">LRD (L$)</option>
        </select>
      </div>
    </div>
  );
}
