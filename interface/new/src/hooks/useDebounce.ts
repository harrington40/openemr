import { useState, useEffect } from 'react';

/**
 * Debounce a value by the specified delay in milliseconds.
 * Returns the debounced value, which updates only after the
 * specified delay since the last change.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
