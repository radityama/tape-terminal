# G10 Scenario Mechanics Design

## Scope

Make the four existing scenarios in `src/data/scenarios.ts` playable as separate, scored $100,000 sessions. Preserve the selected scenario's seed and first featured ticker. Apply its `initialRegime`, `durationDays`, `targetProfit`, and `scoreBenchmark`. Do not change an existing career, market price/RNG formulas, order execution, cloud conflict behavior, or G11/G12.

## Session and state

Starting a scenario requires the existing empty-slot flow. Create a fresh `MarketSimulationEngine` in sandbox mode, set its pricing regime to the scenario's `initialRegime` without consuming extra random draws, then record a scenario run in the engine state. The run stores the canonical scenario ID, starting simulated day, starting net liquidation equity, settled-day count, and an optional immutable result. The scenario's target, duration, and benchmark come from its canonical definition, not user-editable save fields. Keep the top-level v1 `scenarioId` for compatibility and add an optional run field to the v1 game state. Only a newly started scenario creates a run. A legacy save with `scenarioId` but no run remains an unscored sandbox session; a career or ordinary sandbox save must never become scored on import. A saved run whose ID is unknown or disagrees with the top-level ID must fail safe rather than score against a different definition.

The engine owns progress and result, not transient Zustand state. Restore the selected scenario and completion UI from the saved run. Save through the existing manager and preserve its revision, sequence, device identity, conflict, and recovery protections. Starting or restoring a scenario must not modify another slot or career. No scenario awards or career rewards are created.

## Settlement and scoring

The start day is the engine's `simDay` at scenario creation. Each completed trading day increments settled-day count exactly once at the same settlement boundary used for EOD reporting. A skipped day counts as a settled day. During final settlement, apply fees and financing first and obtain final net liquidation equity from the authoritative portfolio risk calculation. Compute `netGain = finalEquity - startingEquity` in money precision; do not sum trade P&L or use a fixed baseline. Completion occurs after exactly `durationDays` settled days, not when the next day's clock first ticks.

The product-approved, profit-only score is `Math.round(clamp(10000 * netGain / targetProfit, 0, 10000))`. The separate objective succeeds when `netGain >= targetProfit`. Grade A requires `score >= scoreBenchmark`; B requires `score >= 0.75 * scoreBenchmark`; C requires `score >= 0.5 * scoreBenchmark`; D is below C. Use the first matching threshold. A grade may occur without objective success. Risk is not penalized; no extra multipliers, bonuses, awards, or invented grade tiers. Persist the final day, equity, net gain, score, grade, and objective success as an immutable result; repeated settlement, rendering, or reload must not recompute or duplicate it.

## Completion and presentation

When the last day settles, show the ordinary EOD report first, then a scenario result with scenario title, settled days, final equity, net gain, target, objective outcome, score, grade, and benchmark. Reloading a completed scenario shows the persisted result even though the transient EOD report is not saved. Progress before completion shows the scenario title and settled days remaining without treating it as a career rank. Reuse the terminal's existing visual language and shared dialog component; do not redesign the workspace.

After completion, freeze simulation time, order placement/cancellation, and skip-to-next-day, including direct engine API calls. Existing orders remain visible but inactive; do not cancel, fill, or silently rewrite them. The terminal and result remain inspectable and reloadable. No post-completion scoring or awards occur.

## Compatibility and validation

The optional v1 run field must decode and encode without changing the schema version. Legacy saves without it retain all existing cash, positions, fills, open orders, career state, candle compatibility, and cloud revisions. Reject malformed run/result data at the save boundary; do not silently replace a valid cloud or local copy. Cover all four definitions, initial regimes and featured tickers, first/final/extra settlement boundaries, win and miss, A without win, grade thresholds, pause and 1x/5x/20x, deterministic replay, mid-run and completed save/reload, legacy scenario and non-scenario saves, no duplicate result or post-completion mutations. Add browser coverage for start, progress, completion, and resume. Run frozen install, lint, typecheck, full unit suite, production build, and guarded disposable-Supabase Playwright. G10 ships as an open, unmerged PR titled `fix(gameplay): enforce scenario rules and completion` on `fix/g10-scenario-mechanics`.
