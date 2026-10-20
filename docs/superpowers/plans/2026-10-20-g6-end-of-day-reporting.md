# G6 End-of-Day Reporting Implementation Plan

> **For agentic workers:** Implement inline, one red/green slice at a time. No subagents or worktrees are needed for this branch.

**Goal:** Report the actual simulated day's post-financing equity, closing fills and coach risk without fabricated attribution.

**Architecture:** Reuse the persisted portfolio day-start equity; add an optional full-history length cursor to the market state and v1 save codec. Compute settlement after financing and display signed closing-fee-adjusted trade values accurately.

**Tech Stack:** TypeScript, Vitest, Next.js client component, existing `Money`, Zod v1 save codec, Playwright.

## Global Constraints

- Base: merged G9 `main` at `7b7d6e6ce7e026568fcee7adc3b651ce135b0806`; branch `fix/g6-end-of-day-reporting`; open a PR titled `fix(engine): calculate accurate simulated end-of-day reports` and do not merge it.
- Preserve v1 saves, no migration; never change G7 candle timing, speed rules, order matching, authentication or cloud architecture.
- Save full trade-history length, not the 50-trade UI slice; absent legacy cursor starts from current history length.
- G6 reports must use post-financing equity; trade rankings subtract **closing** commission only; zero/negative opening equity yields unavailable return; no fake sector P&L.
- Add any deferred work with a trigger to `docs/ROADMAP.md`. Use the shared dialog. No dependencies.

---

### Task 1: Correct settlement accounting

**Files:** Create `src/engine/eod-report.test.ts`; modify `src/engine/market.ts:23-34,744-819`.

**Interfaces:** `MarketSimulationEngine(seed, startingBalance)`, `skipToNextDay()`, `getCurrentEodModal()`, `exportState()`, `importState()`. `EndOfDayReport.returnPct` becomes `number | null`.

- [ ] **Step 1: Write the failing report test** in `src/engine/eod-report.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from './market.ts';

test('settlement reports the real opening balance and post-financing closing equity', () => {
  const engine = new MarketSimulationEngine('G6_CAPITAL', 10_000);
  engine.skipToNextDay();
  const report = engine.getCurrentEodModal()!;
  assert.equal(report.startingEquity, 10_000);
  assert.equal(report.endingEquity, 10_000);
  assert.equal(report.netPnl, 0);
  assert.equal(report.returnPct, 0);
  assert.deepEqual(report.sectorAttribution, []);
  assert.equal(engine.exportState().portfolio.dayStartEquity, '10000');
});
```

- [ ] **Step 2: Run** `bun run test src/engine/eod-report.test.ts`. Expect failure on the hardcoded $100,000 opening equity.
- [ ] **Step 3: Replace the settlement calculation** in `market.ts` (keep existing rival/earnings/DAY-order steps) with:

```ts
const startingEquity = Number(this.portfolioEngine.exportState().dayStartEquity);
this.portfolioEngine.applyOvernightFinancing(COMPANY_MAP);
const risk = this.portfolioEngine.calculateRiskMetrics(COMPANY_MAP);
const endingEquity = risk.netLiquidationValue;
const netPnl = Money.from(endingEquity).sub(startingEquity).toNumber();
// In the report:
startingEquity, endingEquity, netPnl,
returnPct: startingEquity > 0 ? (netPnl / startingEquity) * 100 : null,
sectorAttribution: [],
// At the day boundary:
this.portfolioEngine.resetDayStartEquity(endingEquity);
```

Import `Money` from `../lib/money.ts`. Compute coach risk from `risk` after financing. Add tests with negative cash, short borrow fees, zero/negative day starts, price marks and consecutive days; all report math must reconcile to exported cash/positions.
- [ ] **Step 4: Run** `bun run test src/engine/eod-report.test.ts`; expect pass. Commit the working slice with `git add src/engine/market.ts src/engine/eod-report.test.ts && git commit -m 'fix(engine): settle daily equity after financing'`.

### Task 2: Persist exact simulated-day trade boundaries

**Files:** Modify `src/engine/market.ts:72-121,160-209,774-805`, `src/saves/schema.ts:243-262`; extend `src/engine/eod-report.test.ts` and `src/saves/saves.test.ts`.

**Interfaces:** `MarketEngineState.dayStartTradeCount?: number`; `MarketSimulationEngine.exportState()/importState()`; optional `marketEngineStateSchema` field; `getCurrentEodModal().bestTrade/worstTrade` remain `TradeRecord | undefined`.

- [ ] **Step 1: Write failing tests** at the public report and save seams. Use `PortfolioEngine.executeFill()` through imported state only for realistic current-day fixtures; create actual market trades through `MarketSimulationEngine.placeOrder()` when possible. These assertions anchor legacy and daily membership:

