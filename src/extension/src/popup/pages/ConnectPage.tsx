import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, X, Check, Eye, Key, AlertCircle } from 'lucide-react';
import { STORAGE_KEYS } from '@shared/storage/types';
import { DAppPermission, WalletAccount } from '@shared/types';

const OPTIONAL_PERMISSIONS: Array<{ key: DAppPermission; label: string }> = [
  { key: 'eth_sendTransaction', label: 'Yeu cau phe duyet giao dich' },
  { key: 'personal_sign', label: 'Yeu cau ky thong diep' },
  { key: 'eth_signTypedData', label: 'Yeu cau ky typed data' },
  { key: 'wallet_switchEthereumChain', label: 'Yeu cau chuyen mang' },
];

function ConnectPage() {
  const [searchParams] = useSearchParams();
  const origin = searchParams.get('origin') || 'Unknown';
  const requestId = searchParams.get('requestId');

  const [wallets, setWallets] = useState<WalletAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<DAppPermission[]>([
    'eth_accounts',
    'eth_sendTransaction',
    'personal_sign',
    'eth_signTypedData',
    'wallet_switchEthereumChain',
  ]);
  const [loadingWallets, setLoadingWallets] = useState(true);

  useEffect(() => {
    loadWallets();
  }, []);

  const loadWallets = async () => {
    setLoadingWallets(true);
    try {
      const data = await chrome.storage.local.get([STORAGE_KEYS.WALLETS, STORAGE_KEYS.ACTIVE_WALLET]);
      const walletsRaw = data[STORAGE_KEYS.WALLETS];
      const activeWallet = data[STORAGE_KEYS.ACTIVE_WALLET] as string | undefined;

      let parsedWallets: WalletAccount[] = [];
      if (walletsRaw) {
        try {
          const value = JSON.parse(walletsRaw);
          if (Array.isArray(value)) {
            parsedWallets = value.filter((w) => w?.address);
          }
        } catch (error) {
          console.error('[ConnectPage] Failed to parse wallets:', error);
        }
      }

      setWallets(parsedWallets);

      if (parsedWallets.length > 0) {
        const preferred = activeWallet && parsedWallets.some((w) => w.address === activeWallet)
          ? activeWallet
          : parsedWallets[0].address;
        setSelectedAccounts([preferred]);
      } else {
        setSelectedAccounts(activeWallet ? [activeWallet] : []);
      }
    } catch (error) {
      console.error('[ConnectPage] Failed to load wallets:', error);
    } finally {
      setLoadingWallets(false);
    }
  };

  const canApprove = useMemo(
    () => !!requestId && selectedAccounts.length > 0,
    [requestId, selectedAccounts.length]
  );

  const toggleAccount = (address: string) => {
    setSelectedAccounts((prev) => {
      if (prev.includes(address)) {
        if (prev.length === 1) return prev;
        return prev.filter((a) => a !== address);
      }
      return [...prev, address];
    });
  };

  const togglePermission = (permission: DAppPermission) => {
    setSelectedPermissions((prev) => {
      if (prev.includes(permission)) {
        return prev.filter((p) => p !== permission);
      }
      return [...prev, permission];
    });
  };

  const handleApprove = async () => {
    if (requestId) {
      await chrome.runtime.sendMessage({
        type: 'APPROVE_CONNECTION',
        payload: {
          requestId,
          origin,
          accounts: selectedAccounts,
          permissions: ['eth_accounts', ...selectedPermissions.filter((p) => p !== 'eth_accounts')],
        },
      });
    }
    window.close();
  };

  const handleReject = async () => {
    if (requestId) {
      await chrome.runtime.sendMessage({
        type: 'REJECT_CONNECTION',
        payload: { requestId },
      });
    }
    window.close();
  };

  const getHostname = () => {
    try {
      return new URL(origin).hostname;
    } catch {
      return origin;
    }
  };

  const shortenAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h1 className="font-semibold text-center">Yeu cau ket noi</h1>
      </div>

      <div className="flex-1 p-4 overflow-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Ket noi voi DApp</h2>
            <p className="text-sm text-muted-foreground">{getHostname()}</p>
          </div>
        </div>

        <div className="w-full bg-muted/50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Tai khoan duoc phep truy cap:</p>
          {loadingWallets ? (
            <p className="text-sm text-muted-foreground">Dang tai danh sach vi...</p>
          ) : wallets.length === 0 ? (
            <p className="text-sm text-destructive">Khong tim thay tai khoan nao de ket noi.</p>
          ) : (
            <div className="space-y-2">
              {wallets.map((wallet) => {
                const checked = selectedAccounts.includes(wallet.address);
                return (
                  <label
                    key={wallet.address}
                    className="flex items-center justify-between p-2 rounded-lg bg-background border border-border cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{wallet.name || 'Wallet'}</p>
                      <p className="text-xs text-muted-foreground font-mono">{shortenAddress(wallet.address)}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAccount(wallet.address)}
                      className="w-4 h-4 accent-primary"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="w-full bg-muted/50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Quyen truy cap:</p>
          <div className="flex items-center gap-2 text-sm p-2 rounded-lg bg-background border border-border">
            <Eye className="w-4 h-4 text-primary" />
            <span>Xem dia chi vi cua ban</span>
            <span className="ml-auto text-xs text-muted-foreground">Bat buoc</span>
          </div>
          {OPTIONAL_PERMISSIONS.map((permission) => (
            <label
              key={permission.key}
              className="flex items-center gap-2 text-sm p-2 rounded-lg bg-background border border-border cursor-pointer"
            >
              <Key className="w-4 h-4 text-primary" />
              <span className="flex-1">{permission.label}</span>
              <input
                type="checkbox"
                checked={selectedPermissions.includes(permission.key)}
                onChange={() => togglePermission(permission.key)}
                className="w-4 h-4 accent-primary"
              />
            </label>
          ))}
        </div>

        <div className="flex items-start gap-2 p-2 bg-warning/10 rounded-lg w-full">
          <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-warning">Chi ket noi voi trang web ban tin tuong.</p>
        </div>
      </div>

      <div className="p-4 border-t border-border space-y-2">
        <button
          onClick={handleApprove}
          disabled={!canApprove}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-5 h-5" />
          Cho phep
        </button>
        <button
          onClick={handleReject}
          className="w-full flex items-center justify-center gap-2 py-3 bg-muted rounded-xl font-medium"
        >
          <X className="w-5 h-5" />
          Tu choi
        </button>
      </div>
    </div>
  );
}

export default ConnectPage;
