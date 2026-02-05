/**
 * GasEditor Component
 * 
 * Allows users to select gas presets (Low/Market/Aggressive)
 * or enter custom gas settings.
 */

import { useState } from 'react';
import { Fuel, ChevronDown, ChevronUp } from 'lucide-react';
import { GasPreset, GasSettings } from '@shared/types';
import { formatGasPrice } from '@shared/lib/txBuilder';
import { ethers } from 'ethers';

interface GasEditorProps {
  presets: GasPreset[];
  gasLimit: bigint;
  selectedLevel: 'low' | 'market' | 'aggressive' | 'custom';
  onSelect: (settings: GasSettings, level: 'low' | 'market' | 'aggressive' | 'custom') => void;
}

export function GasEditor({ presets, gasLimit, selectedLevel, onSelect }: GasEditorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customGasLimit, setCustomGasLimit] = useState(gasLimit.toString());
  const [customGasPrice, setCustomGasPrice] = useState('');

  const handlePresetSelect = (preset: GasPreset) => {
    onSelect({
      gasLimit,
      gasPrice: preset.gasPrice,
    }, preset.level);
  };

  const handleCustomApply = () => {
    try {
      const gasLimitBigInt = BigInt(customGasLimit);
      const gasPriceBigInt = ethers.parseUnits(customGasPrice || '5', 'gwei');
      
      onSelect({
        gasLimit: gasLimitBigInt,
        gasPrice: gasPriceBigInt,
      }, 'custom');
    } catch {
      // Invalid input, ignore
    }
  };

  const selectedPreset = presets.find(p => p.level === selectedLevel);

  return (
    <div className="bg-muted/50 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Fuel className="w-4 h-4 text-primary" />
          <span>Phí giao dịch</span>
        </div>
        {selectedPreset && (
          <span className="text-sm text-muted-foreground">
            ~{parseFloat(selectedPreset.estimatedFee).toFixed(6)} BNB
          </span>
        )}
      </div>

      {/* Preset Buttons */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {presets.map((preset) => (
          <button
            key={preset.level}
            onClick={() => handlePresetSelect(preset)}
            className={`p-2 rounded-lg border transition-all text-center ${
              selectedLevel === preset.level
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <div className="text-xs font-medium">{preset.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {formatGasPrice(preset.gasPrice)} Gwei
            </div>
            <div className="text-[10px] text-muted-foreground">
              {preset.estimatedTime}
            </div>
          </button>
        ))}
      </div>

      {/* Advanced Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Nâng cao
      </button>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Gas Limit</label>
            <input
              type="text"
              value={customGasLimit}
              onChange={(e) => setCustomGasLimit(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
              placeholder="21000"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Gas Price (Gwei)</label>
            <input
              type="text"
              value={customGasPrice}
              onChange={(e) => setCustomGasPrice(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
              placeholder={selectedPreset ? formatGasPrice(selectedPreset.gasPrice) : '5'}
            />
          </div>
          <button
            onClick={handleCustomApply}
            className="w-full py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            Áp dụng
          </button>
        </div>
      )}
    </div>
  );
}

export default GasEditor;
