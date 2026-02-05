/**
 * useBalance Hook - Shared between PWA and Chrome Extension
 * Fetches token balances from blockchain with caching
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getNativeBalance, getTokenBalance } from '../lib/wallet';
import { Token } from '../types';

interface PriceData {
  price: number;
  priceChange24h?: number;
}

export interface TokenBalance extends Token {
  balance: string;
  balanceUsd?: number;
}

interface UseBalanceOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  enabled?: boolean;
}

interface UseBalanceResult {
  balances: TokenBalance[];
  totalUsd: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function areBalancesEqual(prev: TokenBalance[], next: TokenBalance[]): boolean {
  if (prev.length !== next.length) return false;

  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.symbol !== b.symbol) return false;
    if (a.address !== b.address) return false;
    if (a.balance !== b.balance) return false;
    if ((a.balanceUsd || 0) !== (b.balanceUsd || 0)) return false;
  }

  return true;
}

export const useBalance = (
  address: string | null | undefined,
  tokens: Token[],
  priceMap: Record<string, number | PriceData> = {},
  options: UseBalanceOptions = {}
): UseBalanceResult => {
  const { 
    autoRefresh = false, 
    refreshInterval = 30000,
    enabled = true 
  } = options;

  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const initialLoadDone = useRef(false);
  const tokensRef = useRef(tokens);
  const priceMapRef = useRef(priceMap);

  // Serialize priceMap to avoid infinite loops
  const priceMapKey = useMemo(() => {
    return Object.entries(priceMap)
      .map(([k, v]) => {
        const price = typeof v === 'number' ? v : v.price;
        return `${k}:${price}`;
      })
      .join(',');
  }, [priceMap]);

  const tokensKey = useMemo(() => {
    return tokens
      .map((t) => `${t.symbol}:${t.address ?? 'native'}:${t.decimals}`)
      .join('|');
  }, [tokens]);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokensKey]);

  useEffect(() => {
    priceMapRef.current = priceMap;
  }, [priceMapKey]);

  const fetchBalances = useCallback(async () => {
    const currentTokens = tokensRef.current;
    const currentPriceMap = priceMapRef.current;

    if (!address || !enabled || currentTokens.length === 0) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      // DO NOT setLoading(true) here - prevents flickering on refresh
      // Fetch balances in parallel while preserving token order
      const results: TokenBalance[] = await Promise.all(
        currentTokens.map(async (token) => {
          try {
            let balance = '0';
            
            if (token.address === null) {
              // Native token (BNB)
              balance = await getNativeBalance(address);
            } else {
              // ERC-20 token
              balance = await getTokenBalance(token.address, address);
            }

            const priceData = currentPriceMap[token.symbol.toUpperCase()];
            const priceUsd = typeof priceData === 'number' ? priceData : (priceData?.price || 0);
            const balanceUsd = parseFloat(balance) * priceUsd;

            return {
              ...token,
              balance,
              balanceUsd,
            };
          } catch (err) {
            console.error(`Error fetching balance for ${token.symbol}:`, err);
            return {
              ...token,
              balance: '0',
              balanceUsd: 0,
            };
          }
        }),
      );

      if (mountedRef.current) {
        setBalances((prev) => (areBalancesEqual(prev, results) ? prev : results));
        setLoading(false);
        initialLoadDone.current = true;
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch balances');
        setLoading(false);
      }
    }
  }, [address, tokensKey, priceMapKey, enabled]);

  // Initial fetch - only show loading on first load
  useEffect(() => {
    mountedRef.current = true;
    
    // Only show loading skeleton if we haven't loaded data yet
    if (!initialLoadDone.current) {
      setLoading(true);
    }
    
    fetchBalances();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchBalances]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && enabled && address) {
      intervalRef.current = setInterval(fetchBalances, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, refreshInterval, fetchBalances, enabled, address]);

  // Calculate total USD
  const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd || 0), 0);

  return {
    balances,
    totalUsd,
    loading,
    error,
    refresh: fetchBalances,
  };
};

export default useBalance;
