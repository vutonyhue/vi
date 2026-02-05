/**
 * FUN Wallet - Background Service Worker
 * 
 * Handles:
 * - Message passing between popup and content scripts
 * - Wallet operations
 * - DApp connection management
 * - Transaction signing with callback system
 */

import { ethers } from 'ethers';
import { chromeStorageAdapter } from '../../storage/ChromeStorageAdapter';
import { STORAGE_KEYS } from '@shared/storage/types';
import { decryptPrivateKey } from '@shared/lib/encryption';
import { getChainById } from '@shared/constants/chains';
import { 
  Chain,
  DAppConnection, 
  DAppPermission,
  PendingRequest,
  ProviderRpcPayload,
  TransactionRequest,
  SecureWalletStorage
} from '@shared/types';

// Message types
type MessageType = 
  | 'GET_ACCOUNTS'
  | 'SIGN_TRANSACTION'
  | 'PERSONAL_SIGN'
  | 'CONNECT_DAPP'
  | 'DISCONNECT_DAPP'
  | 'DISCONNECT_ALL_DAPPS'
  | 'GET_CONNECTED_DAPPS'
  | 'SWITCH_CHAIN'
  | 'GET_CURRENT_CHAIN'
  | 'IS_UNLOCKED'
  | 'UNLOCK_WALLET'
  | 'LOCK_WALLET'
  | 'GET_PENDING_REQUEST'
  | 'APPROVE_CONNECTION'
  | 'REJECT_CONNECTION'
  | 'APPROVE_TRANSACTION'
  | 'REJECT_TRANSACTION'
  | 'APPROVE_SIGN'
  | 'REJECT_SIGN'
  | 'eth_requestAccounts'
  | 'eth_accounts'
  | 'eth_chainId'
  | 'net_version'
  | 'eth_sendTransaction'
  | 'personal_sign'
  | 'eth_signTypedData_v4'
  | 'wallet_switchEthereumChain'
  | 'wallet_requestPermissions'
  | 'wallet_getPermissions'
  | 'FUN_WALLET_BRIDGE_RPC';

interface Message {
  type: MessageType;
  payload?: unknown;
  origin?: string;
  requestId?: string;
}

interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string | { code?: number; message: string };
  pending?: boolean;
}

interface BridgeRpcRequest {
  channel: string;
  id: string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
  origin?: string;
}

// Extended pending request with callbacks for response flow
interface PendingRequestWithCallback extends PendingRequest {
  tabId?: number;
  resolve?: (result: unknown) => void;
  reject?: (error: Error) => void;
}

interface WalletPermissionDescriptor {
  parentCapability: string;
}

interface ProviderError {
  code: number;
  message: string;
}

type PermissionedMethod =
  | 'eth_sendTransaction'
  | 'personal_sign'
  | 'eth_signTypedData_v4'
  | 'wallet_switchEthereumChain';

const METHOD_PERMISSION_MAP: Record<PermissionedMethod, DAppPermission> = {
  eth_sendTransaction: 'eth_sendTransaction',
  personal_sign: 'personal_sign',
  eth_signTypedData_v4: 'eth_signTypedData',
  wallet_switchEthereumChain: 'wallet_switchEthereumChain',
};

// State
let isLocked = true;
const SUPPORTED_CHAIN_IDS = [56, 1, 137, 42161, 10, 8453, 43114, 250] as const;
const CHAIN_MAP: Map<number, Chain> = new Map(
  SUPPORTED_CHAIN_IDS
    .map((chainId) => [chainId, getChainById(chainId)] as const)
    .filter((entry): entry is readonly [number, Chain] => Boolean(entry[1]))
);

function toChainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function parseChainId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return raw;
  }

  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    const parsedHex = parseInt(trimmed, 16);
    return Number.isInteger(parsedHex) && parsedHex > 0 ? parsedHex : null;
  }

  if (/^\d+$/.test(trimmed)) {
    const parsedDec = parseInt(trimmed, 10);
    return Number.isInteger(parsedDec) && parsedDec > 0 ? parsedDec : null;
  }

  return null;
}

function isSupportedChainId(chainId: number): boolean {
  return CHAIN_MAP.has(chainId);
}

let currentChainIdDec = 56; // Default to BSC
let currentChainIdHex = toChainIdHex(currentChainIdDec);
let currentChainMeta: Chain | null = CHAIN_MAP.get(currentChainIdDec) || null;

function setCurrentChain(chainId: number): boolean {
  const chain = CHAIN_MAP.get(chainId);
  if (!chain) {
    return false;
  }
  currentChainIdDec = chainId;
  currentChainIdHex = toChainIdHex(chainId);
  currentChainMeta = chain;
  return true;
}

const connectedDApps: Map<string, DAppConnection> = new Map();
const pendingRequests: Map<string, PendingRequestWithCallback> = new Map();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toProviderError(error: unknown, fallbackCode = -32602, fallbackMessage = 'Invalid parameters'): ProviderError {
  if (typeof error === 'string') {
    return { code: fallbackCode, message: error };
  }
  if (error && typeof error === 'object') {
    const code = 'code' in error && typeof (error as { code?: unknown }).code === 'number'
      ? (error as { code: number }).code
      : fallbackCode;
    const message = 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : fallbackMessage;
    return { code, message };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

function providerErrorResponse(code: number, message: string): MessageResponse {
  return { success: false, error: { code, message } };
}

function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
}

function normalizeOrigin(origin?: string): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}

