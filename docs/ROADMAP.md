# TAPE Roadmap and Known Gaps

Developer-facing record of planned work, deferred decisions, and tech debt. The goal is that a deferred decision is never lost: every gap below has a trigger that tells you when it becomes worth doing.

Run a documentation pass whenever you finish a feature or find a gap while working.

## Now

- Cloud saves and accounts (this branch): versioned save format, storage interface, Supabase auth, cross-device sync.
- Profile blob persistence (settings, tutorial progress) via the save layer.

## Next

- Global leaderboard with server-side verification (see GLOBAL-LB).
- Claim-local-saves and account-deletion polish after accounts are stable.
- Per-user AI tutor rate limits once the Learn site exists (see AI-TUTOR).

## Later

- Web Worker simulation if symbol count or frame time grows (see WORKER).
- Market Heatmap panel, Keyboard Shortcuts panel, Learn docs site.
- Additional tradeable asset classes beyond equities.
- Major dependency upgrades (see DEPS).

## Known gaps and tech debt

| ID | Item | Why it is deferred | Trigger to do it | Status |
| --- | --- | --- | --- | --- |
| WORKER | Simulation engine runs on the main thread. It is driven by a 50ms `setInterval` in `app/(game)/terminal/page.tsx` that calls `MarketSimulationEngine.tick`. | 48 symbols at 20x are cheap on a modern machine. The original spec asked for a Web Worker (comlink), but a worker adds an async boundary the UI does not need yet. | More than about 150 symbols, 24/7 crypto, or frame time over 8ms at 20x speed. | Open |
| IMMER | `immer` middleware is not used in the zustand store. | The store is a single flat object and every update is a shallow spread, so there is no nested-state pain to justify it. | When a nested slice (auth plus sync plus profile) makes spread updates error-prone. | Open |
| DEPS | Deferred major upgrades: `react-resizable-panels` (^2.1.7, v3+ changes the public API), `motion` (^12), `typescript` (5.9.3), `eslint` (9.39.1). | Each is a separate migration with its own risk. `react-resizable-panels` v3 especially needs a UI pass. | Upgrade pass each quarter, or when a bug fix or feature you need lands only in a newer major. | Open |
| FLASH-TEST | Watchlist price flash visual timing is verified by eye. | The pure logic is covered: `src/engine/engine.test.ts` tests the $0.01 quantization (no sub-cent flicker) and the speed-scaled per-cell cooldown. The actual animation and opacity ramp are not asserted. | If a flash timing regression reaches players, or if we add visual regression testing. | Open |
| GLOBAL-LB | No global leaderboard. A local rivals leaderboard tab exists in `BottomTabs`, but scores are not submitted or ranked globally. | A global board needs server-side verification: deterministic replay of the seed plus the player action log, with the sim driven by sim-time and not wall-clock. Client-submitted scores cannot be trusted. | After accounts are stable and the save format is frozen. | Open |
| AI-TUTOR | AI tutor does not exist yet. The docs plan rate-limits it per IP. | The feature is not built. When built, per-user limits are only possible once accounts exist. | When the Learn docs site plus AI tutor (OpenRouter via a server route) ships. | Open |
| HEATMAP | Market Heatmap panel is not built. | Planned feature. Should be a D3 treemap using discrete up/down intensity steps drawn from design tokens. | Next feature cycle after cloud saves. | Open |
| SHORTCUTS | Keyboard Shortcuts panel is not built. | Planned feature. Needs a central shortcut registry first so the panel can render real bindings instead of a hand-copied list. | Alongside the next keyboard or accessibility pass. | Open |
| LEARN | Learn docs site is not built. | Planned feature. AI tutor depends on it. | After cloud saves and accounts are stable. | Open |
| ASSETS | Additional asset classes are not tradeable. `src/engine/assets/crypto.ts`, `etf.ts`, `forex.ts`, and `options.ts` exist as types and rules, but only `equity.ts` is wired into `PortfolioEngine` and `OrderMatchingEngine`. | The UI and career progression are built around 48 equities. Adding classes touches the ticket, screener, and risk model. | When players want multi-asset trading and the equity flow is proven. | Open |
| RIVALS-STATUS | Sandbox scenarios and rivals are built, not deferred: `src/data/scenarios.ts` has 4 historical scenarios launched from the title screen, and `src/engine/rivals.ts` runs 8 simulated rival traders shown in the local leaderboard tab. | Rival state (all 8 traders) is now inside the save payload because `MarketEngineState` includes `rivals`, and the envelope carries `scenarioId`. | Resolved. Revisit only if rival simulation gains state outside the engine. | Resolved |
| ACCT-DELETE | Full account deletion (removing the auth user) is not built. The account dialog deletes cloud save rows only. | Removing the auth user needs a server-only route handler holding the service role key. The service role key must never reach the client, so it cannot be part of the client-only cloud-save work. | Before public launch. | Open |
| SYNC-PROFILE | The profile blob (settings, tutorial progress) syncs last-write-wins on `updatedAt`, so a device with an older clock can win. | Single-user data with no merge semantics; conflicts are not meaningful yet. | If profile data becomes multi-device critical or gains fields a user would not want silently replaced. | Open |
| SYNC-TESTS | Cloud sync, the claim flow, and conflict resolution have no automated tests. | They need a live or emulated Supabase backend; only the RLS isolation test is written (`supabase/tests/rls_saves.sql`). | When a Supabase instance is available in CI (local supabase or a test project). | Open |
| LOAD-UI | A load failure shows a plain message, not the full recovery dialog with 'Export raw save' and 'Start new career'. | Reading a damaged save currently returns null, so the raw bytes are not exposed for export. | When a player reports a save that fails to load, or before public launch. | Open |

## Decisions log

- 2026-10-17: Keep the simulation on the main thread. Reason: 48 symbols are cheap and a worker adds an async boundary the UI does not need yet.
- 2026-10-17: Do not add `immer` to the zustand store. Reason: flat state, shallow updates, no pain.
- 2026-10-17: Defer `react-resizable-panels`, `motion`, `typescript`, and `eslint` majors to a dedicated pass. Reason: each is an independent migration with its own risk.
- 2026-10-17: Introduce a versioned save format with a storage interface and migrations before adding any cloud code. Reason: cloud sync is unsafe on top of a lossy, unvalidated save.
- 2026-10-17: Store the cloud copy as a synced replica, with local storage as the source of truth while playing. Reason: gameplay must never block or lose data on a failed sync.
- 2026-10-17: Use optimistic concurrency (match on `revision`) for cloud writes and never overwrite silently on conflict. Reason: two devices editing the same slot must not lose a career.
- 2026-10-17: Accounts are guest-first and passwordless (email magic link, GitHub, Google). Reason: a guest must be able to play fully with no account, and signing in only adds backup and sync.
- 2026-10-17: A cloud push never happens for a slot whose cloud base revision is unknown. Reason: an unread cloud row must surface a conflict dialog, not be overwritten.
- 2026-10-17: Cloud payloads are validated with zod and migrated before use. Reason: cloud data is untrusted input, same as a local file.
- 2026-10-17: RLS on `saves` and `profiles` is the only access control; the client talks to Supabase directly with the anon key. Reason: no custom API surface means fewer places to get authorization wrong.
