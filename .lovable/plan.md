
# Kế Hoạch Sửa Lỗi FUN Wallet Extension

## Các Vấn Đề Phát Hiện

### 1. Nút Send/Receive Không Hoạt Động
**Nguyên nhân**: Navigation sử dụng `useNavigate()` từ react-router-dom có thể không hoạt động đúng trong Chrome Extension popup context vì:
- Extension popup chạy trong context đặc biệt
- `react-router-dom` cần `BrowserRouter` nhưng extension popup không có history API như browser thông thường

### 2. Token Hiển Thị Nhấp Nháy Liên Tục  
**Nguyên nhân**:
- `useTokenPrices` có `autoRefresh: true` với interval 30s → mỗi lần fetch lại giá sẽ trigger re-render
- `useBalance` phụ thuộc vào `priceMap` → khi priceMap thay đổi, balances được recalculate và re-render
- `priceMap` trả về object mới mỗi lần → luôn trigger useEffect dependency
- Danh sách 5 token nhiều, mỗi lần fetch API cho 5 token gây nhiều requests

### 3. Yêu Cầu Chỉ Hiển Thị 3 Token Cơ Bản
Cần thay đổi từ 5 token (CAMLY, BTCB, USDT, BNB, USDC) thành 3 token (BNB, USDT, CAMLY) + tùy chọn thêm token custom.

---

## Giải Pháp Chi Tiết

### 1. Sửa Navigation (Send/Receive)

**Vấn đề**: Extension popup cần sử dụng `MemoryRouter` thay vì `BrowserRouter` vì không có access đến browser history API.

**Sửa file**: `src/extension/src/popup/main.tsx`
- Thay `BrowserRouter` bằng `MemoryRouter`
- MemoryRouter phù hợp cho extension popup vì lưu history trong memory

### 2. Sửa Token Flickering

**Vấn đề**: 
- `priceMap` luôn tạo object mới → trigger useEffect
- Auto-refresh gây re-render liên tục

**Giải pháp**:

a) **`useTokenPrices` hook**: 
   - Thêm `useMemo` để ổn định `priceMap` reference
   - Chỉ tạo object mới khi data thực sự thay đổi

b) **`useBalance` hook**:
   - Serialize priceMap để so sánh trong dependency
   - Chỉ refetch khi prices thực sự thay đổi

c) **`HomePage.tsx`**:
   - Tắt `autoRefresh` cho prices (chỉ refresh khi user bấm nút)
   - Giảm số token xuống 3 cơ bản

### 3. Chỉ Hiển Thị 3 Token Cơ Bản + Custom Token

**Thay đổi**:
- Tạo constant `DEFAULT_EXTENSION_TOKENS` chỉ có BNB, USDT, CAMLY
- Thêm tính năng lưu/load custom tokens từ Chrome storage
- Thêm UI "Thêm token" với dialog nhập contract address

---

## Files Cần Sửa

| File | Thay Đổi |
|------|----------|
| `src/extension/src/popup/main.tsx` | Thay BrowserRouter → MemoryRouter |
| `src/shared/hooks/useTokenPrices.ts` | Stabilize priceMap với useMemo |
| `src/shared/hooks/useBalance.ts` | Serialize priceMap dependency |
| `src/extension/src/popup/pages/HomePage.tsx` | Chỉ 3 token + custom tokens + tắt autoRefresh |
| `src/extension/src/popup/pages/SendPage.tsx` | Sử dụng 3 token + custom tokens |
| `src/shared/constants/tokens.ts` | Thêm DEFAULT_EXTENSION_TOKENS |
| `src/shared/storage/types.ts` | Thêm CUSTOM_TOKENS storage key |
| `src/extension/src/popup/components/AddTokenDialog.tsx` | **Tạo mới** - Dialog thêm token |

---

## Chi Tiết Triển Khai

### 1. Sửa main.tsx - MemoryRouter

```typescript
// TRƯỚC
import { BrowserRouter } from 'react-router-dom';
<BrowserRouter>
  <PopupApp />
</BrowserRouter>

// SAU  
import { MemoryRouter } from 'react-router-dom';
<MemoryRouter>
  <PopupApp />
</MemoryRouter>
```

### 2. Stabilize useTokenPrices

