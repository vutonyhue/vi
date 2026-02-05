# FUN Wallet RainbowKit Detection Test

Note: FUN Wallet integration here is via injected EIP-1193 provider bridge (`window.ethereum` / `window.funWallet`), not a custom wagmi connector class in this repo.

1. Build and load unpacked extension:
   - Run `npm run build:ext`
   - In Chrome, open `chrome://extensions`
   - Enable Developer mode
   - Click **Load unpacked** and select `dist-extension`
2. Open a RainbowKit demo dApp (or any wagmi app with injected wallet discovery).
3. Confirm **FUN Wallet** appears in installed/injected wallets.
4. In page DevTools Console, verify:
   - `window.funWallet` exists
   - `window.ethereum.providers.some((p) => p.isFunWallet === true)` returns `true`
   - `window.addEventListener('eip6963:announceProvider', (e) => console.log(e.detail.info.icon.startsWith('data:image/png;base64,')))`
5. Verify RPC/events:
   - `await window.funWallet.request({ method: 'eth_requestAccounts' })`
   - `await window.funWallet.request({ method: 'eth_chainId' }) // "0x38" on BSC`
   - `await window.funWallet.request({ method: 'net_version' }) // "56" on BSC`
   - `await window.funWallet.request({ method: 'eth_sendTransaction', params: [{ from: '<connectedAccount>', to: '<spenderOrContract>', data: '0x095ea7b3...', value: '0x0' }] })`
   - `await window.funWallet.request({ method: 'eth_sendTransaction', params: { from: '<connectedAccount>', to: '<spenderOrContract>', data: '0x095ea7b3...', value: '0x0' } })`
   - After account/chain changes in extension, confirm listeners fire:
     - `window.funWallet.on('accountsChanged', console.log)`
     - `window.funWallet.on('chainChanged', console.log)`
6. Sushi approve acceptance:
   - Open Sushi on BSC, click **Approve** for a token.
   - Confirm wallet opens approve flow (no more `Invalid transaction request` due to empty params).
   - After confirm, dApp receives tx hash.
7. Unsupported chain guard:
   - Call `wallet_switchEthereumChain` with unsupported chain id.
   - Confirm JSON-RPC error shape includes `code: -32602` and message `Unsupported chainId`.
