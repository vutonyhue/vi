import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Share2, Check, AlertTriangle, Download, Eye, EyeOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatAddress } from '@shared/lib/wallet';
import { STORAGE_KEYS } from '@shared/storage/types';

function ReceivePage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [showFullAddress, setShowFullAddress] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAddress();
  }, []);

  const loadAddress = async () => {
    const walletData = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_WALLET);
    if (walletData[STORAGE_KEYS.ACTIVE_WALLET]) {
      setAddress(walletData[STORAGE_KEYS.ACTIVE_WALLET]);
    }
  };

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareAddress = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'FUN Wallet Address',
          text: `My BNB Smart Chain wallet address: ${address}`,
        });
      } catch (err) {
        // User cancelled or error
        console.log('Share cancelled');
      }
    } else {
      // Fallback to copy
      copyAddress();
    }
  };

  const downloadQR = () => {
    if (!qrRef.current) return;
    
    const svg = qrRef.current.querySelector('svg');
    if (!svg) return;

    // Create canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set size with padding
    const padding = 40;
    const size = 200 + padding * 2;
    canvas.width = size;
    canvas.height = size;

    // Draw white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Convert SVG to data URL
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, padding, padding, 200, 200);
      URL.revokeObjectURL(url);

      // Download
      const link = document.createElement('a');
      link.download = `fun-wallet-${address.slice(0, 8)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  };

  const getAssetUrl = (path: string) => {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      return path;
    }
  };

  return (
    <div className="flex flex-col h-full slide-in-right">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold">Nhận Crypto</h1>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {/* QR Code with Gradient Border */}
        <div className="gradient-border p-1 mb-4" ref={qrRef}>
          <div className="bg-white p-4 rounded-xl relative">
            <QRCodeSVG 
              value={address || 'loading'} 
              size={180}
              level="M"
              imageSettings={{
                src: getAssetUrl('/icons/logo.gif'),
                height: 32,
                width: 32,
                excavate: true,
              }}
            />
          </div>
        </div>

        {/* Download QR Button */}
        <button
          onClick={downloadQR}
          className="text-sm text-primary flex items-center gap-1 mb-4 hover:underline"
        >
          <Download className="w-4 h-4" />
          Tải QR Code
        </button>
        
        {/* Address */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">
              Địa chỉ ví của bạn
            </p>
            <button
              onClick={() => setShowFullAddress(!showFullAddress)}
              className="text-sm text-primary flex items-center gap-1"
            >
              {showFullAddress ? (
                <>
                  <EyeOff className="w-3 h-3" />
                  Rút gọn
                </>
              ) : (
                <>
                  <Eye className="w-3 h-3" />
                  Hiện đầy đủ
                </>
              )}
            </button>
          </div>
          
          <div 
            onClick={copyAddress}
            className="flex items-center justify-center gap-2 p-3 bg-muted rounded-xl cursor-pointer hover:bg-muted/80 transition-colors"
          >
            <span className={`font-mono text-sm ${showFullAddress ? 'break-all text-xs' : ''}`}>
              {showFullAddress ? address : formatAddress(address, 12)}
            </span>
            {copied ? (
              <Check className="w-4 h-4 text-success flex-shrink-0" />
            ) : (
              <Copy className="w-4 h-4 flex-shrink-0" />
            )}
          </div>
          
          {/* Copy/Share Toast */}
          {copied && (
            <div className="flex items-center justify-center gap-2 mt-2 text-sm text-success animate-fade-in">
              <Check className="w-4 h-4" />
              Đã copy địa chỉ!
            </div>
          )}

          {/* Share Button */}
          <button
            onClick={shareAddress}
            className="w-full mt-3 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium flex items-center justify-center gap-2 btn-hover-scale"
          >
            <Share2 className="w-4 h-4" />
            Chia sẻ địa chỉ
          </button>
        </div>
        
        {/* Warning Box */}
        <div className="warning-box mt-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Lưu ý quan trọng</p>
            <p className="text-sm text-muted-foreground">
              Chỉ gửi token BEP-20 trên BNB Smart Chain đến địa chỉ này. Gửi token từ mạng khác có thể mất vĩnh viễn.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReceivePage;
