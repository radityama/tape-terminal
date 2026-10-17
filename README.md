# TAPE: Stock Trading Terminal & Simulation Game

TAPE is a professional, browser-based stock trading game and financial terminal. It combines Bloomberg-class information density, realistic market microstructure, and a career progression system. Everything runs client-side with deterministic seeded generation.

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
    settings/                 # Settings, difficulty presets, IndexedDB saves
    tutorial/                 # 9-step spotlight walkthrough with guided first trade
  /store
    useTerminalStore.ts       # Granular Zustand store with engine bridge
  /lib
    money.ts                  # Decimal high-precision financial math
    storage.ts                # Dexie IndexedDB save slots & JSON export/import
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
  npx tsx --test src/engine/engine.test.ts
  ```
- **Production Build**:
  ```bash
  npm run build
  ```