function getConnectionForOrigin(origin?: string): DAppConnection | null {
  const parsedOrigin = normalizeOrigin(origin);
  if (!parsedOrigin) return null;
  return connectedDApps.get(parsedOrigin) || null;
}

function getRequiredPermission(method: MessageType): DAppPermission | null {
  if (method in METHOD_PERMISSION_MAP) {
    return METHOD_PERMISSION_MAP[method as PermissionedMethod];
  }
  return null;
}

function getParamsRaw(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload)) {
    const paramsRaw = (payload as ProviderRpcPayload).paramsRaw;
    if (Array.isArray(paramsRaw)) {
      return paramsRaw;
    }
    if (paramsRaw !== undefined) {
      return [paramsRaw];
    }

    const params = (payload as { params?: unknown[] | Record<string, unknown> }).params;
    if (Array.isArray(params)) {
      return params;
    }
    if (params !== undefined) {
      return [params];
    }
  }
  return [];
}

function normalizeRequestPayload<T>(payload: unknown, paramsRaw: unknown[]): T | undefined {
  if (isRecord(payload) && Object.keys(payload).length > 0 && !Array.isArray(payload)) {
    if ('method' in payload || 'paramsRaw' in payload || 'params' in payload) {
      return undefined;
    }
    return payload as T;
  }
  if (paramsRaw.length === 1 && isRecord(paramsRaw[0])) {
    return paramsRaw[0] as T;
  }
  return undefined;
}

function normalizeSendTransactionPayload(payload: unknown): { tx?: TransactionRequest; error?: ProviderError } {
  const paramsRaw = getParamsRaw(payload);
  const direct = normalizeRequestPayload<TransactionRequest>(payload, paramsRaw);
  const tx = direct || (isRecord(paramsRaw[0]) ? (paramsRaw[0] as TransactionRequest) : undefined);

  if (!tx || !tx.to || typeof tx.to !== 'string') {
    return { error: { code: -32602, message: 'Invalid transaction request' } };
  }

  const normalizedTx: TransactionRequest = { ...tx };
  if (normalizedTx.chainId === undefined || normalizedTx.chainId === null || normalizedTx.chainId === '') {
    normalizedTx.chainId = currentChainIdHex;
  }

  const requestChainId = parseChainId(normalizedTx.chainId);
  if (!requestChainId) {
    return { error: { code: -32602, message: 'Invalid chainId' } };
  }

  if (!isSupportedChainId(requestChainId)) {
    return { error: { code: -32602, message: 'Unsupported chainId' } };
  }

  if (requestChainId !== currentChainIdDec) {
    return {
      error: {
        code: -32602,
        message: `Chain mismatch: wallet is on ${currentChainIdHex}, tx requested ${toChainIdHex(requestChainId)}`,
      },
    };
  }

  if (!currentChainMeta) {
    return { error: { code: -32602, message: 'Unsupported chainId' } };
  }

  normalizedTx.chainId = toChainIdHex(requestChainId);

  return { tx: normalizedTx };
}

function normalizePersonalSignPayload(payload: unknown): { message?: string; address?: string; error?: ProviderError } {
  const paramsRaw = getParamsRaw(payload);
  const direct = normalizeRequestPayload<{ message?: string; address?: string }>(payload, paramsRaw);

  if (direct?.message && typeof direct.message === 'string') {
    return { message: direct.message, address: direct.address };
  }

  const first = paramsRaw[0];
  const second = paramsRaw[1];
  if (typeof first === 'string' && typeof second === 'string') {
    if (ethers.isAddress(first) && !ethers.isAddress(second)) {
      return { message: second, address: first };
    }
    if (ethers.isAddress(second) && !ethers.isAddress(first)) {
      return { message: first, address: second };
    }
    return { message: first, address: second };
  }

  if (typeof first === 'string') {
    return { message: first };
  }

  return { error: { code: -32602, message: 'Invalid personal_sign parameters' } };
}

function normalizeTypedDataPayload(payload: unknown): { address?: string; data?: string; error?: ProviderError } {
  const paramsRaw = getParamsRaw(payload);
  const direct = normalizeRequestPayload<{ address?: string; data?: string }>(payload, paramsRaw);

  if (direct?.address && direct?.data) {
    return { address: direct.address, data: direct.data };
  }

  if (typeof paramsRaw[0] === 'string' && typeof paramsRaw[1] === 'string') {
    return { address: paramsRaw[0], data: paramsRaw[1] };
  }

  return { error: { code: -32602, message: 'Invalid eth_signTypedData_v4 parameters' } };
}

function normalizeSwitchChainPayload(payload: unknown): { chainId?: string; error?: ProviderError } {
  const paramsRaw = getParamsRaw(payload);
  const direct = normalizeRequestPayload<{ chainId?: string }>(payload, paramsRaw);
  if (direct?.chainId && typeof direct.chainId === 'string') {
    return { chainId: direct.chainId };
  }

  if (isRecord(paramsRaw[0]) && typeof paramsRaw[0].chainId === 'string') {
    return { chainId: paramsRaw[0].chainId as string };
  }

  return { error: { code: -32602, message: 'Invalid wallet_switchEthereumChain parameters' } };
}

