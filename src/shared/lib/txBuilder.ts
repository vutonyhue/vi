/**
 * Transaction Builder Utilities
 * 
 * Provides functions to prepare, estimate, and broadcast transactions
 * following MetaMask-like confirmation flow.
 */

import { ethers } from "ethers";
import { BSC_MAINNET } from '../constants/tokens';
import { Result, PreparedTransaction, GasPreset, GasSettings } from '../types';

// ERC-20 Interface for encoding transfer data
const ERC20_INTERFACE = new ethers.Interface([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/**
 * Build ERC-20 transfer calldata
 */
export function buildERC20TransferData(to: string, amount: bigint): string {
  return ERC20_INTERFACE.encodeFunctionData("transfer", [to, amount]);
}

/**
 * Validate transaction inputs
 */
function validateInputs(params: {
  to: string;
  amount: string;
}): { valid: true } | { valid: false; error: string } {
  // Validate address
  if (!ethers.isAddress(params.to)) {
    return { valid: false, error: 'Địa chỉ ví không hợp lệ' };
  }

  // Validate amount
  const amountNum = parseFloat(params.amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return { valid: false, error: 'Số lượng không hợp lệ' };
  }

  return { valid: true };
}

/**
 * Prepare transaction without signing
 * - Validates inputs
 * - Builds tx object with proper data encoding
 * - Returns PreparedTransaction ready for estimation
 */
export async function prepareTx(params: {
  from: string;
  to: string;
  amount: string;
  tokenAddress: string | null;
  tokenDecimals: number;
  tokenSymbol: string;
  balance: string;
}): Promise<Result<PreparedTransaction, string>> {
  try {
    // Validate inputs
    const validation = validateInputs({ to: params.to, amount: params.amount });
    if (!validation.valid) {
      return { success: false, error: (validation as { valid: false; error: string }).error };
    }

    // Check balance
    const amountNum = parseFloat(params.amount);
    const balanceNum = parseFloat(params.balance);
    if (amountNum > balanceNum) {
      return { success: false, error: 'Số dư không đủ' };
    }

    const isNativeToken = params.tokenAddress === null;
    
    let prepared: PreparedTransaction;

    if (isNativeToken) {
      // Native token (BNB) transfer
      prepared = {
        to: params.to,
        value: ethers.parseEther(params.amount),
        data: '0x',
        tokenSymbol: params.tokenSymbol,
        tokenDecimals: params.tokenDecimals,
        tokenAddress: null,
        isContractInteraction: false,
        formattedAmount: params.amount,
      };
    } else {
      // ERC-20 token transfer
      const amountWei = ethers.parseUnits(params.amount, params.tokenDecimals);
      const transferData = buildERC20TransferData(params.to, amountWei);
      
      prepared = {
        to: params.tokenAddress!, // Contract address
        value: 0n, // No BNB sent
        data: transferData,
        tokenSymbol: params.tokenSymbol,
        tokenDecimals: params.tokenDecimals,
        tokenAddress: params.tokenAddress,
        isContractInteraction: true,
        formattedAmount: params.amount,
        // Store actual recipient for display
        actualRecipient: params.to,
      };
    }

    return { success: true, data: prepared };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Không thể tạo giao dịch';
    return { success: false, error: errorMsg };
  }
}

/**
 * Estimate gas and generate presets
 */
export async function estimateTx(
  prepared: PreparedTransaction,
  from: string
): Promise<{
  gasLimit: bigint;
  presets: GasPreset[];
  nonce: number;
}> {
  const provider = new ethers.JsonRpcProvider(BSC_MAINNET.rpcUrl);
  
  // Build transaction request for estimation
  const txRequest: ethers.TransactionRequest = {
    from,
    to: prepared.to,
    value: prepared.value,
    data: prepared.data !== '0x' ? prepared.data : undefined,
  };

  // Estimate gas
  let gasLimit: bigint;
  try {
    const estimated = await provider.estimateGas(txRequest);
    // Add 20% buffer for safety
    gasLimit = (estimated * 120n) / 100n;
  } catch {
    // Fallback values
    gasLimit = prepared.isContractInteraction ? 100000n : 21000n;
  }

  // Get fee data
  const feeData = await provider.getFeeData();
  const baseGasPrice = feeData.gasPrice || ethers.parseUnits('3', 'gwei');

  // Get nonce
  const nonce = await provider.getTransactionCount(from, 'pending');

  // Generate 3 presets: Low, Market, Aggressive
  const presets: GasPreset[] = [
    {
      level: 'low',
      label: 'Chậm',
      gasPrice: (baseGasPrice * 90n) / 100n, // 90% of market
      estimatedTime: '~30 giây',
      estimatedFee: ethers.formatEther((gasLimit * (baseGasPrice * 90n) / 100n)),
    },
    {
      level: 'market',
      label: 'Tiêu chuẩn',
      gasPrice: baseGasPrice, // Market rate
      estimatedTime: '~15 giây',
      estimatedFee: ethers.formatEther(gasLimit * baseGasPrice),
    },
    {
      level: 'aggressive',
      label: 'Nhanh',
      gasPrice: (baseGasPrice * 120n) / 100n, // 120% of market
      estimatedTime: '~5 giây',
      estimatedFee: ethers.formatEther((gasLimit * (baseGasPrice * 120n) / 100n)),
    },
  ];

  return {
    gasLimit,
    presets,
    nonce,
  };
}

/**
 * Sign and broadcast transaction
 * - Only call after user confirms
 * - Decrypts private key and sends transaction
 */
export async function signAndBroadcast(
  prepared: PreparedTransaction,
  gasSettings: GasSettings,
  privateKey: string
): Promise<Result<{ hash: string }, string>> {
  try {
    const provider = new ethers.JsonRpcProvider(BSC_MAINNET.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Build final transaction
    const tx: ethers.TransactionRequest = {
      to: prepared.to,
      value: prepared.value,
      data: prepared.data !== '0x' ? prepared.data : undefined,
      gasLimit: gasSettings.gasLimit,
      gasPrice: gasSettings.gasPrice,
    };

    // Send transaction
    const txResponse = await wallet.sendTransaction(tx);
    
    return { success: true, data: { hash: txResponse.hash } };
  } catch (error) {
    const errorMsg = parseTransactionError(error);
    return { success: false, error: errorMsg };
  }
}

/**
 * Parse blockchain errors to user-friendly Vietnamese messages
 */
export function parseTransactionError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();

  const errorMap: [string, string][] = [
    ['insufficient funds', 'Số dư không đủ để thực hiện giao dịch và trả phí gas'],
    ['user rejected', 'Giao dịch đã bị hủy'],
    ['user denied', 'Giao dịch đã bị hủy'],
    ['nonce too low', 'Giao dịch đã được xử lý trước đó. Vui lòng thử lại.'],
    ['replacement fee too low', 'Phí thay thế quá thấp. Tăng gas price và thử lại.'],
    ['replacement transaction underpriced', 'Phí thay thế quá thấp.'],
    ['transaction underpriced', 'Phí giao dịch quá thấp. Tăng gas price.'],
    ['gas required exceeds', 'Gas limit không đủ. Hãy tăng gas limit.'],
    ['exceeds block gas limit', 'Gas limit vượt quá giới hạn block.'],
    ['execution reverted', 'Giao dịch thất bại. Hợp đồng từ chối thực thi.'],
    ['call revert exception', 'Giao dịch thất bại. Hợp đồng từ chối.'],
    ['incorrect password', 'Mật khẩu không đúng'],
    ['failed to decrypt', 'Mật khẩu không đúng'],
    ['invalid address', 'Địa chỉ ví không hợp lệ'],
    ['invalid recipient', 'Địa chỉ nhận không hợp lệ'],
    ['network error', 'Lỗi mạng. Vui lòng kiểm tra kết nối internet.'],
    ['timeout', 'Hết thời gian chờ. Vui lòng thử lại.'],
    ['already known', 'Giao dịch đã được gửi trước đó.'],
  ];

  for (const [key, value] of errorMap) {
    if (lowerMsg.includes(key)) {
      return value;
    }
  }

  return 'Giao dịch thất bại. Vui lòng thử lại.';
}

/**
 * Format gas price for display
 */
export function formatGasPrice(gasPrice: bigint): string {
  const gwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
  return gwei.toFixed(1);
}

/**
 * Calculate total cost (amount + gas fee)
 */
export function calculateTotal(
  prepared: PreparedTransaction,
  gasSettings: GasSettings
): {
  fee: string;
  feeFormatted: string;
  total: string;
  totalFormatted: string;
} {
  const fee = gasSettings.gasLimit * gasSettings.gasPrice;
  const feeFormatted = parseFloat(ethers.formatEther(fee)).toFixed(6);
  
  // For native token, total = value + fee
  // For ERC-20, total is just the fee (in BNB)
  if (!prepared.isContractInteraction) {
    const total = prepared.value + fee;
    return {
      fee: fee.toString(),
      feeFormatted,
      total: total.toString(),
      totalFormatted: parseFloat(ethers.formatEther(total)).toFixed(6),
    };
  }
  
  return {
    fee: fee.toString(),
    feeFormatted,
    total: fee.toString(),
    totalFormatted: feeFormatted,
  };
}
