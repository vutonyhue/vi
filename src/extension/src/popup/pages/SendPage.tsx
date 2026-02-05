/**
 * SendPage - Refactored with MetaMask-like Confirmation Flow
 * 
 * Flow: Form → Confirm → Success
 * Private key only decrypted after user confirms.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Loader2, Check, AlertCircle, Search } from 'lucide-react';
import { 
  isValidAddress, 
  formatBalance,
  getNativeBalance,
  getTokenBalance,
  formatAddress
} from '@shared/lib/wallet';
import { 
  prepareTx, 
  estimateTx, 
  signAndBroadcast,
  parseTransactionError 
} from '@shared/lib/txBuilder';
import { DEFAULT_EXTENSION_TOKENS } from '@shared/constants/tokens';
import { decryptPrivateKey } from '@shared/lib/encryption';
import { STORAGE_KEYS } from '@shared/storage/types';
import { formatPrice } from '@shared/lib/priceTracker';
import { useTokenPrices } from '@shared/hooks/useTokenPrices';
import { PreparedTransaction, GasEstimate, GasSettings } from '@shared/types';
import ConfirmTxScreen from '../components/ConfirmTxScreen';

interface TokenOption {
  symbol: string;
  name: string;
  address: string | null;
  decimals: number;
  logo: string;
  balance: string;
  balanceUsd?: number;
}

type SendStep = 'form' | 'confirm' | 'success';

interface SuccessSummary {
  amount: string;
  symbol: string;
  toAddress: string;
  amountUsd: number;
}

function SendPage() {
  const navigate = useNavigate();
  
  // Step management
  const [step, setStep] = useState<SendStep>('form');
  
  // Form state
  const [tokens, setTokens] = useState<TokenOption[]>([]);
  const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
  const [showTokenSelect, setShowTokenSelect] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [formError, setFormError] = useState('');
  const [inputError, setInputError] = useState(false);
  const [customTokens, setCustomTokens] = useState<typeof DEFAULT_EXTENSION_TOKENS>([]);
  
  // Confirm state
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [activeAddress, setActiveAddress] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  
  // Success state
  const [txHash, setTxHash] = useState('');
  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);

  // Combine default + custom tokens
  const allTokens = [...DEFAULT_EXTENSION_TOKENS, ...customTokens];
  const tokenSymbols = allTokens.map(t => t.symbol);
  
  // Fetch prices for USD conversion - disable autoRefresh
  const { priceMap } = useTokenPrices(tokenSymbols, { autoRefresh: false });

  useEffect(() => {
    loadCustomTokens();
  }, []);

  useEffect(() => {
    if (allTokens.length > 0) {
      loadTokenBalances();
    }
  }, [customTokens]);

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

  const loadTokenBalances = async () => {
    setLoadingBalances(true);
    try {
      const walletData = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_WALLET);
      const address = walletData[STORAGE_KEYS.ACTIVE_WALLET];
      
      if (!address) return;
      setActiveAddress(address);

      // Load tokens with balances
      const tokenBalances: TokenOption[] = [];

      for (const token of allTokens) {
        let balance = '0';
        try {
          if (token.address === null) {
            balance = await getNativeBalance(address);
          } else {
            balance = await getTokenBalance(token.address, address);
          }
        } catch {
          balance = '0';
        }
        
        const priceData = priceMap[token.symbol];
        const balanceNum = parseFloat(balance) || 0;
        const balanceUsd = priceData ? balanceNum * priceData.price : 0;

        tokenBalances.push({
          ...token,
          balance,
          balanceUsd,
        });
      }

      setTokens(tokenBalances);
      if (tokenBalances.length > 0) {
        const preservedSelection = selectedToken
          ? tokenBalances.find((token) => token.symbol === selectedToken.symbol)
          : null;
        setSelectedToken(preservedSelection || tokenBalances[0]);
      }
    } catch (err) {
      console.error('Error loading balances:', err);
    } finally {
      setLoadingBalances(false);
    }
  };

  // Recalculate USD values when prices update
  useEffect(() => {
    if (Object.keys(priceMap).length > 0 && tokens.length > 0) {
      const updatedTokens = tokens.map(token => {
        const priceData = priceMap[token.symbol];
        const balanceNum = parseFloat(token.balance) || 0;
        const balanceUsd = priceData ? balanceNum * priceData.price : 0;
        return { ...token, balanceUsd };
      });
      setTokens(updatedTokens);
      
      // Update selected token too
      if (selectedToken) {
        const updated = updatedTokens.find(t => t.symbol === selectedToken.symbol);
        if (updated) setSelectedToken(updated);
      }
    }
  }, [priceMap]);

  // Calculate USD value of amount being sent
  const amountUsd = (() => {
    if (!selectedToken || !amount) return 0;
    const priceData = priceMap[selectedToken.symbol];
    const amountNum = parseFloat(amount) || 0;
    return priceData ? amountNum * priceData.price : 0;
  })();

  const handleMaxAmount = () => {
    if (selectedToken) {
      // For native token, leave some for gas
      if (selectedToken.address === null) {
        const max = Math.max(0, parseFloat(selectedToken.balance) - 0.005);
        setAmount(max.toString());
      } else {
        setAmount(selectedToken.balance);
      }
    }
  };

  // Step 1: Validate and prepare transaction (no signing yet)
  const handlePrepare = async () => {
    setFormError('');
    setInputError(false);

    // Validate inputs
    if (!selectedToken) {
      setFormError('Vui lòng chọn token');
      return;
    }

    if (!isValidAddress(toAddress)) {
      setFormError('Địa chỉ ví không hợp lệ');
      setInputError(true);
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Số lượng không hợp lệ');
      setInputError(true);
      return;
    }

    if (amountNum > parseFloat(selectedToken.balance)) {
      setFormError('Số dư không đủ');
      setInputError(true);
      return;
    }

    setPreparing(true);

    try {
      // Prepare transaction
      const result = await prepareTx({
        from: activeAddress,
        to: toAddress,
        amount,
        tokenAddress: selectedToken.address,
        tokenDecimals: selectedToken.decimals,
        tokenSymbol: selectedToken.symbol,
        balance: selectedToken.balance,
      });

      if (!result.success) {
        setFormError(result.error);
        setPreparing(false);
        return;
      }

      setPreparedTx(result.data);

      // Estimate gas
      const estimate = await estimateTx(result.data, activeAddress);
      setGasEstimate(estimate);

      // Move to confirm step
      setStep('confirm');
    } catch (err) {
      setFormError(parseTransactionError(err));
    } finally {
      setPreparing(false);
    }
  };

  // Step 2: Sign and broadcast (only after user confirms)
  const handleConfirmAndSend = async (password: string, gasSettings: GasSettings) => {
    if (!preparedTx) return;
    
    setSending(true);
    setConfirmError('');

    try {
      // Get encrypted private key
      const encryptedData = await chrome.storage.local.get(STORAGE_KEYS.ENCRYPTED_KEYS);

      if (!encryptedData[STORAGE_KEYS.ENCRYPTED_KEYS] || !activeAddress) {
        throw new Error('Không tìm thấy ví');
      }

      const parsed = JSON.parse(encryptedData[STORAGE_KEYS.ENCRYPTED_KEYS]);
      const keyData = parsed.wallets[activeAddress];
      
      if (!keyData) {
        throw new Error('Không tìm thấy private key');
      }

      // Decrypt private key (only now, after user confirmed)
      const privateKey = await decryptPrivateKey(keyData, password);

      // Sign and broadcast
      const result = await signAndBroadcast(preparedTx, gasSettings, privateKey);

      if (result.success) {
        const sentAmount = preparedTx.formattedAmount || amount;
        const sentSymbol = preparedTx.tokenSymbol;
        const sentTokenPrice = priceMap[sentSymbol]?.price || 0;

        setSuccessSummary({
          amount: sentAmount,
          symbol: sentSymbol,
          toAddress,
          amountUsd: sentTokenPrice > 0 ? (parseFloat(sentAmount) || 0) * sentTokenPrice : 0,
        });
        setTxHash(result.data.hash);
        setStep('success');
        // Refresh balances after a delay
        setTimeout(loadTokenBalances, 2000);
      } else {
        setConfirmError(result.error);
      }
    } catch (err) {
      setConfirmError(parseTransactionError(err));
    } finally {
      setSending(false);
    }
  };

  const handleCancel = () => {
    // Go back to form, keep form data
    setStep('form');
    setConfirmError('');
  };

  const getAssetUrl = (path: string) => {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      return path;
    }
  };

  const handleSendMore = () => {
    setTxHash('');
    setSuccessSummary(null);
    setAmount('');
    setToAddress('');
    setFormError('');
    setPreparedTx(null);
    setGasEstimate(null);
    setStep('form');
  };

  // Filter tokens by search
  const filteredTokens = tokens.filter(t => 
    t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
    t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  // ============== STEP 3: Success Screen ==============
  if (step === 'success') {
    return (
      <div className="flex flex-col h-full slide-in-right">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-muted rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-semibold">Giao dịch thành công</h1>
        </div>
        
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          {/* Animated Success Circle */}
          <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mb-4 success-circle">
            <div className="w-12 h-12 bg-success rounded-full flex items-center justify-center animate-check">
              <Check className="w-6 h-6 text-success-foreground" />
            </div>
          </div>
          
          <h2 className="text-lg font-medium mb-2">Đã gửi thành công!</h2>
          
          {/* Transaction Details */}
          <div className="w-full bg-muted/50 rounded-xl p-3 mb-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Số lượng</span>
              <span className="font-medium">
                {successSummary?.amount || amount} {successSummary?.symbol || selectedToken?.symbol}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Đến</span>
              <span className="font-mono text-xs">{formatAddress(successSummary?.toAddress || toAddress, 8)}</span>
            </div>
            {(successSummary?.amountUsd || amountUsd) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Giá trị</span>
                <span className="text-muted-foreground">{formatPrice(successSummary?.amountUsd || amountUsd)}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              chrome.tabs.create({ url: `https://bscscan.com/tx/${txHash}` });
            }}
            className="text-sm text-primary underline mb-4"
          >
            Xem trên BSCScan
          </button>
        </div>

        <div className="p-4 space-y-2">
          <button
            onClick={handleSendMore}
            className="w-full py-3 bg-muted rounded-xl font-medium btn-hover-scale"
          >
            Gửi thêm
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium btn-hover-scale"
          >
            Quay về trang chủ
          </button>
        </div>
      </div>
    );
  }

  // ============== STEP 2: Confirm Screen ==============
  if (step === 'confirm' && preparedTx && gasEstimate) {
    const bnbPrice = priceMap['BNB']?.price || 0;
    const tokenPriceVal = selectedToken ? (priceMap[selectedToken.symbol]?.price || 0) : 0;

    return (
      <ConfirmTxScreen
        prepared={preparedTx}
        fromAddress={activeAddress}
        gasEstimate={gasEstimate}
        nativeTokenPrice={bnbPrice}
        tokenPrice={tokenPriceVal}
        onConfirm={handleConfirmAndSend}
        onCancel={handleCancel}
        loading={sending}
        error={confirmError}
      />
    );
  }

  // ============== STEP 1: Form Screen ==============
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-muted rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold">Gửi Crypto</h1>
      </div>
      
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Token Select */}
        <div>
          <label className="text-sm text-muted-foreground mb-1 block">Chọn token</label>
          <button
            onClick={() => setShowTokenSelect(!showTokenSelect)}
            className="w-full flex items-center justify-between p-3 bg-muted rounded-xl focus-ring-animated transition-colors"
            disabled={loadingBalances}
          >
            {loadingBalances ? (
              <span className="text-muted-foreground">Đang tải...</span>
            ) : selectedToken ? (
              <div className="flex items-center gap-2">
                <img 
                  src={getAssetUrl(selectedToken.logo)} 
                  alt={selectedToken.symbol}
                  className="w-6 h-6 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).src = getAssetUrl('/tokens/default.svg'); }}
                />
                <div className="text-left">
                  <span className="font-medium">{selectedToken.symbol}</span>
                  {selectedToken.balanceUsd !== undefined && selectedToken.balanceUsd > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({formatPrice(selectedToken.balanceUsd)})
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground">Chọn token</span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform ${showTokenSelect ? 'rotate-180' : ''}`} />
          </button>

          {showTokenSelect && (
            <div className="mt-2 bg-muted rounded-xl overflow-hidden dropdown-enter">
              {/* Search Input */}
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={tokenSearch}
                    onChange={(e) => setTokenSearch(e.target.value)}
                    placeholder="Tìm token..."
                    className="w-full pl-9 pr-3 py-2 bg-background rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              
              <div className="max-h-40 overflow-y-auto">
                {filteredTokens.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => {
                      setSelectedToken(token);
                      setShowTokenSelect(false);
                      setTokenSearch('');
                    }}
                    className="w-full flex items-center justify-between p-3 hover:bg-background/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <img 
                        src={getAssetUrl(token.logo)} 
                        alt={token.symbol}
                        className="w-6 h-6 rounded-full"
                        onError={(e) => { (e.target as HTMLImageElement).src = getAssetUrl('/tokens/default.svg'); }}
                      />
                      <span>{token.symbol}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm">{formatBalance(token.balance)}</span>
                      {token.balanceUsd !== undefined && token.balanceUsd > 0 && (
                        <span className="text-xs text-muted-foreground block">
                          {formatPrice(token.balanceUsd)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {filteredTokens.length === 0 && (
                  <p className="text-center text-muted-foreground py-4 text-sm">Không tìm thấy token</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* To Address */}
        <div>
          <label className="text-sm text-muted-foreground mb-1 block">Địa chỉ nhận</label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => {
              setToAddress(e.target.value);
              setInputError(false);
              setFormError('');
            }}
            placeholder="0x..."
            className={`w-full px-4 py-3 bg-muted rounded-xl border focus:border-primary focus:outline-none font-mono text-sm transition-all ${
              inputError && !isValidAddress(toAddress) ? 'border-destructive error-shake' : 'border-border'
            }`}
          />
        </div>

        {/* Amount */}
        <div>
          <label className="text-sm text-muted-foreground mb-1 block">Số lượng</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setInputError(false);
                setFormError('');
              }}
              placeholder="0.00"
              className={`w-full px-4 py-3 pr-16 bg-muted rounded-xl border focus:border-primary focus:outline-none transition-all ${
                inputError && (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) ? 'border-destructive error-shake' : 'border-border'
              }`}
            />
            <button
              onClick={handleMaxAmount}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium hover:underline"
            >
              MAX
            </button>
          </div>
          <div className="flex justify-between mt-1">
            {selectedToken && (
              <p className="text-xs text-muted-foreground">
                Số dư: {formatBalance(selectedToken.balance)} {selectedToken.symbol}
              </p>
            )}
            {amountUsd > 0 && (
              <p className="text-xs text-muted-foreground">
                ≈ {formatPrice(amountUsd)}
              </p>
            )}
          </div>
        </div>

        {/* Error Message */}
        {formError && (
          <div className="error-box flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">{formError}</p>
          </div>
        )}
      </div>

      {/* Submit - Goes to Confirm step, NOT sending yet */}
      <div className="p-4 border-t border-border">
        <button
          onClick={handlePrepare}
          disabled={preparing || !selectedToken || !toAddress || !amount}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2 btn-hover-scale"
        >
          {preparing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Đang chuẩn bị...
            </>
          ) : (
            'Tiếp tục'
          )}
        </button>
      </div>
    </div>
  );
}

export default SendPage;