function resolveRequestedAccount(
  connection: DAppConnection,
  preferredAccount?: string
): string | undefined {
  const allowed = new Set(connection.accounts.map((account) => account.toLowerCase()));
  if (preferredAccount && allowed.has(preferredAccount.toLowerCase())) {
    return preferredAccount;
  }
  return connection.accounts[0];
}

function ensurePermissionForMethod(method: MessageType, origin?: string): MessageResponse | null {
  const requiredPermission = getRequiredPermission(method);
  if (!requiredPermission) {
    return null;
  }

  const connection = getConnectionForOrigin(origin);
  if (!connection) {
    return providerErrorResponse(4100, 'DApp not connected');
  }

  if (!connection.permissions.includes(requiredPermission)) {
    return providerErrorResponse(4100, `Missing permission: ${requiredPermission}`);
  }

  return null;
}

async function handleBridgeRpcRequest(
  payload: unknown,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: { code: -32600, message: 'Invalid bridge payload' } };
  }

  const request = payload as BridgeRpcRequest;
  if (request.channel !== 'FUN_WALLET_RPC' || !request.id || !request.method) {
    return { success: false, error: { code: -32600, message: 'Invalid bridge request envelope' } };
  }

  const method = request.method as MessageType;
  const allowedMethods: MessageType[] = [
    'eth_chainId',
    'net_version',
    'eth_requestAccounts',
    'eth_accounts',
    'wallet_switchEthereumChain',
    'eth_sendTransaction',
    'personal_sign',
    'eth_signTypedData_v4',
    'wallet_getPermissions',
    'wallet_requestPermissions',
  ];

  if (!allowedMethods.includes(method)) {
    return {
      success: true,
      data: {
        id: request.id,
        error: { code: -32601, message: `Method not supported: ${request.method}` },
      },
    };
  }

  const rpcMessage: Message = {
    type: method,
    requestId: request.id,
    origin: request.origin || sender.tab?.url,
    payload: {
      method: request.method,
      paramsRaw: request.params,
    },
  };

  const result = await handleMessage(rpcMessage, sender, () => {});

  if (result?.success) {
    return { success: true, data: { id: request.id, result: result.data } };
  }

  if (result?.pending) {
    return { success: true, data: { id: request.id, error: { code: 4001, message: 'Pending user approval' } } };
  }

  return {
    success: true,
    data: {
      id: request.id,
      error: typeof result?.error === 'string'
        ? { code: -32603, message: result.error }
        : (result?.error || { code: -32603, message: 'Request failed' }),
    },
  };
}

/**
 * Initialize service worker
 */
async function initialize() {
  console.log('[FUN Wallet] Service worker initializing...');
  
  // Load connected DApps from storage
  const dappsJson = await chromeStorageAdapter.get(STORAGE_KEYS.DAPP_CONNECTIONS);
  if (dappsJson) {
    try {
      const dapps: DAppConnection[] = JSON.parse(dappsJson);
      dapps.forEach(dapp => connectedDApps.set(dapp.origin, dapp));
    } catch (e) {
      console.error('[FUN Wallet] Error loading DApps:', e);
    }
  }
  
  // Load chain from storage
  const storedChainId = await chromeStorageAdapter.get(STORAGE_KEYS.CURRENT_CHAIN);
  if (storedChainId) {
    const parsedChainId = parseChainId(storedChainId);
    if (parsedChainId && isSupportedChainId(parsedChainId)) {
      setCurrentChain(parsedChainId);
    }
  }
  
  console.log('[FUN Wallet] Service worker initialized');
}

/**
 * Handle incoming messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (response: MessageResponse) => void) => {
    console.log('[FUN Wallet] Message received:', message.type);
    
    handleMessage(message, sender, sendResponse)
      .then(response => {
        if (response) sendResponse(response);
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    // Return true to indicate async response
    return true;
  }
);

/**
 * Route messages to handlers
 */
