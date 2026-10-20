# G10 Scenario Mechanics Implementation Plan

> **For agentic workers:** Implement tasks inline, test each seam before moving on. Do not delegate without user authorization.

**Goal:** Make the four existing scenarios enforce their regime, duration, profit objective and score benchmark, persist results safely, and freeze completed runs.

**Architecture:** `MarketSimulationEngine` owns an optional `ScenarioRun` whose definition is resolved from the canonical scenario catalogue. Settlement computes a result once from post-financing net liquidation equity. Store and terminal render the persisted run; the save codec accepts it as an optional v1 field without changing revision handling.

**Tech Stack:** TypeScript, Vitest, Zustand, Zod, Next.js 16 client components, Playwright.

## Global Constraints

- Seed and featured ticker remain unchanged; do not alter price RNG sequencing, order execution, career progression or cloud conflict/revision logic.
- Starting cash is $100,000. A run starts only in an empty slot; legacy `scenarioId` without `scenarioRun` is unscored.
- Score: `Math.round(Math.max(0, Math.min(10000, 10000 * netGain / targetProfit)))`. Win: `netGain >= targetProfit`. A at `scoreBenchmark`, B at 75% of `scoreBenchmark`, C at 50% of `scoreBenchmark`, D below; use the first matching threshold. No risk penalty or reward; an A need not be a win.
- Completion occurs after `durationDays` settled days, after fees/financing, exactly once. Freeze ticks, placement, cancellation and skips; preserve open orders read-only. Show EOD first, then a persistent inspectable result.
- Preserve v1 saves and G0-G9 invariants. Do not start G11/G12 or redesign the terminal. Open G10 PR with title `fix(gameplay): enforce scenario rules and completion`; leave it unmerged.

---

### Task 1: Engine-owned run and settlement

**Files:** Modify `src/engine/market.ts`; create `src/engine/scenario-run.ts`; test `src/engine/scenario-run.test.ts`.

**Interfaces:** `ScenarioRun { id: Scenario['id']; startDay: number; startingEquity: number; settledDays: number; result?: ScenarioResult }`; `ScenarioResult { completedDay: number; finalEquity: number; netGain: number; score: number; grade: 'A'|'B'|'C'|'D'; success: boolean }`; `scoreScenario(scenario: Scenario, run: ScenarioRun, finalEquity: number, completedDay: number): ScenarioResult`; engine `startScenario(scenario: Scenario): void`, `getScenarioRun(): ScenarioRun | undefined`.

- [ ] Test that each scenario starts with its canonical seed/initial regime, day 1, $100,000 baseline, zero settled days and unchanged RNG state relative to a seed-matched sandbox initialized the same way.
- [ ] Run `bun run test src/engine/scenario-run.test.ts`; expect red: `startScenario`/`scoreScenario` absent.
- [ ] Add the pure score calculation using `Money.from(finalEquity).sub(run.startingEquity).toNumber()`, then assign grades from `scoreBenchmark`; keep win separate. Store `scenarioRun` in export/import and restore the canonical definition by ID.
- [ ] In `concludeTradingDay`, increment `settledDays` after financing and `risk.netLiquidationValue` are computed; produce `result` once on the last settled day. Guard `tick`, `placeOrder`, `cancelOrder`, `skipToNextDay` before any mutation when a result exists. Set the canonical initial regime after construction without drawing RNG.
- [ ] Run focused tests: success/failure, A-but-loss, exact day boundary, repeated settlement, 1x/5x/20x and deterministic replay. Commit the engine and tests.

### Task 2: Optional v1 save compatibility

**Files:** Modify `src/saves/schema.ts` and `src/saves/saves.test.ts`.

**Interfaces:** Optional `scenarioRun` inside `MarketEngineState`/game codec; result fields are finite bounded numbers, grade enum, `success` boolean, scenario ID from the canonical catalogue; `0 <= settledDays <= durationDays`; result requires final day and exactly `durationDays` settled days.

- [ ] Add a failing codec test for a completed run round trip and malformed run rejection; assert `schemaVersion === 1`, saved order/cash/position/career/revision unchanged. Add a legacy `scenarioId`-only fixture that remains unscored.
- [ ] Run `bun run test src/saves/saves.test.ts`; expect red for the new run field.
- [ ] Add optional strict Zod run/result schemas and cross-check canonical scenario ID and day/count/result consistency. Keep the old `scenarioId` nullable and reject a mismatch without modifying or overwriting the save.
- [ ] Run saves tests; commit codec and tests.

### Task 3: Store flow and result UI

**Files:** Modify `src/store/useTerminalStore.ts`, `app/(game)/terminal/page.tsx`; create `src/features/scenario/ScenarioResultModal.tsx`; test `src/store/useTerminalStore.test.ts`.

**Interfaces:** Store derives scenario identity/progress from `engine.getScenarioRun()` on start/restore; `'scenario-result'` modal state. `dismissEodReport()` opens result if the saved run has completed. The result panel reads `engine.getScenarioRun()?.result` and closes without clearing it.

- [ ] Add red tests for start, save capture, restore, EOD→result ordering, direct reload of a completed run, and disabled order/skip actions. Legacy `scenarioId`-only restore stays unscored; career save stays career.
- [ ] Run `bun run test src/store/useTerminalStore.test.ts`; expect red.
- [ ] Wire `startScenario` to initialize the engine run; capture ID from engine when present; restore the canonical identity and show completed result. Keep player actions saving through existing `notePlayerAction()` and day autosave. Render a compact modal using the current terminal tokens and accessible controls, with result, objective and grade displayed separately; show progress and days remaining during play.
- [ ] Run store tests; commit store/UI.

### Task 4: Browser regression and final validation

**Files:** Add `e2e/scenario-completion.spec.ts`; update `docs/ROADMAP.md` with any genuine deferred gap and its trigger.

- [ ] Browser test: launch a scenario in an empty slot, observe canonical regime and progress, settle required days, see EOD then result, reload and confirm the same immutable result; verify order/skip controls cannot change completed data. Check console errors.
- [ ] Run `bun install --frozen-lockfile`, `bun run lint`, `bunx tsc --noEmit`, `bun run test -- --maxWorkers=1`, `bun run build`, and `bash e2e/scripts/run.sh` (guarded disposable Supabase; do not reuse a build compiled under a different env).
- [ ] Review the diff and `git diff --check`; commit final fixes, push `fix/g10-scenario-mechanics`, open PR with the exact title, resolve actionable review findings and leave the PR open/unmerged.
