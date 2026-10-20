# TAPE: Stock Trading Terminal & Simulation Game

TAPE is a professional, browser-based stock trading game and financial terminal. It combines Bloomberg-class information density, realistic market microstructure, and a career progression system. Everything runs client-side with deterministic seeded generation.

Planning, known gaps and deferred work live in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## 1. Product Overview

The player starts as an Intern Trader with a $100,000 cash account. A simulated market runs in compressed time with 48 fictional listed companies across 8 sectors, macroeconomic prints, quarterly earnings surprises, live news wires, and 8 AI rival traders.

---

## 2. Design System & Anti-Slop Rules

- **Palette**: Dark canvas only.
  - `--bg-0: #0A0B0D` (app canvas)
  - `--bg-1: #0F1114` (panels)
  - `--bg-2: #15181C` (raised rows, hover)
  - `--line: #22272D` (hairline dividers)
  - `--line-strong: #2F363E`
  - `--text-1: #E4E7EB` (primary)
  - `--text-2: #98A0A9` (secondary)
  - `--text-3: #5E6670` (labels)
  - `--accent: #E0A03A` (the single accent used for focus, primary actions, active tabs)
  - `--up: #3DB070` (semantic gains only)
  - `--down: #E5534B` (semantic losses only)
- **Geometry**: Single 2px radius everywhere (`rounded-[2px]`). No pills.
- **Typography**: IBM Plex Sans for UI text, JetBrains Mono for numbers, prices, tickers, and code labels. Right-aligned tabular numbers.
- **Icons**: Phosphor icons only (`@phosphor-icons/react`). Standardized stroke weight.
- **Zero Em-Dashes**: No em-dashes or en-dashes anywhere in UI strings, tooltips, tutorials, or news.

---

## 3. Core Architecture

```
/app
  /(game)/terminal/page.tsx   # Main dockable workspace
  /(game)/layout.tsx
  /page.tsx                   # Title screen with live depth ladder
proxy.ts                      # Next 16 proxy: refreshes the Supabase session
/src
  /engine                     # Pure TypeScript, runs without React dependencies
    rng.ts                    # Deterministic seeded PRNG (Mulberry32 + Box-Muller)
    correlation.ts            # Cholesky factor decomposition (market + sector + idiosyncratic)
    pricing.ts                # GBM + jump diffusion + GARCH vol + mean reversion
    orderbook.ts              # 5-level depth ladder, dynamic spread, slippage
    matching.ts               # Order matching (Market, Limit, Stop, Stop-Limit, Trailing)
    portfolio.ts              # Positions, margin, P&L, 1-day parametric VaR
    events.ts                 # Scheduled earnings, news wire, macro, black swans
    rivals.ts                 # 8 AI rival traders with distinct trading personalities
    career.ts                 # 6 Career ranks, objectives, reputation, achievements
    market.ts                 # Clock loop, sessions, TAPE50 index, 10Hz snapshots
    assets/
      types.ts                # AssetClass interface
      equity.ts               # Equities implementation (Phase 1)
      forex.ts                # Future Forex stub with TODO markers
      crypto.ts               # Future Crypto stub with TODO markers
      etf.ts                  # Future ETF stub with TODO markers
      options.ts              # Future Options stub with TODO markers
  /data
    companies.ts              # 48 fictional companies across 8 sectors
    scenarios.ts              # Historical sandbox scenarios
  /features
    topbar/                   # Brand, clock, speed controls, ticker tape
    watchlist/                # 48-stock virtualized/filtered watchlist
    chart/                    # TradingView lightweight-charts (multi-timeframe, indicators)
    ticket/                   # Order ticket with pre-trade breakdown
    depth/                    # Level 1 quote & Level 2 5-level depth ladder
    news/                     # Real-time news, earnings, and macro wire
    bottom-dock/              # Positions, Orders, Blotter, Risk, Calendar, Leaderboard
    command-bar/              # Bloomberg-style command terminal (cmdk)
    screener/                 # Full stock screener modal
    company/                  # Company profile and fundamentals modal
    career/                   # Career rank progression modal
    eod-report/               # End-of-day settlement & coach report
    settings/                 # Settings, difficulty presets, save slots
    tutorial/                 # 9-step spotlight walkthrough with guided first trade
  /store
    useTerminalStore.ts       # Granular Zustand store with engine bridge
    useAuthStore.ts           # Supabase auth state (guest-first)
  /saves
    schema.ts                 # Versioned zod save format (money serialized as strings)
    migrations.ts             # Ordered migrations, refuses newer-version saves
    localStore.ts             # Dexie IndexedDB backend (LocalSaveStore)
    cloudStore.ts             # Supabase backend (CloudSaveStore, RLS enforced)
    manager.ts                # SaveManager: save/load, export/import, autosave, sync
  /lib
    money.ts                  # Decimal high-precision financial math
    supabase/                 # Browser and server Supabase clients
```

---

## 4. How the Market Simulation Works

1. **Geometric Brownian Motion & Multi-Factor Correlation**:
   Asset price innovation combines a common market factor, 8 sector factors, and idiosyncratic noise. In panic regimes, market correlation spikes toward 1.
2. **Jump Diffusion**:
   News shocks and quarterly earnings surprises cause directional jumps that deviate from random diffusion.
