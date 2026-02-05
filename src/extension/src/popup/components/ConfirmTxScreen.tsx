/**
 * ConfirmTxScreen Component
 * 
 * Shared confirmation screen for transactions.
 * Used by both SendPage and ApproveTxPage.
 */

import { useState, useMemo } from 'react';
import { 
  Send, 
  FileCode, 
  Copy, 
  ExternalLink, 
  Eye, 
  EyeOff,
  AlertTriangle,
  X,
  Check,
  ArrowLeft
} from 'lucide-react';
import { PreparedTransaction, GasEstimate, GasSettings } from '@shared/types';
import { calculateTotal, formatGasPrice } from '@shared/lib/txBuilder';
import { formatAddress } from '@shared/lib/wallet';
import { formatPrice } from '@shared/lib/priceTracker';
import { ethers } from 'ethers';
import GasEditor from './GasEditor';

interface ConfirmTxScreenProps {
  // Transaction info
  prepared: PreparedTransaction;
  fromAddress: string;
  
  // Gas estimation
  gasEstimate: GasEstimate;
  
  // Price for USD display
  nativeTokenPrice?: number;
  tokenPrice?: number;
  
  // Actions
  onConfirm: (password: string, gasSettings: GasSettings) => Promise<void>;
  onCancel: () => void;
  
  // State
  loading?: boolean;
  error?: string;
  
  // Optional: origin (for DApp approvals)
  origin?: string;
}

export function ConfirmTxScreen({
  prepared,
  fromAddress,
  gasEstimate,
  nativeTokenPrice = 0,
  tokenPrice = 0,
  onConfirm,
  onCancel,
  loading = false,
  error = '',
  origin,
}: ConfirmTxScreenProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [gasLevel, setGasLevel] = useState<'low' | 'market' | 'aggressive' | 'custom'>('market');
  const [gasSettings, setGasSettings] = useState<GasSettings>({
    gasLimit: gasEstimate.gasLimit,
    gasPrice: gasEstimate.presets.find(p => p.level === 'market')?.gasPrice || 0n,
  });
  const [copied, setCopied] = useState<'from' | 'to' | null>(null);

  // Calculate totals
  const totals = useMemo(() => {
    return calculateTotal(prepared, gasSettings);
  }, [prepared, gasSettings]);

  // USD values
  const amountUsd = useMemo(() => {
    const amount = parseFloat(prepared.formattedAmount || '0');
    if (prepared.isContractInteraction) {
      return amount * tokenPrice;
    }
    return amount * nativeTokenPrice;
  }, [prepared, nativeTokenPrice, tokenPrice]);

  const feeUsd = useMemo(() => {
    const fee = parseFloat(totals.feeFormatted);
    return fee * nativeTokenPrice;
  }, [totals, nativeTokenPrice]);

  const handleGasSelect = (settings: GasSettings, level: 'low' | 'market' | 'aggressive' | 'custom') => {
    setGasSettings(settings);
    setGasLevel(level);
  };

  const handleCopy = async (text: string, type: 'from' | 'to') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleConfirm = async () => {
    if (!password) return;
    await onConfirm(password, gasSettings);
  };

  // Recipient address (for ERC-20, use actualRecipient)
  const recipientAddress = prepared.actualRecipient || prepared.to;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <button onClick={onCancel} className="p-2 hover:bg-muted rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold">Xác nhận giao dịch</h1>
      </div>

      <div className="flex-1 p-4 overflow-auto space-y-4">
        {/* Amount Card */}
        <div className="bg-muted/50 rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            {prepared.isContractInteraction ? (
              <FileCode className="w-5 h-5 text-primary" />
            ) : (
              <Send className="w-5 h-5 text-primary" />
            )}
            <span className="font-medium">
              {prepared.isContractInteraction ? 'Gửi Token' : 'Gửi'}
            </span>
          </div>
          <div className="text-2xl font-bold">
            {prepared.formattedAmount} {prepared.tokenSymbol}
          </div>
          {amountUsd > 0 && (
            <div className="text-sm text-muted-foreground">
              ≈ {formatPrice(amountUsd)}
            </div>
          )}
        </div>

        {/* Transaction Details */}
        <div className="bg-muted/50 rounded-xl p-4 space-y-3 text-sm">
          {/* From */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Từ</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{formatAddress(fromAddress, 8)}</span>
              <button
                onClick={() => handleCopy(fromAddress, 'from')}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied === 'from' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* To */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Đến</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{formatAddress(recipientAddress, 8)}</span>
              <button
                onClick={() => handleCopy(recipientAddress, 'to')}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied === 'to' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* Network */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Mạng</span>
            <span>BNB Smart Chain</span>
          </div>

          {/* Nonce */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Nonce</span>
            <span>{gasEstimate.nonce}</span>
          </div>

          {/* Contract for ERC-20 */}
          {prepared.isContractInteraction && prepared.tokenAddress && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-muted-foreground flex items-center gap-1">
                <FileCode className="w-3 h-3" />
                Contract
              </span>
              <a
                href={`https://bscscan.com/address/${prepared.tokenAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <span className="font-mono text-xs">{formatAddress(prepared.tokenAddress, 6)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Origin for DApp */}
          {origin && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-muted-foreground">DApp</span>
              <span className="text-xs">{origin}</span>
            </div>
          )}
        </div>

        {/* Gas Editor */}
        <GasEditor
          presets={gasEstimate.presets}
          gasLimit={gasEstimate.gasLimit}
          selectedLevel={gasLevel}
          onSelect={handleGasSelect}
        />

        {/* Total Summary */}
        <div className="bg-muted/50 rounded-xl p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Phí gas</span>
            <div className="text-right">
              <span>~{totals.feeFormatted} BNB</span>
              {feeUsd > 0 && (
                <span className="text-muted-foreground text-xs ml-1">
                  ({formatPrice(feeUsd)})
                </span>
              )}
            </div>
          </div>
          
          {!prepared.isContractInteraction && (
            <div className="flex items-center justify-between font-medium pt-2 border-t border-border">
              <span>Tổng cộng</span>
              <div className="text-right">
                <span>{totals.totalFormatted} BNB</span>
                {nativeTokenPrice > 0 && (
                  <span className="text-muted-foreground text-xs ml-1">
                    ({formatPrice(parseFloat(totals.totalFormatted) * nativeTokenPrice)})
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-warning">
            Hãy kiểm tra kỹ thông tin trước khi xác nhận. Giao dịch không thể hoàn tác.
          </p>
        </div>

        {/* Password Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Nhập mật khẩu để ký</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mật khẩu"
              className="w-full px-4 py-3 pr-12 bg-muted border border-border rounded-xl focus:outline-none focus:border-primary transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <button
          onClick={handleConfirm}
          disabled={loading || !password}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 transition-opacity"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Check className="w-5 h-5" />
          )}
          {loading ? 'Đang gửi...' : 'Xác nhận & Gửi'}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-muted rounded-xl font-medium disabled:opacity-50 transition-opacity"
        >
          <X className="w-5 h-5" />
          Hủy
        </button>
      </div>
    </div>
  );
}

export default ConfirmTxScreen;