```typescript
// Thêm useMemo cho priceMap để tránh tạo object mới mỗi render
const priceMap = useMemo(() => {
  return prices.reduce<Record<string, { price: number; priceChange24h: number }>>((acc, p) => {
    acc[p.symbol.toUpperCase()] = {
      price: p.price,
      priceChange24h: p.change24h,
    };
    return acc;
  }, {});
}, [prices]); // Chỉ recalculate khi prices array thay đổi
```

### 3. Sửa useBalance Dependencies

```typescript
// Serialize priceMap để tránh infinite loop
const priceMapKey = useMemo(() => {
  return Object.entries(priceMap)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}, [priceMap]);

// Dùng priceMapKey trong dependency thay vì priceMap object
useEffect(() => {
  fetchBalances();
}, [address, priceMapKey, enabled]);
```

### 4. Định Nghĩa 3 Token Cơ Bản

```typescript
// src/shared/constants/tokens.ts
export const DEFAULT_EXTENSION_TOKENS: Token[] = [
  { symbol: "BNB", name: "BNB", address: null, decimals: 18, logo: "/tokens/bnb.png" },
  { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, logo: "/tokens/usdt.svg" },
  { symbol: "CAMLY", name: "CAMLY COIN", address: "0x0910320181889fefde0bb1ca63962b0a8882e413", decimals: 3, logo: "/tokens/camly.png" },
];
```

### 5. HomePage - Chỉ 3 Token + Custom

```typescript
// Load default + custom tokens
const [customTokens, setCustomTokens] = useState<Token[]>([]);

useEffect(() => {
  loadCustomTokens();
}, []);

const loadCustomTokens = async () => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CUSTOM_TOKENS);
  if (data[STORAGE_KEYS.CUSTOM_TOKENS]) {
    setCustomTokens(JSON.parse(data[STORAGE_KEYS.CUSTOM_TOKENS]));
  }
};

// Combine default + custom
const allTokens = [...DEFAULT_EXTENSION_TOKENS, ...customTokens];

// Tắt autoRefresh
const { priceMap, loading: pricesLoading } = useTokenPrices(
  allTokens.map(t => t.symbol),
  { autoRefresh: false } // TẮT auto refresh
);
```

### 6. AddTokenDialog Component

Dialog cho phép user nhập:
- Contract address
- Auto-fetch token info từ blockchain (symbol, name, decimals)
- Validate và lưu vào Chrome storage

```text
┌─────────────────────────────────────────┐
│         Thêm Token Tùy Chỉnh            │
├─────────────────────────────────────────┤
│                                         │
│  Địa chỉ contract:                      │
│  ┌─────────────────────────────────┐   │
│  │ 0x...                           │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ ✓ Token Info Found              │   │
│  │   Symbol: ABC                   │   │
│  │   Name: ABC Token               │   │
│  │   Decimals: 18                  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Hủy]              [Thêm Token]        │
│                                         │
└─────────────────────────────────────────┘
```

---

## Thứ Tự Triển Khai

1. **Bước 1**: Sửa `main.tsx` - BrowserRouter → MemoryRouter (sửa Send/Receive)
2. **Bước 2**: Sửa `useTokenPrices.ts` - Stabilize priceMap
3. **Bước 3**: Sửa `useBalance.ts` - Serialize dependency  
4. **Bước 4**: Thêm `DEFAULT_EXTENSION_TOKENS` vào constants
5. **Bước 5**: Thêm `CUSTOM_TOKENS` storage key
6. **Bước 6**: Sửa `HomePage.tsx` - 3 token + custom + tắt autoRefresh
7. **Bước 7**: Tạo `AddTokenDialog.tsx`
8. **Bước 8**: Sửa `SendPage.tsx` - Dùng 3 token + custom

---

## Kết Quả Mong Đợi

| Vấn đề | Trước | Sau |
|--------|-------|-----|
| Nút Send/Receive | Không hoạt động | Navigate đúng đến /send và /receive |
| Token flickering | Nhấp nháy liên tục | Ổn định, chỉ refresh khi bấm nút |
| Số lượng token | 5 tokens | 3 tokens mặc định + custom tokens |
| Thêm token | Không có | Dialog thêm token bằng contract address |

---

## Acceptance Criteria

1. Click nút "Gửi" → mở trang SendPage
2. Click nút "Nhận" → mở trang ReceivePage
3. Token list không nhấp nháy khi idle
4. Chỉ hiển thị BNB, USDT, CAMLY mặc định
5. Có nút "+ Thêm token" ở cuối danh sách
6. Có thể thêm token bằng contract address
7. Token custom được lưu và hiển thị sau khi reload
