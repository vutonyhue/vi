# Copilot / AI Agent Instructions for Fun Web3 Nexus

Purpose: Give an AI coding agent the minimal, actionable knowledge to be productive in this mono-repo (web app + browser extension + Supabase functions).

- Quick commands:
  - Install: `npm i`
  - Dev (web app): `npm run dev` (reads root `vite.config.ts`)
  - Dev (extension): `npm run dev:ext` (uses `vite.config.extension.ts`, root: `src/extension`)
  - Build web app: `npm run build`
  - Build extension: `npm run build:ext` (output: `dist-extension`)
  - Lint: `npm run lint`

- High-level architecture:
  - Two main products in one repo:
    - Web/SPA: React + Vite + TypeScript under `src/` (entry: `src/main.tsx`, root `vite.config.ts`).
    - Browser extension: located under `src/extension` and built with `vite.config.extension.ts` and `@crxjs/vite-plugin`. Manifest: `src/extension/public/manifest.json`. Build artifacts land in `dist-extension/`.
  - Serverless bits: `supabase/functions/` and SQL migrations in `supabase/migrations/`.
  - Shared code: `src/lib/` and `src/shared/` (extension aliases `@shared`).

- Key patterns & conventions (do not invent alternatives):
  - Global state via React Contexts in `src/contexts/` (e.g. `AuthContext.tsx`, `WalletSecurityContext.tsx`). Use these when adding cross-cutting state.
  - Feature hooks in `hooks/` (e.g. `useWallet.ts`, `useStaking.ts`). Prefer adding reusable logic as hooks here.
  - Business logic in `src/lib/` (e.g. `wallet.ts`, `swap.ts`, `keyEncryption.ts`). Keep UI components thin.
  - Pages under `src/pages/` and UI components under `src/components/` (further grouped by domain).
  - TypeScript project: multiple tsconfig files exist (root `tsconfig.json`, `extension/tsconfig.json`). Respect compilation targets when editing extension code.

- Integration & external deps to be aware of:
  - `@crxjs/vite-plugin` for the extension; extension build uses custom rollup options (see `vite.config.extension.ts`).
  - `@supabase/supabase-js` and Supabase functions in `supabase/functions/`.
  - `ethers` for blockchain interactions (`src/lib/wallet.ts` shows provider/wallet helpers and careful decimals/precision handling).

- Build/dev gotchas and testing notes:
  - Extension dev uses a different Vite root and aliases (run `npm run dev:ext`). If modifying extension aliases, update `vite.config.extension.ts`.
  - The repo has no unit-test runner configured by default; rely on linting and local manual testing. PRs should include a reproducible manual test plan.
  - When changing RPC or wallet flows, run careful local validation — `src/lib/wallet.ts` contains heuristics around decimals and full-balance sends.

- When editing or adding files, prefer these examples:
  - Add new global state: create `src/contexts/MyContext.tsx` and expose hook in `hooks/`.
  - Add platform-specific code for extension: place under `src/extension/src` and update `vite.config.extension.ts` rollup inputs if needed.
  - Share code between app and extension via `src/shared/` or `src/lib/` and use extension alias `@shared`.

- Where to look first when debugging a problem:
  - UI boot: `src/main.tsx` → `src/App.tsx`.
  - Auth/state issues: `src/contexts/AuthContext.tsx` and `hooks/useWallet.ts`.
  - Extension packaging: `vite.config.extension.ts` and `src/extension/public/manifest.json`.
  - Backend/state/migrations: `supabase/functions/*` and `supabase/migrations/`.

If anything here is unclear or you need additional examples (small PRs, tests, or step-by-step build checks), tell me which area to expand.  
Requested follow-up: please review for missing integration points (third-party services, CI, or deploy steps) and I will iterate.
