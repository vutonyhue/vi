/**
 * ApproveTxPage - DApp Transaction Approval
 *
 * Reuses ConfirmTxScreen for consistent UX with SendPage.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { Loader2 } from 'lucide-react';
import { decryptPrivateKey } from '@shared/lib/encryption';
import { STORAGE_KEYS } from '@shared/storage/types';
import { GasEstimate, GasSettings, PreparedTransaction, SecureWalletStorage } from '@shared/types';
import { estimateTx, parseTransactionError, signAndBroadcast } from '@shared/lib/txBuilder';
import ConfirmTxScreen from '../components/ConfirmTxScreen';

interface PendingTxRequest {
  id: string;
  origin: string;
  params: unknown[];
  requestedAccount?: string;
}

interface DAppTxPayload {
  from?: string;
  to?: string;
  value?: string;
  data?: string;
}

function parseWeiValue(rawValue: unknown): bigint {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return 0n;
  }

  if (typeof rawValue === 'bigint') {
    return rawValue;
  }

  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      throw new Error('Gia tri giao dich khong hop le');
    }
    return BigInt(Math.trunc(rawValue));
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return 0n;
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      return BigInt(trimmed);
    }
    if (/^\d+$/.test(trimmed)) {
      return BigInt(trimmed);
    }
  }

  throw new Error('Gia tri giao dich khong hop le');
}

function ApproveTxPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId') || '';

  const [activeAddress, setActiveAddress] = useState('');
  const [requestOrigin, setRequestOrigin] = useState('Unknown');
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
      if (!requestId) {
        setError('Khong tim thay yeu cau giao dich');
        return;
      }

      const pendingResponse = await chrome.runtime.sendMessage({
        type: 'GET_PENDING_REQUEST',
        payload: { requestId },
      });

      if (!pendingResponse?.success || !pendingResponse?.data) {
        setError('Yeu cau giao dich da het han');
        return;
      }

      const pendingRequest = pendingResponse.data as PendingTxRequest;
      const txPayload = (pendingRequest.params?.[0] || {}) as DAppTxPayload;
      const to = typeof txPayload.to === 'string' ? txPayload.to : '';
      if (!to) {
        setError('Thieu dia chi nhan giao dich');
        return;
      }

      const fromAccount = pendingRequest.requestedAccount || txPayload.from || '';
      if (!fromAccount) {
        setError('Khong xac dinh duoc vi ky');
        return;
      }

      const txData = typeof txPayload.data === 'string' ? txPayload.data : '0x';
      const weiValue = parseWeiValue(txPayload.value);
      const isContractInteraction = txData !== '0x';

      const prepared: PreparedTransaction = {
        to,
        value: weiValue,
        data: txData,
        tokenSymbol: 'BNB',
        tokenDecimals: 18,
        tokenAddress: null,
        isContractInteraction,
        formattedAmount: ethers.formatEther(weiValue),
      };

      setPreparedTx(prepared);
      setActiveAddress(fromAccount);
      setRequestOrigin(pendingRequest.origin || 'Unknown');

      const estimate = await estimateTx(prepared, fromAccount);
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
      const encryptedData = await chrome.storage.local.get(STORAGE_KEYS.ENCRYPTED_KEYS);
      const data = encryptedData[STORAGE_KEYS.ENCRYPTED_KEYS];

      if (!data) {
        throw new Error('Khong tim thay vi');
      }

      const parsed: SecureWalletStorage = JSON.parse(data);
      const keyData = parsed.wallets[activeAddress] || parsed.wallets[activeAddress.toLowerCase()];

      if (!keyData) {
        throw new Error('Khong tim thay private key');
      }

      const privateKey = await decryptPrivateKey(keyData, password);
      const result = await signAndBroadcast(preparedTx, gasSettings, privateKey);

      if (result.success) {
        await chrome.runtime.sendMessage({
          type: 'APPROVE_TRANSACTION',
          payload: { requestId, txHash: result.data.hash },
        });
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
      payload: { requestId },
    });
    window.close();
  };

  const getHostname = () => {
    try {
      return new URL(requestOrigin).hostname;
    } catch {
      return requestOrigin;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-2 text-muted-foreground">Dang tai thong tin giao dich...</p>
      </div>
    );
  }

  if (!preparedTx || !gasEstimate) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4 text-center">
        <p className="text-destructive mb-4">{error || 'Khong the tai thong tin giao dich'}</p>
        <button
          onClick={handleReject}
          className="px-6 py-2 bg-muted rounded-xl"
        >
          Dong
        </button>
      </div>
    );
  }

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