async function handleMessage(
  message: Message, 
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): Promise<MessageResponse | null> {
  const origin = normalizeOrigin(message.origin || sender.tab?.url || '') || message.origin || sender.tab?.url;
  const tabId = sender.tab?.id;
  const requestId = message.requestId;
  
  switch (message.type) {
    case 'FUN_WALLET_BRIDGE_RPC':
      return handleBridgeRpcRequest(message.payload, sender);

    // Wallet state
    case 'IS_UNLOCKED':
      return { success: true, data: { unlocked: !isLocked } };
      
    case 'UNLOCK_WALLET':
      return handleUnlockWallet(message.payload as { password: string });
      
    case 'LOCK_WALLET':
      isLocked = true;
      return { success: true };
      
    // Accounts
    case 'GET_ACCOUNTS':
    case 'eth_accounts':
      return handleGetAccounts(origin);
      
    case 'eth_requestAccounts':
      return handleRequestAccounts(origin, tabId, sendResponse, requestId);
      
    // Chain
    case 'GET_CURRENT_CHAIN':
    case 'eth_chainId':
      return { success: true, data: currentChainIdHex };

    case 'net_version':
      return { success: true, data: currentChainIdDec.toString() };
      
    case 'SWITCH_CHAIN':
      return handleSwitchChain(message.payload as { chainId: string });

    case 'wallet_switchEthereumChain': {
      const permissionError = ensurePermissionForMethod('wallet_switchEthereumChain', origin);
      if (permissionError) return permissionError;
      const normalized = normalizeSwitchChainPayload(message.payload);
      if (normalized.error || !normalized.chainId) {
        return providerErrorResponse(normalized.error?.code || -32602, normalized.error?.message || 'Invalid chainId');
      }
      return handleSwitchChain({ chainId: normalized.chainId });
    }

    case 'wallet_requestPermissions':
      return handleWalletRequestPermissions(message.payload as Array<{ eth_accounts?: Record<string, never> }>, origin, tabId, sendResponse, requestId);

    case 'wallet_getPermissions':
      return handleWalletGetPermissions(origin);
      
    // Transactions
    case 'eth_sendTransaction':
    case 'SIGN_TRANSACTION': {
      const permissionError = message.type === 'eth_sendTransaction'
        ? ensurePermissionForMethod('eth_sendTransaction', origin)
        : null;
      if (permissionError) return permissionError;

      const normalized = normalizeSendTransactionPayload(message.payload);
      if (normalized.error || !normalized.tx) {
        return providerErrorResponse(normalized.error?.code || -32602, normalized.error?.message || 'Invalid transaction');
      }
      return handleSendTransaction(normalized.tx, origin, tabId, sendResponse, requestId);
    }
      
    // Signing
    case 'personal_sign':
    case 'PERSONAL_SIGN': {
      const permissionError = message.type === 'personal_sign'
        ? ensurePermissionForMethod('personal_sign', origin)
        : null;
      if (permissionError) return permissionError;

      const normalized = normalizePersonalSignPayload(message.payload);
      if (normalized.error || !normalized.message) {
        return providerErrorResponse(normalized.error?.code || -32602, normalized.error?.message || 'Invalid personal_sign request');
      }

      return handlePersonalSign(
        { message: normalized.message, address: normalized.address },
        origin,
        tabId,
        sendResponse,
        requestId
      );
    }
      
    case 'eth_signTypedData_v4': {
      const permissionError = ensurePermissionForMethod('eth_signTypedData_v4', origin);
      if (permissionError) return permissionError;

      const normalized = normalizeTypedDataPayload(message.payload);
      if (normalized.error || !normalized.address || !normalized.data) {
        return providerErrorResponse(normalized.error?.code || -32602, normalized.error?.message || 'Invalid typed data request');
      }

      return handleSignTypedData(
        { address: normalized.address, data: normalized.data },
        origin,
        tabId,
        sendResponse,
        requestId
      );
    }
      
    // Pending request management
    case 'GET_PENDING_REQUEST':
      return handleGetPendingRequest(message.payload as { requestId: string });
      
    // Connection approval from popup
    case 'APPROVE_CONNECTION':
      return handleApproveConnection(message.payload as { requestId: string; origin: string });
      
    case 'REJECT_CONNECTION':
      return handleRejectConnection(message.payload as { requestId: string });
      
    // Transaction approval from popup
    case 'APPROVE_TRANSACTION':
      return handleApproveTransaction(message.payload as { requestId: string; signedTx?: string; txHash?: string });
      
    case 'REJECT_TRANSACTION':
      return handleRejectTransaction(message.payload as { requestId: string });
      
    // Sign approval from popup  
    case 'APPROVE_SIGN':
      return handleApproveSign(message.payload as { requestId: string; signature: string });
      
    case 'REJECT_SIGN':
      return handleRejectSign(message.payload as { requestId: string });
      
    // DApp management
    case 'CONNECT_DAPP':
      return handleConnectDApp(origin!, message.payload as { requestId?: string });
      
    case 'DISCONNECT_DAPP':
      return handleDisconnectDApp(message.payload as { origin: string });
      
    case 'DISCONNECT_ALL_DAPPS':
      return handleDisconnectAllDApps();
      
    case 'GET_CONNECTED_DAPPS':
      return { success: true, data: Array.from(connectedDApps.values()) };
      
    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

/**
 * Unlock wallet with password - REAL verification
 */
async function handleUnlockWallet(payload: { password: string }): Promise<MessageResponse> {
  if (!payload?.password) {
    return { success: false, error: 'Password required' };
  }

  try {
    // Get encrypted wallet data
    const encryptedData = await chromeStorageAdapter.get(STORAGE_KEYS.ENCRYPTED_KEYS);
    
    if (!encryptedData) {
      return { success: false, error: 'No wallet found' };
    }

    // Parse and verify password by attempting decryption
    const parsed: SecureWalletStorage = JSON.parse(encryptedData);
    const addresses = Object.keys(parsed.wallets);
    
    if (addresses.length === 0) {
      return { success: false, error: 'No wallet found' };
    }

    // Try to decrypt first wallet to verify password
    const testKeyData = parsed.wallets[addresses[0]];
    await decryptPrivateKey(testKeyData, payload.password);
    
    // Password correct - unlock wallet
    isLocked = false;
    
    // Update last activity
    await chromeStorageAdapter.set(
      STORAGE_KEYS.LAST_ACTIVITY, 
      Date.now().toString()
    );

    console.log('[FUN Wallet] Wallet unlocked successfully');
    return { success: true };
  } catch (error) {
    console.error('[FUN Wallet] Unlock failed:', error);
    return { success: false, error: 'Mật khẩu không đúng' };
  }
}

/**
 * Get connected accounts for origin
 */
async function handleGetAccounts(origin?: string): Promise<MessageResponse> {
  if (isLocked) {
    return { success: true, data: [] };
  }
  
  if (origin) {
    try {
      const url = new URL(origin);
      const connection = connectedDApps.get(url.origin);
      if (!connection) {
        return { success: true, data: [] };
      }
      return { success: true, data: connection.accounts || [] };
    } catch {
      // Invalid origin
    }
  }
  
  // Get active wallet address
  const activeWallet = await chromeStorageAdapter.get(STORAGE_KEYS.ACTIVE_WALLET);
  
  return { 
    success: true, 
    data: activeWallet ? [activeWallet] : [] 
  };
}

function getDefaultPermissionsForConnection(): DAppConnection['permissions'] {
  return [
    'eth_accounts',
    'eth_sendTransaction',
    'personal_sign',
    'eth_signTypedData',
    'wallet_switchEthereumChain',
  ];
}

function toWalletPermissions(permissions: DAppConnection['permissions']): WalletPermissionDescriptor[] {
  const result: WalletPermissionDescriptor[] = [];
  if (permissions.includes('eth_accounts')) {
    result.push({ parentCapability: 'eth_accounts' });
  }
  return result;
}

/**
 * Handle eth_requestAccounts - prompt user to connect
 */
async function handleRequestAccounts(
  origin?: string, 
  tabId?: number,
  sendResponse?: (response: MessageResponse) => void,
  dappRequestId?: string,
  requestMethod: 'eth_requestAccounts' | 'wallet_requestPermissions' = 'eth_requestAccounts'
): Promise<MessageResponse> {
  if (!origin) {
    return { success: false, error: 'Origin required' };
  }
  
  // Parse origin URL
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    parsedOrigin = origin;
  }
  
  // Check if already connected
  if (connectedDApps.has(parsedOrigin)) {
    return handleGetAccounts(parsedOrigin);
  }
  
  // Create pending request with callback
  const requestId = dappRequestId || `connect_${Date.now()}`;
  const request: PendingRequestWithCallback = {
    id: requestId,
    method: requestMethod,
    params: [],
    origin: parsedOrigin,
    timestamp: Date.now(),
    tabId,
  };
  
  pendingRequests.set(requestId, request);
  
  if (isLocked) {
    // Open unlock and then redirect to connection approval page
    await openPopupWithUnlockRedirect('connect', { requestId, origin: parsedOrigin });
  } else {
    // Open popup for user approval
    await openPopup('connect', { requestId, origin: parsedOrigin });
  }

  // Keep dApp request pending until user approves/rejects in popup
  return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
}

/**
 * Get pending request by ID
 */
function handleGetPendingRequest(payload: { requestId: string }): MessageResponse {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  return { success: true, data: request };
}

/**
 * Handle connection approval from popup
 */
async function handleApproveConnection(payload: { requestId: string; origin: string; accounts?: string[]; permissions?: DAppConnection['permissions'] }): Promise<MessageResponse> {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found or expired' };
  }

  const parsedOrigin = normalizeOrigin(payload.origin);
  if (!parsedOrigin) {
    return providerErrorResponse(-32602, 'Invalid origin');
  }
  
  // Create connection
  const activeWallet = await chromeStorageAdapter.get(STORAGE_KEYS.ACTIVE_WALLET);
  const selectedAccounts = Array.isArray(payload.accounts) ? payload.accounts.filter(Boolean) : [];
  const accounts = selectedAccounts.length > 0
    ? selectedAccounts
    : (activeWallet ? [activeWallet] : []);
  const permissions = payload.permissions && payload.permissions.length > 0
    ? payload.permissions
    : getDefaultPermissionsForConnection();

  const connection: DAppConnection = {
    origin: parsedOrigin,
    name: new URL(parsedOrigin).hostname,
    connectedAt: Date.now(),
    permissions,
    chainId: currentChainIdDec,
    accounts,
  };
  
  connectedDApps.set(parsedOrigin, connection);
  await saveDAppConnections();
  
  const walletPermissionResult = toWalletPermissions(connection.permissions);
  const approvalResult = request.method === 'wallet_requestPermissions'
    ? walletPermissionResult
    : connection.accounts;

  // Send response to content script
  if (request.tabId) {
    chrome.tabs.sendMessage(request.tabId, {
      type: 'FUN_WALLET_RESPONSE',
      requestId: payload.requestId,
      result: approvalResult,
    }).catch(console.error);
  }
  
  // Clean up
  pendingRequests.delete(payload.requestId);
  
  // Emit connect event
  notifyTabs('connect', { chainId: currentChainIdHex });
  notifyTabs('accountsChanged', connection.accounts);
  
  return { success: true, data: approvalResult };
}

