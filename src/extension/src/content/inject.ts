/**
 * FUN Wallet - Content Script Bridge
 *
 * Bridges page-context inpage provider <-> extension background.
 */

const BRIDGE_CHANNEL = 'FUN_WALLET_RPC';

interface BridgeRequestMessage {
  channel: typeof BRIDGE_CHANNEL;
  direction: 'from_inpage';
  id: string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface BridgeResponseMessage {
  channel: typeof BRIDGE_CHANNEL;
  direction: 'to_inpage';
  id: string;
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown } | string;
}

interface BridgeEventMessage {
  channel: typeof BRIDGE_CHANNEL;
  direction: 'to_inpage_event';
  event: 'chainChanged' | 'accountsChanged' | 'disconnect' | 'connect';
  data?: unknown;
}

interface BackgroundBridgeResult {
  id: string;
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown } | string;
}

interface PendingRpcRequest {
  method: string;
}

const pendingRpcRequests = new Map<string, PendingRpcRequest>();

function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('FUN_WALLET_DEBUG') === '1';
  } catch {
    return false;
  }
}

function debugLog(message: string, payload?: unknown) {
  if (!isDebugEnabled()) return;
  if (payload === undefined) {
    console.log(`[FUN Wallet][bridge] ${message}`);
    return;
  }
  console.log(`[FUN Wallet][bridge] ${message}`, payload);
}

function sanitizeTxParams(params: unknown): Record<string, unknown> {
  const tx = Array.isArray(params) ? params[0] : params;
  if (!tx || typeof tx !== 'object') {
    return {};
  }
  const record = tx as Record<string, unknown>;
  return {
    from: typeof record.from === 'string' ? record.from : undefined,
    to: typeof record.to === 'string' ? record.to : undefined,
    value: typeof record.value === 'string' ? record.value : undefined,
    dataLength: typeof record.data === 'string' ? record.data.length : undefined,
  };
}

function isHexTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
}

function injectProvider() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inpage.js');
    script.type = 'text/javascript';
    script.onload = () => script.remove();
    script.onerror = (error) => {
      console.error('[FUN Wallet] Failed to load inpage script:', error);
    };

    const container = document.documentElement || document.head;
    container.appendChild(script);
  } catch (error) {
    console.error('[FUN Wallet] Failed to inject provider:', error);
  }
}

window.addEventListener('message', async (event) => {
  const data = event.data as BridgeRequestMessage;
  if (event.source !== window || !data) return;
  if (data.channel !== BRIDGE_CHANNEL) return;
  if (data.direction !== 'from_inpage') return;
  if (!data.id || !data.method) return;
  const isSendTx = data.method === 'eth_sendTransaction';

  if (isSendTx) {
    debugLog(`request ${data.method} (${data.id})`, sanitizeTxParams(data.params));
  }

  try {
    const response = await new Promise<{ success?: boolean; data?: BackgroundBridgeResult; error?: unknown }>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'FUN_WALLET_BRIDGE_RPC',
          payload: {
            channel: BRIDGE_CHANNEL,
            id: data.id,
            method: data.method,
            params: data.params,
            origin: window.location.origin,
          },
        },
        (bridgeResponse) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(bridgeResponse || { error: 'No response from background' });
        }
      );
    });

    const result = response?.data;
    const outbound: BridgeResponseMessage = {
      channel: BRIDGE_CHANNEL,
      direction: 'to_inpage',
      id: data.id,
    };

    if (result?.error || response.error) {
      const normalizedError = result?.error || (typeof response.error === 'string'
        ? { code: -32603, message: response.error }
        : { code: -32603, message: 'Bridge error' });

      const pendingCode = typeof normalizedError === 'object' && normalizedError && 'code' in normalizedError
        ? (normalizedError as { code?: number }).code
        : undefined;

      if (isSendTx && pendingCode === 4001) {
        pendingRpcRequests.set(data.id, { method: data.method });
        debugLog(`pending user approval ${data.method} (${data.id})`);
        return;
      }

      if (isSendTx) {
        debugLog(`error ${data.method} (${data.id})`, normalizedError);
      }

      outbound.error = normalizedError;
    } else {
      if (isSendTx) {
        debugLog(`response ${data.method} (${data.id})`, result?.result);
      }
      outbound.result = result?.result;
    }

    window.postMessage(outbound, '*');
  } catch (error) {
    const outbound: BridgeResponseMessage = {
      channel: BRIDGE_CHANNEL,
      direction: 'to_inpage',
      id: data.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Bridge error',
      },
    };
    if (isSendTx) {
      debugLog(`bridge exception ${data.method} (${data.id})`, outbound.error);
    }
    window.postMessage(outbound, '*');
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.type) return;

  const pushEvent = (eventName: BridgeEventMessage['event'], payload: unknown) => {
    const eventMessage: BridgeEventMessage = {
      channel: BRIDGE_CHANNEL,
      direction: 'to_inpage_event',
      event: eventName,
      data: payload,
    };
    window.postMessage(eventMessage, '*');
  };

  switch (message.type) {
    case 'FUN_WALLET_RESPONSE': {
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      if (!requestId) break;

      const pending = pendingRpcRequests.get(requestId);
      if (!pending) break;

      const outbound: BridgeResponseMessage = {
        channel: BRIDGE_CHANNEL,
        direction: 'to_inpage',
        id: requestId,
      };

      if (message.result !== undefined) {
        if (isHexTxHash(message.result)) {
          outbound.result = message.result;
          debugLog(`resolved ${pending.method} (${requestId})`, { txHash: message.result });
        } else {
          outbound.error = { code: -32603, message: 'Invalid transaction hash from wallet' };
          debugLog(`invalid tx hash ${pending.method} (${requestId})`, message.result);
        }
      } else if (message.error) {
        outbound.error = typeof message.error === 'string'
          ? { code: 4001, message: message.error }
          : { code: -32603, message: 'Request failed' };
        debugLog(`rejected ${pending.method} (${requestId})`, outbound.error);
      } else {
        outbound.error = { code: -32603, message: 'Missing response payload' };
        debugLog(`missing response payload ${pending.method} (${requestId})`);
      }

      pendingRpcRequests.delete(requestId);
      window.postMessage(outbound, '*');
      break;
    }
    case 'chainChanged':
      pushEvent('chainChanged', message.chainId);
      break;
    case 'accountsChanged':
      pushEvent('accountsChanged', message.accounts);
      break;
    case 'disconnect':
      pushEvent('disconnect', { code: 4900, message: 'Disconnected' });
      break;
    case 'connect':
      pushEvent('connect', { chainId: message.chainId });
      break;
    default:
      break;
  }
});

if (document.readyState === 'loading') {
  injectProvider();
} else {
  injectProvider();
}
