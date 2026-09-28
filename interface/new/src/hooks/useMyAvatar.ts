import { useQuery } from '@tanstack/react-query';
import nestClient from '../api/nest-client';

export interface MyAvatar {
  /** The caller's own user id — needed to link to their profile page. */
  userId?: number;
  url?: string | null;
  /** Whether the caller may set another user's photo (admin / provider-edit). */
  canManageOthers?: boolean;
}

/**
 * The signed-in user's own photo.
 *
 * Avatars belong to users, and the SPA is never told its own user id at login,
 * so this asks the API who "me" is. Both the sidebar and the top bar use the
 * same query key, so React Query shares one request between them.
 */
export function useMyAvatar() {
  return useQuery({
    queryKey: ['avatar', 'me'],
    queryFn: async (): Promise<MyAvatar | null> => {
      try {
        const r = await nestClient.get('/avatars/me');
        return r.data;
      } catch {
        // No photo, or the request failed — callers fall back to an icon.
        return null;
      }
    },
  });
}