async function handleWalletRequestPermissions(
  _payload: Array<{ eth_accounts?: Record<string, never> }> | undefined,
  origin?: string,
  tabId?: number,
  sendResponse?: (response: MessageResponse) => void,
  dappRequestId?: string
): Promise<MessageResponse> {
  const connectResponse = await handleRequestAccounts(origin, tabId, sendResponse, dappRequestId, 'wallet_requestPermissions');
  if (connectResponse.success) {
    return { success: true, data: [{ parentCapability: 'eth_accounts' }] };
  }
  return connectResponse;
}

function handleWalletGetPermissions(origin?: string): MessageResponse {
  if (!origin) {
    return { success: true, data: [] };
  }

  try {
    const parsedOrigin = new URL(origin).origin;
    const connection = connectedDApps.get(parsedOrigin);
    if (!connection) {
      return { success: true, data: [] };
    }
    return { success: true, data: toWalletPermissions(connection.permissions) };
  } catch {
    return { success: true, data: [] };
  }
}

/**
 * Handle connection rejection from popup
 */
function handleRejectConnection(payload: { requestId: string }): MessageResponse {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  
  // Send error to content script
  if (request.tabId) {
    chrome.tabs.sendMessage(request.tabId, {
      type: 'FUN_WALLET_RESPONSE',
      requestId: payload.requestId,
      error: 'User rejected connection',
    }).catch(console.error);
  }
  
  pendingRequests.delete(payload.requestId);
  return { success: true };
}