```ts
const state = source.exportState();
const legacy = { ...state, dayStartTradeCount: undefined };
const loaded = new MarketSimulationEngine(state.seed);
loaded.importState(legacy);
assert.equal(loaded.exportState().dayStartTradeCount, state.portfolio.tradeHistory.length);
loaded.skipToNextDay();
assert.equal(loaded.getCurrentEodModal()!.bestTrade, undefined);
```

Add tests generating 60+ fills, crossing two days at each speed 1/5/20, saving after a close and resuming before rollover, loss-only and zero-net closes, and both closing sides (including forced liquidation). Assert full-history cursor and compare closing-fee-adjusted values, not `recentTrades`.
- [ ] **Step 2: Run** `bun run test src/engine/eod-report.test.ts src/saves/saves.test.ts`; expect missing cursor or wrong daily membership failures.
- [ ] **Step 3: Implement the minimal cursor and ranking** in `market.ts` and codec:

```ts
// MarketEngineState:
dayStartTradeCount?: number;
// Private engine field:
private dayStartTradeCount = 0;
// exportState():
dayStartTradeCount: this.dayStartTradeCount,
// importState() after importing portfolio:
this.dayStartTradeCount = Math.min(state.dayStartTradeCount ?? this.portfolioEngine.getTradeHistory().length,
  this.portfolioEngine.getTradeHistory().length);
// marketEngineStateSchema:
dayStartTradeCount: z.number().int().min(0).optional(),
// concludeTradingDay() before advancing day:
const history = this.portfolioEngine.getTradeHistory();
const today = history.slice(0, Math.max(0, history.length - this.dayStartTradeCount));
const closing = today.filter((trade) => trade.isClosingTrade && trade.realizedPnl !== undefined);
const closingNet = (trade: TradeRecord) => Money.from(trade.realizedPnl!).sub(trade.commission).toNumber();
const bestTrade = closing.reduce<TradeRecord | undefined>((best, trade) =>
  !best || closingNet(trade) > closingNet(best) ? trade : best, undefined);
const worstTrade = closing.reduce<TradeRecord | undefined>((worst, trade) =>
  !worst || closingNet(trade) < closingNet(worst) ? trade : worst, undefined);
this.dayStartTradeCount = history.length;
```

Do not truncate trade history. Verify a missing cursor never attributes pre-load trades to today. Test the v1 wire has the cursor on new saves and lacks it on legacy input; schemaVersion stays 1 and historical money remains decimal strings.
- [ ] **Step 4: Run** `bun run test src/engine/eod-report.test.ts src/saves/saves.test.ts`; expect pass. Commit with `git add src/engine/market.ts src/saves/schema.ts src/engine/eod-report.test.ts src/saves/saves.test.ts && git commit -m 'fix(engine): persist simulated-day trade boundary'`.

### Task 3: Present honest daily figures and validate in the browser

**Files:** Modify `src/features/eod-report/EndOfDayModal.tsx`, `docs/ROADMAP.md`; test signed values by rendering the client modal with a test engine or exercising the disposable browser session. No new UI dependency.

**Interfaces:** `EndOfDayReport` from `src/engine/market.ts`, existing `useTerminalStore` active-modal and dismiss actions.

- [ ] **Step 1: Reproduce the red UI case** with a loss-only close: existing modal renders `+$-0.20`. Record the signed text in a browser assertion or a component render test before editing.
- [ ] **Step 2: Format once** in the modal, using a signed formatter with neutral zero and the correct commission basis:

```ts
const signedMoney = (value: number) => value === 0 ? '$0.00' : `${value < 0 ? '-' : '+'}$${Math.abs(value).toFixed(2)}`;
// Shared with the engine; reversal fills carry only the closed-share portion.
const closingNet = (trade: TradeRecord) => closingTradeNet(trade);
```

Show `signedMoney(closingNet(report.bestTrade))` and the same for worst, with colors chosen by the **value**, not the heading. Display unavailable returns as `N/A` and non-zero returns below 0.01% with four decimals so a tiny loss never reads `-0.00%`; show `No closed trades today` when neither close exists, and say `Closing fill P&L after the commission allocated to the closed shares; entry fees not allocated.` and `Sector P&L unavailable.` No duplicate sign prefixes. Keep the existing dismiss controls.
- [ ] **Step 3: Re-run browser signed P&L, zero and negative equity checks** against disposable local data, then `bun install --frozen-lockfile`, `bun run lint`, `bunx tsc --noEmit`, `bun run test -- --maxWorkers=1`, `bun run build`, guarded `bash e2e/scripts/run.sh`, `git diff --check`. The Playwright runner must confirm local-only Supabase before test data creation. Fix any regressions; update roadmap status for G6 and defer remaining gaps with triggers.
- [ ] **Step 4: Commit, push and open PR** `fix(engine): calculate accurate simulated end-of-day reports` against `main`. Address review comments and re-run affected checks. Leave PR open; do not start G7.
