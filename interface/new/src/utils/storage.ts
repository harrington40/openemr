import type { AuthState } from '../types/auth';

const AUTH_STORAGE_KEY = 'openemr_auth';

export function getStoredAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function storeAuth(auth: AuthState): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function isTokenExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}