/**
 * Handle chain switching
 */
async function handleSwitchChain(payload: { chainId: string }): Promise<MessageResponse> {
  if (!payload?.chainId || typeof payload.chainId !== 'string') {
    return providerErrorResponse(-32602, 'Invalid chainId');
  }

  const chainId = parseChainId(payload.chainId);
  if (!chainId) {
    return providerErrorResponse(-32602, 'Invalid chainId');
  }

  if (!isSupportedChainId(chainId)) {
    return providerErrorResponse(-32602, 'Unsupported chainId');
  }

  setCurrentChain(chainId);
  await chromeStorageAdapter.set(STORAGE_KEYS.CURRENT_CHAIN, chainId.toString());
  
  // Notify all connected tabs
  notifyTabs('chainChanged', currentChainIdHex);
  
  return { success: true };
}

/**
 * Handle transaction sending
 * If wallet is locked, opens unlock popup with redirect to approve-tx
 */
async function handleSendTransaction(
  tx: TransactionRequest, 
  origin?: string, 
  tabId?: number,
  sendResponse?: (response: MessageResponse) => void,
  dappRequestId?: string
): Promise<MessageResponse> {
  const parsedOrigin = normalizeOrigin(origin);

  if (!parsedOrigin) {
    return providerErrorResponse(-32602, 'Origin required');
  }

  const connection = connectedDApps.get(parsedOrigin);
  if (!connection) {
    return providerErrorResponse(4100, 'DApp not connected');
  }

  const requestedFrom = tx.from && ethers.isAddress(tx.from) ? tx.from : undefined;
  const selectedAccount = resolveRequestedAccount(connection, requestedFrom);
  if (!selectedAccount) {
    return providerErrorResponse(4100, 'No permitted account available');
  }

  if (requestedFrom && requestedFrom.toLowerCase() !== selectedAccount.toLowerCase()) {
    return providerErrorResponse(4100, 'Requested account is not authorized');
  }
  
  // Build params for approve-tx page
  const txParams: Record<string, string> = {
    to: tx.to || '',
    value: tx.value || '0',
    origin: parsedOrigin || 'unknown',
    from: selectedAccount,
  };
  
  if (tx.data) {
    txParams.data = tx.data;
  }
  
  // Create pending request
  const requestId = dappRequestId || `tx_${Date.now()}`;
  pendingRequests.set(requestId, {
    id: requestId,
    method: 'eth_sendTransaction',
    params: [{ ...tx, from: selectedAccount }],
    origin: parsedOrigin,
    timestamp: Date.now(),
    tabId,
    requestedAccount: selectedAccount,
    requiredPermission: 'eth_sendTransaction',
  });
  
  txParams.requestId = requestId;
  
  // If wallet is locked, open unlock popup with redirect to approve-tx
  if (isLocked) {
    await openPopupWithUnlockRedirect('approve-tx', txParams);
    return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
  }
  
  // Wallet is unlocked, open approve-tx directly
  await openPopup('approve-tx', txParams);
  
  return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
}

/**
 * Handle transaction approval from popup
 */
