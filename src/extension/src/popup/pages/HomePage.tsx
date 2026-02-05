import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  QrCode,
  Repeat,
  Settings,
  Copy,
  ExternalLink,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Plus,
} from 'lucide-react';
import { formatAddress } from '@shared/lib/wallet';
import { DEFAULT_EXTENSION_TOKENS } from '@shared/constants/tokens';
import { STORAGE_KEYS } from '@shared/storage/types';
import { useTokenPrices } from '@shared/hooks/useTokenPrices';
import { useBalance } from '@shared/hooks/useBalance';
import { formatPrice } from '@shared/lib/priceTracker';
import { TokenList } from '../../components/TokenList';
import { AddTokenDialog } from '../components/AddTokenDialog';
import { Token } from '@shared/types';

function HomePage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [customTokens, setCustomTokens] = useState<Token[]>([]);
  const [showAddToken, setShowAddToken] = useState(false);

  // Combine default tokens + custom tokens
  const allTokens = useMemo(
    () => [...DEFAULT_EXTENSION_TOKENS, ...customTokens],
    [customTokens],
  );
  const tokenSymbols = useMemo(() => allTokens.map((t) => t.symbol), [allTokens]);

  // Fetch prices using shared hook - DISABLE autoRefresh to prevent flickering
  const { priceMap, loading: pricesLoading, refetch: refetchPrices } = useTokenPrices(
    tokenSymbols,
    { autoRefresh: false, refreshInterval: 60000 },
  );

  // Fetch balances using shared hook
  const { balances, totalUsd, loading: balancesLoading, refresh: refreshBalances } = useBalance(
    address,
    allTokens,
    priceMap,
    { autoRefresh: false },
  );

  const loading = pricesLoading || balancesLoading;

  // Calculate portfolio 24h change
  const portfolioChange = balances.reduce((acc, b) => {
    const priceData = priceMap[b.symbol];
    if (priceData && b.balanceUsd) {
      const change24h = priceData.priceChange24h || 0;
      return acc + (b.balanceUsd * change24h / 100);
    }
    return acc;
  }, 0);

  const portfolioChangePercent =
    totalUsd > 0 ? (portfolioChange / (totalUsd - portfolioChange)) * 100 : 0;

  // Load wallet address and custom tokens on mount
  useEffect(() => {
    loadWalletAddress();
    loadCustomTokens();
  }, []);

  const loadWalletAddress = async () => {
    try {
      const walletData = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_WALLET);
      const activeAddress = walletData[STORAGE_KEYS.ACTIVE_WALLET];
      if (activeAddress) {
        setAddress(activeAddress);
      }
    } catch (error) {
      console.error('Error loading wallet:', error);
    }
  };

  const loadCustomTokens = async () => {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEYS.CUSTOM_TOKENS);
      if (data[STORAGE_KEYS.CUSTOM_TOKENS]) {
        const tokens = JSON.parse(data[STORAGE_KEYS.CUSTOM_TOKENS]);
        setCustomTokens(tokens);
      }
    } catch (error) {
      console.error('Error loading custom tokens:', error);
    }
  };

  const saveCustomTokens = async (tokens: Token[]) => {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.CUSTOM_TOKENS]: JSON.stringify(tokens),
      });
    } catch (error) {
      console.error('Error saving custom tokens:', error);
    }
  };

  const handleAddToken = useCallback(
    (token: Token) => {
      const newTokens = [...customTokens, token];
      setCustomTokens(newTokens);
      saveCustomTokens(newTokens);
    },
    [customTokens],
  );

  const handleRefresh = async () => {
    await Promise.all([refetchPrices(), refreshBalances()]);
  };

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openExplorer = () => {
    chrome.tabs.create({
      url: `https://bscscan.com/address/${address}`,
    });
  };

  const handleSwapComingSoon = () => {
    window.alert('Swap sắp ra mắt');
  };

  const getAssetUrl = (path: string) => {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      return path;
    }
  };

  // Convert balances to TokenList format with price changes
  const tokenListData = balances.map((b) => {
    const priceData = priceMap[b.symbol];
    return {
      symbol: b.symbol,
      name: b.name,
      balance: b.balance,
      logo: b.logo,
      balanceUsd: b.balanceUsd,
      address: b.address,
      priceChange: priceData?.priceChange24h || 0,
    };
  });

  if (loading && !address) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src={getAssetUrl('/icons/logo.gif')}
            alt="FUN Wallet"
            className="w-8 h-8"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="font-semibold">FUN Wallet</span>
          {/* Network Badge */}
          <span className="network-badge text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
            <img
              src={getAssetUrl('/tokens/bnb.svg')}
              alt="BNB"
              className="w-3 h-3"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            BSC
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <div className="p-4">
        <div className="animated-gradient rounded-2xl p-4 relative overflow-hidden">
          {/* Shimmer effect overlay */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent shimmer-effect" />

          {/* Address */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground font-mono">{formatAddress(address, 8)}</span>
            <button onClick={copyAddress} className="p-1 hover:bg-white/10 rounded transition-colors">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={openExplorer} className="p-1 hover:bg-white/10 rounded transition-colors">
              <ExternalLink className="w-4 h-4" />
            </button>
            {copied && <span className="text-xs text-primary animate-fade-in">Đã copy!</span>}
          </div>

          {/* Total Balance */}
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">Tổng số dư</p>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">{formatPrice(totalUsd)}</p>
              {/* 24h Change */}
              {!loading && (
                <span
                  className={`text-sm font-medium flex items-center gap-0.5 ${
                    portfolioChangePercent >= 0 ? 'price-up' : 'price-down'
                  }`}
                >
                  {portfolioChangePercent >= 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {portfolioChangePercent >= 0 ? '+' : ''}
                  {portfolioChangePercent.toFixed(2)}%
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => navigate('/send')}
              className="flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium btn-hover-scale"
            >
              <Send className="w-4 h-4" />
              Gửi
            </button>
            <button
              onClick={() => navigate('/receive')}
              className="flex items-center justify-center gap-2 py-2.5 bg-card border border-border rounded-xl font-medium btn-hover-scale"
            >
              <QrCode className="w-4 h-4" />
              Nhận
            </button>
            <button
              onClick={handleSwapComingSoon}
              className="flex items-center justify-center gap-2 py-2.5 bg-card border border-border rounded-xl font-medium btn-hover-scale"
            >
              <Repeat className="w-4 h-4" />
              Swap
            </button>
          </div>
        </div>
      </div>

      {/* Token List */}
      <div className="flex-1 overflow-y-auto p-4 pt-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Tokens</h3>
          <button
            onClick={() => setShowAddToken(true)}
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            <Plus className="w-3 h-3" />
            Thêm token
          </button>
        </div>
        <TokenList tokens={tokenListData} loading={loading && balances.length === 0} />
      </div>

      {/* Add Token Dialog */}
      <AddTokenDialog
        open={showAddToken}
        onClose={() => setShowAddToken(false)}
        onAddToken={handleAddToken}
        existingTokens={allTokens}
      />
    </div>
  );
}

export default HomePage;


