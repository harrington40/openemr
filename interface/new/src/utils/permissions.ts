/** Roles that are allowed to see patient financial/billing information. */
const FINANCIAL_ROLES = new Set(['admin', 'billing']);

export interface UserLike {
  role?: string;
  main_menu_role?: string;
}

/** True when the current user is allowed to view patient financial data. */
export function canViewFinancials(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  return FINANCIAL_ROLES.has(user.role || '') || FINANCIAL_ROLES.has(user.main_menu_role || '');
}

/** Mask a financial value for users without billing access. */
export function maskFinancial(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return 'xxxx';
}