async function handleApproveTransaction(payload: { requestId: string; signedTx?: string; txHash?: string }): Promise<MessageResponse> {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found or expired' };
  }

  if (!isTxHash(payload.txHash)) {
    if (request.tabId) {
      chrome.tabs.sendMessage(request.tabId, {
        type: 'FUN_WALLET_RESPONSE',
        requestId: payload.requestId,
        error: 'Invalid transaction hash from wallet',
      }).catch(console.error);
    }
    pendingRequests.delete(payload.requestId);
    return providerErrorResponse(-32603, 'Invalid transaction hash from wallet');
  }
  
  // Send tx hash to content script
  if (request.tabId) {
    chrome.tabs.sendMessage(request.tabId, {
      type: 'FUN_WALLET_RESPONSE',
      requestId: payload.requestId,
      result: payload.txHash,
    }).catch(console.error);
  }
  
  pendingRequests.delete(payload.requestId);
  return { success: true, data: payload.txHash };
}

/**
 * Handle transaction rejection from popup
 */
function handleRejectTransaction(payload: { requestId: string }): MessageResponse {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  
  if (request.tabId) {
    chrome.tabs.sendMessage(request.tabId, {
      type: 'FUN_WALLET_RESPONSE',
      requestId: payload.requestId,
      error: 'User rejected transaction',
    }).catch(console.error);
  }
  
  pendingRequests.delete(payload.requestId);
  return { success: true };
}

/**
 * Handle personal sign
 * If wallet is locked, opens unlock popup with redirect to approve-sign
 */
async function handlePersonalSign(
  payload: { message: string; address?: string },
  origin?: string,
  tabId?: number,
  sendResponse?: (response: MessageResponse) => void,
  dappRequestId?: string
): Promise<MessageResponse> {
  const parsedOrigin = normalizeOrigin(origin);
  if (!parsedOrigin) {
    return providerErrorResponse(-32602, 'Origin required');
  }

  const connection = connectedDApps.get(parsedOrigin);
  if (!connection) {
    return providerErrorResponse(4100, 'DApp not connected');
  }

  const requestedAddress = payload.address && ethers.isAddress(payload.address)
    ? payload.address
    : undefined;
  const selectedAccount = resolveRequestedAccount(connection, requestedAddress);
  if (!selectedAccount) {
    return providerErrorResponse(4100, 'No permitted account available');
  }

  if (requestedAddress && requestedAddress.toLowerCase() !== selectedAccount.toLowerCase()) {
    return providerErrorResponse(4100, 'Requested account is not authorized');
  }
  
  // Create pending request
  const requestId = dappRequestId || `sign_${Date.now()}`;
  pendingRequests.set(requestId, {
    id: requestId,
    method: 'personal_sign',
    params: [payload.message, selectedAccount],
    origin: parsedOrigin,
    timestamp: Date.now(),
    tabId,
    requestedAccount: selectedAccount,
    requiredPermission: 'personal_sign',
  });
  
  const signParams = { 
    requestId, 
    message: payload.message,
    address: selectedAccount,
    origin: parsedOrigin,
    method: 'personal_sign',
  };
  
  // If wallet is locked, open unlock popup with redirect
  if (isLocked) {
    await openPopupWithUnlockRedirect('approve-sign', signParams);
    return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
  }
  
  // Open popup for user approval
  await openPopup('approve-sign', signParams);
  
  return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
}

/**
 * Handle typed data signing (EIP-712)
 * If wallet is locked, opens unlock popup with redirect to approve-sign
 */
async function handleSignTypedData(
  payload: { address: string; data: string },
  origin?: string,
  tabId?: number,
  sendResponse?: (response: MessageResponse) => void,
  dappRequestId?: string
): Promise<MessageResponse> {
  const parsedOrigin = normalizeOrigin(origin);
  if (!parsedOrigin) {
    return providerErrorResponse(-32602, 'Origin required');
  }

  const connection = connectedDApps.get(parsedOrigin);
  if (!connection) {
    return providerErrorResponse(4100, 'DApp not connected');
  }

  const requestedAddress = payload.address && ethers.isAddress(payload.address)
    ? payload.address
    : undefined;
  if (!requestedAddress) {
    return providerErrorResponse(-32602, 'Invalid signer address');
  }

  const selectedAccount = resolveRequestedAccount(connection, requestedAddress);
  if (!selectedAccount) {
    return providerErrorResponse(4100, 'No permitted account available');
  }

  if (requestedAddress.toLowerCase() !== selectedAccount.toLowerCase()) {
    return providerErrorResponse(4100, 'Requested account is not authorized');
  }
  
  // Create pending request
  const requestId = dappRequestId || `signTyped_${Date.now()}`;
  pendingRequests.set(requestId, {
    id: requestId,
    method: 'eth_signTypedData_v4',
    params: [selectedAccount, payload.data],
    origin: parsedOrigin,
    timestamp: Date.now(),
    tabId,
    requestedAccount: selectedAccount,
    requiredPermission: 'eth_signTypedData',
  });
  
  const signParams = { 
    requestId, 
    message: payload.data,
    address: selectedAccount,
    origin: parsedOrigin,
    method: 'eth_signTypedData_v4',
  };
  
  // If wallet is locked, open unlock popup with redirect
  if (isLocked) {
    await openPopupWithUnlockRedirect('approve-sign', signParams);
    return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
  }
  
  // Open popup for user approval
  await openPopup('approve-sign', signParams);
  
  return { success: false, pending: true, error: { code: 4001, message: 'Pending user approval' } };
}

/**
 * Handle sign approval from popup
 */
