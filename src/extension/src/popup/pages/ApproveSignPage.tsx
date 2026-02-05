import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, Eye, EyeOff, PenTool, X } from 'lucide-react';
import { ethers } from 'ethers';
import { decryptPrivateKey } from '@shared/lib/encryption';
import { STORAGE_KEYS } from '@shared/storage/types';
import { SecureWalletStorage } from '@shared/types';

interface PendingSignRequest {
  id: string;
  method: string;
  params: unknown[];
  origin: string;
  requestedAccount?: string;
}

function ApproveSignPage() {
  const [searchParams] = useSearchParams();

  const requestId = searchParams.get('requestId') || '';
  const [message, setMessage] = useState(searchParams.get('message') || '');
  const [origin, setOrigin] = useState(searchParams.get('origin') || 'Unknown');
  const [method, setMethod] = useState(searchParams.get('method') || 'personal_sign');
  const [requestedAccount, setRequestedAccount] = useState<string | null>(searchParams.get('address'));

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [decodedMessage, setDecodedMessage] = useState('');

  useEffect(() => {
    if (!requestId) return;
    loadPendingRequest();
  }, [requestId]);

  useEffect(() => {
    try {
      if (message.startsWith('0x')) {
        const decoded = ethers.toUtf8String(message);
        setDecodedMessage(decoded);
      } else if (method === 'eth_signTypedData_v4') {
        const parsed = JSON.parse(message);
        setDecodedMessage(JSON.stringify(parsed, null, 2));
      } else {
        setDecodedMessage(message);
      }
    } catch {
      setDecodedMessage(message);
    }
  }, [message, method]);

  const loadPendingRequest = async () => {
    try {
      const pendingResponse = await chrome.runtime.sendMessage({
        type: 'GET_PENDING_REQUEST',
        payload: { requestId },
      });

      if (!pendingResponse?.success || !pendingResponse?.data) {
        setError('Yeu cau ky da het han');
        return;
      }

      const request = pendingResponse.data as PendingSignRequest;
      setMethod(request.method || method);
      setOrigin(request.origin || origin);
      setRequestedAccount(request.requestedAccount || requestedAccount);

      if (request.method === 'eth_signTypedData_v4') {
        const payload = typeof request.params?.[1] === 'string' ? request.params[1] : '';
        if (payload) setMessage(payload);
      } else {
        const payload = typeof request.params?.[0] === 'string' ? request.params[0] : '';
        if (payload) setMessage(payload);
      }
    } catch (loadError) {
      console.error('[ApproveSignPage] Failed to load pending request:', loadError);
      setError('Khong the tai yeu cau ky');
    }
  };

  const handleSign = async () => {
    if (!password) {
      setError('Vui long nhap mat khau');
      return;
    }

    if (!requestedAccount) {
      setError('Khong xac dinh duoc vi ky');
      return;
    }

    setSigning(true);
    setError('');

    try {
      const encryptedData = await chrome.storage.local.get(STORAGE_KEYS.ENCRYPTED_KEYS);
      const data = encryptedData[STORAGE_KEYS.ENCRYPTED_KEYS];

      if (!data) {
        throw new Error('Khong tim thay vi');
      }

      const parsed: SecureWalletStorage = JSON.parse(data);
      const keyData = parsed.wallets[requestedAccount] || parsed.wallets[requestedAccount.toLowerCase()];

      if (!keyData) {
        throw new Error('Khong tim thay private key');
      }

      const privateKey = await decryptPrivateKey(keyData, password);
      const wallet = new ethers.Wallet(privateKey);
      let signature: string;

      if (method === 'eth_signTypedData_v4') {
        const typedData = JSON.parse(message);
        const { domain, types, message: typedMessage } = typedData;
        const typesWithoutDomain = { ...types };
        delete typesWithoutDomain.EIP712Domain;
        signature = await wallet.signTypedData(domain, typesWithoutDomain, typedMessage);
      } else {
        let messageToSign = message;
        if (message.startsWith('0x')) {
          messageToSign = ethers.toUtf8String(message);
        }
        signature = await wallet.signMessage(messageToSign);
      }

      await chrome.runtime.sendMessage({
        type: 'APPROVE_SIGN',
        payload: { requestId, signature },
      });

      window.close();
    } catch (err) {
      console.error('[ApproveSignPage] Sign error:', err);
      if (err instanceof Error && err.message.toLowerCase().includes('decrypt')) {
        setError('Mat khau khong dung');
      } else {
        setError(err instanceof Error ? err.message : 'Ky that bai');
      }
    } finally {
      setSigning(false);
    }
  };

  const handleReject = async () => {
    await chrome.runtime.sendMessage({
      type: 'REJECT_SIGN',
      payload: { requestId },
    });
    window.close();
  };

  const getHostname = () => {
    try {
      return new URL(origin).hostname;
    } catch {
      return origin;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h1 className="font-semibold text-center">Ky tin nhan</h1>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        <div className="flex flex-col items-center mb-4">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <PenTool className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            {getHostname()} muon ban ky:
          </p>
        </div>

        <div className="bg-muted/50 rounded-xl p-3 mb-4 max-h-32 overflow-auto">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {decodedMessage.slice(0, 500)}
            {decodedMessage.length > 500 && '...'}
          </pre>
        </div>

        <div className="flex justify-center mb-4">
          <span className="px-2 py-1 bg-muted rounded text-xs font-mono">
            {method}
          </span>
        </div>

        <div className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg mb-4">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-warning">
            Chi ky tin nhan tu nguon ban tin tuong.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Nhap mat khau de ky</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mat khau"
              className="w-full px-3 py-2 pr-10 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              onKeyDown={(e) => e.key === 'Enter' && handleSign()}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-border space-y-2">
        <button
          onClick={handleSign}
          disabled={signing || !password}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50"
        >
          {signing ? (
            <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Check className="w-5 h-5" />
          )}
          {signing ? 'Dang ky...' : 'Ky'}
        </button>
        <button
          onClick={handleReject}
          disabled={signing}
          className="w-full flex items-center justify-center gap-2 py-3 bg-muted rounded-xl font-medium"
        >
          <X className="w-5 h-5" />
          Tu choi
        </button>
      </div>
    </div>
  );
}

export default ApproveSignPage;
