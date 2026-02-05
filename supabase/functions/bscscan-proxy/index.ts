import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

type ActionType = 'txlist' | 'tokentx';

interface JsonRpcTransfer {
  hash?: string;
  from?: string;
  to?: string;
  value?: string | number;
  blockNum?: string;
  blockTimeStamp?: number | string;
  decimal?: string;
  asset?: string;
  rawContract?: {
    address?: string;
  };
}

interface JsonRpcResult {
  transfers?: JsonRpcTransfer[];
}

interface JsonRpcResponse {
  result?: JsonRpcResult;
  error?: unknown;
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

const API_KEY = Deno.env.get('MEGANODE_API_KEY') || '';
const PROXY_API_KEY = Deno.env.get('BSCSCAN_PROXY_API_KEY') || '';
const MEGANODE_API = `https://bsc-mainnet.nodereal.io/v1/${API_KEY}`;
const MAX_OFFSET = 100;
const MAX_PAGE = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateLimitStore = new Map<string, RateLimitState>();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-funwallet-api-key',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getAuthToken(req: Request): string | null {
  const directHeader = req.headers.get('x-funwallet-api-key');
  if (directHeader) return directHeader.trim();

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1].trim() : null;
}

function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? Math.trunc(value)
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : fallback;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeAction(action: unknown): ActionType | null {
  if (action === 'txlist' || action === 'tokentx') {
    return action;
  }
  return null;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('cf-connecting-ip') || 'unknown';
}

function checkRateLimit(rateKey: string): boolean {
  const now = Date.now();
  const existing = rateLimitStore.get(rateKey);

  if (!existing || now > existing.resetAt) {
    rateLimitStore.set(rateKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  existing.count += 1;
  rateLimitStore.set(rateKey, existing);
  return true;
}

function toDecimalFromHex(value: string | undefined, fallback = '0'): string {
  if (!value || typeof value !== 'string') return fallback;
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return fallback;
  try {
    return BigInt(value).toString(10);
  } catch {
    return fallback;
  }
}

function decimalToBaseUnit(value: string, decimals: number): string {
  if (!value) return '0';
  const sanitized = value.trim();
  if (!sanitized) return '0';

  if (/^\d+$/.test(sanitized)) {
    return sanitized;
  }

  if (!/^\d+(\.\d+)?$/.test(sanitized)) {
    return '0';
  }

  const [integerPartRaw, fractionPartRaw = ''] = sanitized.split('.');
  const integerPart = integerPartRaw.replace(/^0+/, '') || '0';
  const fractionPart = fractionPartRaw.slice(0, decimals).padEnd(decimals, '0');
  const combined = `${integerPart}${fractionPart}`.replace(/^0+/, '');
  return combined || '0';
}

function normalizeTransferValue(tx: JsonRpcTransfer): string {
  const decimals = Number.parseInt(toDecimalFromHex(tx.decimal, '0'), 10) || 18;

  if (typeof tx.value === 'number') {
    return decimalToBaseUnit(tx.value.toString(), decimals);
  }

  if (typeof tx.value === 'string') {
    if (tx.value.startsWith('0x')) {
      return toDecimalFromHex(tx.value, '0');
    }
    return decimalToBaseUnit(tx.value, decimals);
  }

  return '0';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (PROXY_API_KEY) {
      const requestToken = getAuthToken(req);
      if (!requestToken || requestToken !== PROXY_API_KEY) {
        return jsonResponse({ error: 'Unauthorized', status: '0', result: [] }, 401);
      }
    }

    const body = await req.json();
    const address = typeof body?.address === 'string' ? body.address.trim() : '';
    const action = normalizeAction(body?.action);
    const page = parsePositiveInt(body?.page, 1, 1, MAX_PAGE);
    const offset = parsePositiveInt(body?.offset, 50, 10, MAX_OFFSET);

    if (!isValidAddress(address)) {
      return jsonResponse({ error: 'Invalid address', status: '0', result: [] }, 400);
    }
    if (!action) {
      return jsonResponse({ error: 'Invalid action', status: '0', result: [] }, 400);
    }

    const clientIp = getClientIp(req);
    const rateKey = `${clientIp}:${address.toLowerCase()}`;
    if (!checkRateLimit(rateKey)) {
      return jsonResponse({ error: 'Rate limit exceeded', status: '0', result: [] }, 429);
    }

    const category = action === 'tokentx' ? ['20'] : ['external'];
    const halfOffset = Math.max(Math.floor(offset / 2), 10);

    const [sentResponse, receivedResponse] = await Promise.all([
      fetch(MEGANODE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'nr_getAssetTransfers',
          params: [{
            fromAddress: address,
            category,
            maxCount: `0x${halfOffset.toString(16)}`,
            order: 'desc',
          }],
        }),
      }),
      fetch(MEGANODE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'nr_getAssetTransfers',
          params: [{
            toAddress: address,
            category,
            maxCount: `0x${halfOffset.toString(16)}`,
            order: 'desc',
          }],
        }),
      }),
    ]);

    const [sentData, receivedData] = await Promise.all([
      sentResponse.json() as Promise<JsonRpcResponse>,
      receivedResponse.json() as Promise<JsonRpcResponse>,
    ]);

    if (sentData.error || receivedData.error) {
      console.error('[MegaNode] API Error:', sentData.error || receivedData.error);
    }

    const sentTransfers = sentData.result?.transfers || [];
    const receivedTransfers = receivedData.result?.transfers || [];
    const allTransfers = [...sentTransfers, ...receivedTransfers];

    if (allTransfers.length === 0) {
      return jsonResponse({ status: '1', message: 'OK', result: [] });
    }

    allTransfers.sort((a, b) => {
      const blockA = BigInt(toDecimalFromHex(a.blockNum, '0'));
      const blockB = BigInt(toDecimalFromHex(b.blockNum, '0'));
      if (blockA === blockB) return 0;
      return blockA > blockB ? -1 : 1;
    });

    const seenHashes = new Set<string>();
    const uniqueTransfers = allTransfers.filter((tx) => {
      const txHash = tx.hash || '';
      if (!txHash || seenHashes.has(txHash)) {
        return false;
      }
      seenHashes.add(txHash);
      return true;
    });

    const transformedResult = uniqueTransfers.map((tx) => {
      const tokenDecimal = toDecimalFromHex(tx.decimal, '18');
      const blockNumber = toDecimalFromHex(tx.blockNum, '0');
      const timeStamp = tx.blockTimeStamp !== undefined && tx.blockTimeStamp !== null
        ? String(tx.blockTimeStamp)
        : String(Math.floor(Date.now() / 1000));

      return {
        hash: tx.hash || '',
        from: tx.from || '',
        to: tx.to || '',
        value: normalizeTransferValue(tx),
        timeStamp,
        blockNumber,
        gasUsed: '21000',
        gasPrice: '10000000000',
        isError: '0',
        txreceipt_status: '1',
        tokenSymbol: tx.asset || (action === 'tokentx' ? 'TOKEN' : 'BNB'),
        tokenDecimal,
        tokenName: tx.asset || 'BNB',
        contractAddress: tx.rawContract?.address || '',
      };
    });

    return jsonResponse({
      status: '1',
      message: 'OK',
      result: transformedResult,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MegaNode] Error:', errorMessage);
    return jsonResponse({ error: errorMessage, status: '0', result: [] }, 500);
  }
});
