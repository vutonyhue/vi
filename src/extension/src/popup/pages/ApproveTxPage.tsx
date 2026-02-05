/**
 * ApproveTxPage - DApp Transaction Approval
 * 
 * Reuses ConfirmTxScreen for consistent UX with SendPage.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { decryptPrivateKey } from '@shared/lib/encryption';
import { SecureWalletStorage, PreparedTransaction, GasEstimate, GasSettings } from '@shared/types';
import { STORAGE_KEYS } from '@shared/storage/types';
import { BSC_MAINNET } from '@shared/constants/tokens';
import { estimateTx, signAndBroadcast, parseTransactionError } from '@shared/lib/txBuilder';
import ConfirmTxScreen from '../components/ConfirmTxScreen';
import { Loader2 } from 'lucide-react';

function ApproveTxPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId') || '';
  
  // Parse transaction data from URL
  const txData = {
    to: searchParams.get('to') || '',
    value: searchParams.get('value') || '0',
    data: searchParams.get('data') || '',
    origin: searchParams.get('origin') || 'Unknown',
  };
  
  const [activeAddress, setActiveAddress] = useState('');
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    initializeTx();
  }, []);

  const initializeTx = async () => {
    try {
      // Get active address
      const walletData = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_WALLET);
      const address = walletData[STORAGE_KEYS.ACTIVE_WALLET];
      
      if (!address) {
        setError('Không tìm thấy ví');
        setLoading(false);
        return;
      }
      
      setActiveAddress(address);

      // Build PreparedTransaction from URL params
      const isContractInteraction = !!txData.data && txData.data !== '0x';
      
      const prepared: PreparedTransaction = {
        to: txData.to,
        value: txData.value !== '0' ? ethers.parseEther(txData.value) : 0n,
        data: txData.data || '0x',
        tokenSymbol: 'BNB',
        tokenDecimals: 18,
        tokenAddress: null,
        isContractInteraction,
        formattedAmount: txData.value,
      };
      
      setPreparedTx(prepared);

      // Estimate gas
      const estimate = await estimateTx(prepared, address);
      setGasEstimate(estimate);
      
    } catch (err) {
      console.error('[ApproveTxPage] Init error:', err);
      setError(parseTransactionError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (password: string, gasSettings: GasSettings) => {
    if (!preparedTx) return;
    
    setSending(true);
    setError('');
    
    try {
      // Get encrypted wallet data
      const encryptedData = await chrome.storage.local.get(STORAGE_KEYS.ENCRYPTED_KEYS);
      const data = encryptedData[STORAGE_KEYS.ENCRYPTED_KEYS];
      
      if (!data) {
        throw new Error('Không tìm thấy ví');
      }
      
      const parsed: SecureWalletStorage = JSON.parse(data);
      const keyData = parsed.wallets[activeAddress];
      
      if (!keyData) {
        throw new Error('Không tìm thấy private key');
      }
      
      // Decrypt private key
      const privateKey = await decryptPrivateKey(keyData, password);
      
      // Sign and broadcast
      const result = await signAndBroadcast(preparedTx, gasSettings, privateKey);
      
      if (result.success) {
        // Notify background of success
        await chrome.runtime.sendMessage({
          type: 'APPROVE_TRANSACTION',
          payload: { requestId, txHash: result.data.hash }
        });
        
        // Close popup
        window.close();
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error('[ApproveTxPage] Transaction error:', err);
      setError(parseTransactionError(err));
    } finally {
      setSending(false);
    }
  };

  const handleReject = async () => {
    await chrome.runtime.sendMessage({
      type: 'REJECT_TRANSACTION',
      payload: { requestId }
    });
    window.close();
  };

  const getHostname = () => {
    try {
      return new URL(txData.origin).hostname;
    } catch {
      return txData.origin;
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-2 text-muted-foreground">Đang tải thông tin giao dịch...</p>
      </div>
    );
  }

  // Error state (before confirm screen)
  if (!preparedTx || !gasEstimate) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4 text-center">
        <p className="text-destructive mb-4">{error || 'Không thể tải thông tin giao dịch'}</p>
        <button
          onClick={handleReject}
          className="px-6 py-2 bg-muted rounded-xl"
        >
          Đóng
        </button>
      </div>
    );
  }

  // Use shared ConfirmTxScreen
  return (
    <ConfirmTxScreen
      prepared={preparedTx}
      fromAddress={activeAddress}
      gasEstimate={gasEstimate}
      onConfirm={handleConfirm}
      onCancel={handleReject}
      loading={sending}
      error={error}
      origin={getHostname()}
    />
  );
}

export default ApproveTxPage;
