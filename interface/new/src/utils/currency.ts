export type Currency = 'USD' | 'LRD';

const USER_CURRENCY_KEY = 'openrx_currency';

export function getUserCurrency(): Currency | null {
  const v = localStorage.getItem(USER_CURRENCY_KEY);
  return v === 'USD' || v === 'LRD' ? v : null;
}

export function setUserCurrency(c: Currency): void {
  localStorage.setItem(USER_CURRENCY_KEY, c);
}

export function clearUserCurrency(): void {
  localStorage.removeItem(USER_CURRENCY_KEY);
}

export function formatMoney(usd: number, currency: Currency, exchangeRate = 193): string {
  if (currency === 'LRD') {
    return `L$${Math.round((Number(usd) || 0) * exchangeRate).toLocaleString('en-US')}`;
  }
  return `$${(Number(usd) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