3. **Volatility Clustering**:
   GARCH(1,1) updates conditional volatility so wild and calm periods cluster realistically.
4. **Microstructure & Slippage**:
   Bid/ask spreads widen under high volatility and stress. Market orders walk a 5-level depth ladder, incurring volume-dependent slippage.
5. **Mean Reversion**:
   Mild drift pulls prices toward fundamental fair value over extended horizons.

---

## 5. Adding New Asset Classes

The engine defines the `AssetClass` interface in `src/engine/assets/types.ts`:

```ts
export interface AssetClass<T = any> {
  id: string;
  name: string;
  tradingHours: TradingHours;
  tickSize: number;
  lotSize: number;
  pricingModel: string;
  feeModel: FeeModel;
  marginRules: MarginRules;
  supportsShort: boolean;
  settlement: 'T+0' | 'T+1' | 'T+2';
  formatPrice: (price: number) => string;
  formatQuantity: (qty: number) => string;
  eventTypes: string[];
}
```

To add Forex, Crypto, ETFs, or Options in Phase 2:
1. Implement the interface in `src/engine/assets/<asset>.ts` (see existing stubs with `// TODO(asset-class): ...`).
2. Add the asset instruments to the engine universe.
3. Plug in asset-specific formatting and contract units.

---

## 6. Testing & Running

- **Run Dev Server**:
  ```bash
  npm run dev
  ```
- **Execute Pure Engine Unit Tests**:
  ```bash
  npm run test
  ```
- **Production Build**:
  ```bash
  npm run build
  ```
- **Browser E2E** (disposable local Supabase only):
  ```bash
  bunx supabase start
  bunx supabase migration up --local
  bun run test:e2e
  ```
  The suite generates `.env.e2e.local` from `supabase status`, builds the production app, and refuses to run unless `E2E_LOCAL_SUPABASE=1` is set and Supabase is on `127.0.0.1:54321`. It signs in through real Mailpit magic links, uses unique test accounts, and captures screenshots, video, and traces on failure (`test-results/`, `playwright-report/`).

  Nine specs, 19 scenarios: guest trade and skipped day across reload, resume without rewriting the slot, occupied-slot replacement with a verified backup, corrupted and newer-schema rows (labelled, disabled, raw export), direct `/terminal` recovery, delayed auth hydration on both routes, bracket OCO and delayed save conflicts, two-device local/cloud conflicts (Keep both, Keep this device), and the cloud deletion lifecycle (success plus re-enable, failed retry, preflight abort). These run against the production build locally; the CI workflow still runs only install, lint, typecheck, unit tests, and build. Remaining gaps (OAuth, hosted SMTP, sign-out-with-delete, claim uploads, Use cloud, forced IndexedDB write failure) are tracked as `E2E-CI` and `E2E-GAPS` in `docs/ROADMAP.md`.

---

## 7. Accounts and Cloud Saves (optional)

TAPE is guest-first. With no Supabase configured the game runs entirely on local Dexie storage. Configuring Supabase adds email magic-link, GitHub and Google sign-in, cloud backup, and cross-device sync. The service role key is never used in client code.

### Environment

Copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Both are safe to expose in the browser; row level security enforces ownership. Without these values the sign-in entry points stay hidden and nothing else changes. A newer `sb_publishable_...` key works in `NEXT_PUBLIC_SUPABASE_ANON_KEY`; there is no separate publishable variable.

On hosted deployments, set `NEXT_PUBLIC_SITE_URL` to the public app origin, for example `https://tape.example`. Leave it empty for local development; the callback then uses forwarded request headers or the incoming Host header. Add `<origin>/auth/callback` to Supabase Auth redirect URLs. The callback accepts only local redirect paths, including after URL normalization, and shows fixed messages for provider errors.

### Database

For local testing, run `bunx supabase init` if `supabase/config.toml` is missing, then `bunx supabase start` and `bunx supabase migration up --local` to apply pending migrations without deleting existing saves. Do not reset a database containing saves. Use the API URL and anon key from `bunx supabase status` in `.env.local`. Local magic links arrive in the mail inbox shown by `status`, so local testing does not need SMTP.

Migration `0001_cloud_saves.sql` creates the `saves` and `profiles` tables, RLS policies, revision and updated_at triggers, and payload size limits. It retains its historical `create extension if not exists pgcrypto` declaration; the extension is shared and must not be dropped by this feature. Forward migration `0002_tighten_grants.sql` revokes anonymous SELECT on both tables. Against a disposable local database, set `DATABASE_URL` to the DB URL shown by `bunx supabase status`, then run the isolation assertions with `psql`:

```bash
psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/rls_saves.sql
```

### Self-hosted auth

Magic links need SMTP. On a self-hosted Supabase auth service:

- Configure SMTP (host, port, user, password, sender) so auth emails send. Magic links do not work without it.
- Set the Site URL to your deployed origin, and add Redirect URLs for `http://localhost:3000/auth/callback` and `https://your-origin/auth/callback`. Magic links and OAuth both return through `app/auth/callback/route.ts`, which exchanges the code and forwards to `/terminal`.
- Enable the GitHub and Google providers and paste their client IDs and secrets.

### Session refresh

`proxy.ts` at the project root refreshes the Supabase session on each request (Next 16 renamed Middleware to Proxy).
