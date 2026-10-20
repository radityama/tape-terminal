# G6: Simulated End-of-Day Reporting

## Goal and scope

An end-of-day report must describe the simulated session that just closed, not lifetime performance or a wall-clock hour. G9 is already on `main`; do not change matching, G7 candle time, simulation speed, authentication, or cloud persistence. Keep save schema version 1 and existing careers readable.

## State and settlement

- `PortfolioEngineState.dayStartEquity` already stores the session's opening equity. Use that value for the report. At settlement, apply overnight financing exactly once, then compute closing marked equity and coach risk. Set the following day's opening equity to this post-financing figure. Daily P&L is closing minus opening equity; return is unavailable (`null`) when opening equity is zero or negative.
- `MarketSimulationEngine` stores an optional `dayStartTradeCount`: the length of the **complete**, prepend-only portfolio trade history at the day's start. Today's fills occupy `history.slice(0, history.length - dayStartTradeCount)`. Reset the count to the complete history length at each settlement, and encode/decode it in the existing v1 save schema. UI preview length is irrelevant. A legacy save without the field initializes it from its current full history length: its first resumed day's prior fills may be absent from best/worst, but equity P&L remains valid. If full history is ever truncated, redesign this cursor before enabling truncation.
- Among today's closing fills, compare `realizedPnl - commission` (closing fill commission only). Best and worst can reference the same single close, or both be absent if there were none. A loss-only day still has a negative best close; zero is compared numerically, never with falsy fallbacks. This is **not** fully net position P&L because entry commissions are not allocated to closes.
- Remove the fabricated exposure-times-2% sector attribution; leave it empty and label it unavailable. Keep existing report lifetime/ephemeral behavior otherwise.

## Presentation and regressions

`EndOfDayModal` formats each signed monetary value once. Negative best closes use loss styling; zero is neutral. Clearly distinguish closing-commission-adjusted trade figures from fully net position P&L, and show an unavailable return instead of a percentage with a nonpositive opening balance. Preserve the shared modal and its dismiss behavior.

Red/green tests at the public engine report/export-import seam and v1 save-codec seam cover $10,000 capital, flat/zero/negative equity, margin and short overnight fees, realized/unrealized and commissions, no closes, one close, zero and loss-only closes, consecutive days, forced-liquidation closing fills, more than 50 trades, reload and legacy absence, and 1×/5×/20× rollovers. Browser-check signed results through a disposable local Supabase environment and run the existing guarded E2E suite, lint, typecheck, unit tests, build and diff check. Document any deferred limitation in `docs/ROADMAP.md` with a trigger, including the legacy first-day trade-attribution gap and any player-facing G9 partial-progress gap discovered during smoke.