async function handleApproveSign(payload: { requestId: string; signature: string }): Promise<MessageResponse> {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found or expired' };
  }
  
  // Send signature to content script
  if (request.tabId) {
    chrome.tabs.sendMessage(request.tabId, {
      type: 'FUN_WALLET_RESPONSE',
      requestId: payload.requestId,
      result: payload.signature,
    }).catch(console.error);
  }
  
  pendingRequests.delete(payload.requestId);
  return { success: true, data: { signature: payload.signature } };
}

/**
 * Handle sign rejection from popup
 */
function handleRejectSign(payload: { requestId: string }): MessageResponse {
  const request = pendingRequests.get(payload.requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  
  if (request.tabId) {
    chrome.tabs.sendMessage(request.tabId, {
      type: 'FUN_WALLET_RESPONSE',
      requestId: payload.requestId,
      error: 'User rejected signing',
    }).catch(console.error);
  }
  
  pendingRequests.delete(payload.requestId);
  return { success: true };
}

/**
 * Connect DApp
 */
async function handleConnectDApp(origin: string, payload?: { requestId?: string }): Promise<MessageResponse> {
  const parsedOrigin = normalizeOrigin(origin);
  if (!parsedOrigin) {
    return providerErrorResponse(-32602, 'Invalid origin');
  }
  
  const connection: DAppConnection = {
    origin: parsedOrigin,
    name: new URL(parsedOrigin).hostname,
    connectedAt: Date.now(),
    permissions: ['eth_accounts'],
    chainId: currentChainIdDec,
    accounts: [],
  };
  
  // Get active wallet
  const activeWallet = await chromeStorageAdapter.get(STORAGE_KEYS.ACTIVE_WALLET);
  if (activeWallet) {
    connection.accounts = [activeWallet];
  }
  
  connectedDApps.set(parsedOrigin, connection);
  
  // Persist to storage
  await saveDAppConnections();
  
  return { success: true, data: connection };
}

/**
 * Disconnect DApp
 */
async function handleDisconnectDApp(payload: { origin: string }): Promise<MessageResponse> {
  const parsedOrigin = normalizeOrigin(payload.origin);
  if (!parsedOrigin) {
    return providerErrorResponse(-32602, 'Invalid origin');
  }
  connectedDApps.delete(parsedOrigin);
  await saveDAppConnections();
  
  // Notify tabs
  notifyTabs('disconnect', { code: 4900, message: 'Disconnected' });
  
  return { success: true };
}

/**
 * Disconnect all DApps
 */
async function handleDisconnectAllDApps(): Promise<MessageResponse> {
  connectedDApps.clear();
  await saveDAppConnections();
  
  notifyTabs('disconnect', { code: 4900, message: 'Disconnected' });
  
  return { success: true };
}

/**
 * Save DApp connections to storage
 */
async function saveDAppConnections(): Promise<void> {
  const dapps = Array.from(connectedDApps.values());
  await chromeStorageAdapter.set(STORAGE_KEYS.DAPP_CONNECTIONS, JSON.stringify(dapps));
}

/**
 * Open popup window
 */
async function openPopup(page: string, params?: Record<string, unknown>): Promise<void> {
  const queryString = params 
    ? `?${new URLSearchParams(params as Record<string, string>).toString()}`
    : '';
    
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html#/${page}${queryString}`),
    type: 'popup',
    width: 360,
    height: 600,
    focused: true,
  });
}

/**
 * Open popup with unlock redirect
 * If wallet is locked, opens unlock page first
 * After unlock, automatically redirects to target page with params
 */
async function openPopupWithUnlockRedirect(
  targetPage: string, 
  params: Record<string, unknown>
): Promise<void> {
  const queryString = new URLSearchParams(params as Record<string, string>).toString();
  const redirectPath = `${targetPage}?${queryString}`;
  
  // Encode redirect path to pass through URL
  const encodedRedirect = encodeURIComponent(redirectPath);
  
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html#/unlock?redirect=${encodedRedirect}`),
    type: 'popup',
    width: 360,
    height: 600,
    focused: true,
  });
}

/**
 * Notify all tabs of events
 */
function notifyTabs(eventType: string, data: unknown): void {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: eventType,
          ...(eventType === 'chainChanged' ? { chainId: data } : {}),
          ...(eventType === 'accountsChanged' ? { accounts: data } : {}),
          ...(eventType === 'disconnect' || eventType === 'connect' ? data as object : {}),
        }).catch(() => {
          // Tab might not have content script
        });
      }
    });
  });
}

// Initialize
initialize();

// Auto-lock after inactivity (15 minutes)
setInterval(async () => {
  if (!isLocked) {
    const lastActivity = await chromeStorageAdapter.get(STORAGE_KEYS.LAST_ACTIVITY);
    if (lastActivity) {
      const elapsed = Date.now() - parseInt(lastActivity);
      const autoLockMs = 15 * 60 * 1000; // 15 minutes
      
      if (elapsed > autoLockMs) {
        console.log('[FUN Wallet] Auto-locking due to inactivity');
        isLocked = true;
      }
    }
  }
}, 60000); // Check every minute

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[FUN Wallet] Extension installed:', details.reason);
});
