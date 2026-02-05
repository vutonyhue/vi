/**
 * AddTokenDialog - Dialog to add custom BEP-20 tokens
 * Fetches token info from blockchain using contract address
 */

import { useState } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Plus } from 'lucide-react';
import { isValidAddress } from '@shared/lib/wallet';
import { Token } from '@shared/types';
import { ethers } from 'ethers';
import { BSC_MAINNET } from '@shared/constants/tokens';

interface AddTokenDialogProps {
  open: boolean;
  onClose: () => void;
  onAddToken: (token: Token) => void;
  existingTokens: Token[];
}

interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

// Minimal ERC-20 ABI for fetching token info
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

export function AddTokenDialog({ open, onClose, onAddToken, existingTokens }: AddTokenDialogProps) {
  const [contractAddress, setContractAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState('');

  const resetState = () => {
    setContractAddress('');
    setTokenInfo(null);
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const fetchTokenInfo = async (address: string) => {
    if (!isValidAddress(address)) {
      setError('Địa chỉ contract không hợp lệ');
      setTokenInfo(null);
      return;
    }

    // Check if token already exists
    const exists = existingTokens.some(
      t => t.address?.toLowerCase() === address.toLowerCase()
    );
    if (exists) {
      setError('Token này đã có trong danh sách');
      setTokenInfo(null);
      return;
    }

    setLoading(true);
    setError('');
    setTokenInfo(null);

    try {
      const provider = new ethers.JsonRpcProvider(BSC_MAINNET.rpcUrl);
      const contract = new ethers.Contract(address, ERC20_ABI, provider);

      const [symbol, name, decimals] = await Promise.all([
        contract.symbol(),
        contract.name(),
        contract.decimals(),
      ]);

      setTokenInfo({
        symbol,
        name,
        decimals: Number(decimals),
      });
    } catch (err) {
      console.error('Error fetching token info:', err);
      setError('Không thể lấy thông tin token. Vui lòng kiểm tra địa chỉ contract.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddressChange = (value: string) => {
    setContractAddress(value);
    setError('');
    setTokenInfo(null);

    // Auto-fetch when address looks complete (42 chars: 0x + 40 hex)
    if (value.length === 42 && value.startsWith('0x')) {
      fetchTokenInfo(value);
    }
  };

  const handleAddToken = () => {
    if (!tokenInfo || !contractAddress) return;

    const newToken: Token = {
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      address: contractAddress,
      decimals: tokenInfo.decimals,
      logo: '/tokens/default.svg',
    };

    onAddToken(newToken);
    handleClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-xl slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold">Thêm Token Tùy Chỉnh</h2>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-muted rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Contract Address Input */}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">
              Địa chỉ contract (BEP-20)
            </label>
            <input
              type="text"
              value={contractAddress}
              onChange={(e) => handleAddressChange(e.target.value)}
              placeholder="0x..."
              className="w-full px-3 py-2.5 bg-muted rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground p-3 bg-muted/50 rounded-xl">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Đang tải thông tin token...</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="flex items-center gap-2 text-destructive p-3 bg-destructive/10 rounded-xl">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Token Info */}
          {tokenInfo && (
            <div className="p-3 bg-success/10 border border-success/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Đã tìm thấy token</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Symbol:</span>
                  <span className="font-medium">{tokenInfo.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tên:</span>
                  <span className="font-medium">{tokenInfo.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Decimals:</span>
                  <span className="font-medium">{tokenInfo.decimals}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-border flex gap-2">
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 bg-muted rounded-xl font-medium btn-hover-scale"
          >
            Hủy
          </button>
          <button
            onClick={handleAddToken}
            disabled={!tokenInfo || loading}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium btn-hover-scale disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Thêm Token
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddTokenDialog;
