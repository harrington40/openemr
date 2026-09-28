import { useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../api/nest-client';

export interface NotificationSummary {
  messages: number;
  referrals: number;
  drugInfo: number;
  pharmacy: number;
  patientFlow: number;
  generatedAt?: string;
}

const EMPTY: NotificationSummary = {
  messages: 0,
  referrals: 0,
  drugInfo: 0,
  pharmacy: 0,
  patientFlow: 0,
};

/**
 * Sidebar badge counts, refreshed in the background so a new referral or lab
 * notice shows up without a page reload.
 */
export function useNotificationSummary(): NotificationSummary {
  const { data } = useQuery<NotificationSummary>({
    queryKey: ['notification-summary'],
    queryFn: async () => {
      const r = await nestClient.get('/notifications/summary');
      return r.data;
    },
    refetchInterval: 20000,
    staleTime: 10000,
  });
  return { ...EMPTY, ...(data || {}) };
}

/** Refresh every notification surface after an action (ack, referral, lookup). */
export function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['notification-summary'] });
    qc.invalidateQueries({ queryKey: ['referral-notifications'] });
    qc.invalidateQueries({ queryKey: ['drug-info-notifications'] });
  };
}
