/**
 * useTokenPrices Hook - Shared between PWA and Chrome Extension
 * Fetches and caches token prices with auto-refresh
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TokenPrice, fetchTokenPrices } from '../lib/priceTracker';

interface UseTokenPricesOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  enabled?: boolean;
}

interface PriceData {
  price: number;
  priceChange24h: number;
}

interface UseTokenPricesResult {
  prices: TokenPrice[];
  priceMap: Record<string, PriceData>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  lastUpdated: number | null;
}

function arePricesEqual(prev: TokenPrice[], next: TokenPrice[]): boolean {
  if (prev.length !== next.length) return false;

  const prevMap = new Map(prev.map((p) => [p.symbol.toUpperCase(), p]));
  for (const item of next) {
    const key = item.symbol.toUpperCase();
    const prevItem = prevMap.get(key);
    if (!prevItem) return false;
    if (prevItem.price !== item.price) return false;
    if ((prevItem.change24h || 0) !== (item.change24h || 0)) return false;
  }

  return true;
}

export const useTokenPrices = (
  symbols: string[],
  options: UseTokenPricesOptions = {}
): UseTokenPricesResult => {
  const { 
    autoRefresh = true, 
    refreshInterval = 30000,
    enabled = true 
  } = options;

  const [prices, setPrices] = useState<TokenPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const symbolsKey = useMemo(
    () =>
      symbols
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join('|'),
    [symbols],
  );

  const fetchPrices = useCallback(async () => {
    const normalizedSymbols = symbolsKey ? symbolsKey.split('|') : [];

    if (!enabled || normalizedSymbols.length === 0) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const result = await fetchTokenPrices(normalizedSymbols);
      
      if (mountedRef.current) {
        let changed = false;
        setPrices((prev) => {
          changed = !arePricesEqual(prev, result);
          return changed ? result : prev;
        });
        if (changed) {
          setLastUpdated(Date.now());
        }
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch prices');
        setLoading(false);
      }
    }
  }, [symbolsKey, enabled]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchPrices();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchPrices]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && enabled) {
      intervalRef.current = setInterval(fetchPrices, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, refreshInterval, fetchPrices, enabled]);

  // Create a stable map for quick price lookups using useMemo
  const priceMap = useMemo(() => {
    return prices.reduce<Record<string, PriceData>>((acc, p) => {
      acc[p.symbol.toUpperCase()] = {
        price: p.price,
        priceChange24h: p.change24h || 0,
      };
      return acc;
    }, {});
  }, [prices]);

  return {
    prices,
    priceMap,
    loading,
    error,
    refetch: fetchPrices,
    lastUpdated,
  };
};

export default useTokenPrices;
