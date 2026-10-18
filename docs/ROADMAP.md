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
| SYNC-TESTS | Cloud sync, the claim flow, and conflict resolution have unit tests with a mocked Supabase client, but no end-to-end test against a real backend. | A full E2E needs a live or emulated Supabase backend; only the RLS isolation test runs against the local stack (`supabase/tests/rls_saves.sql`). | When a Supabase instance is available in CI (local supabase or a test project). | Open |
| CONFLICT-DETAIL | The conflict dialog shows sim day and seq for each side, but not the trade count the design asked for. | `SaveMeta` does not carry a trade count, and adding it to the cloud row means another column plus a migration. | When conflict resolution needs richer diffs, or when save meta gains a trade count for another reason. | Open |
| SAVE-CEILING | Saves refuse decimals at or above `MAX_SAVE_DECIMAL` (1e15) because fixed-point `toFixed` output is only reliable well below that. | Every current asset is an equity priced far below the cap, and the engine clamps prices to 10x fair value. | If an asset class with very large nominal prices (for example crypto at extreme prices) becomes tradeable. | Open |
| HISTORY-CLOUD | Autosave history is local only: the last 3 versions per slot, at most one per sim day. A new device cannot roll back. | Cloud history needs a retention policy and a second table with its own RLS; nobody has asked for cross-device rollback. | If players report losing progress on a second device, or ask for cross-device restore. | Open |
| E2E-RELOAD | The autosave, seq guard, history restore and profile push flows are covered by unit tests, not by a scripted browser run. | Browser QA was manual and found the original data-loss bug; a scripted run needs a seeded IndexedDB plus a live local Supabase stack. | Before merge of `feat/cloud-saves`, or when browser E2E tooling lands. | Open |
| AUTH-CALLBACK | The `/auth/callback` route has no automated test. It was verified manually against the local Supabase stack only. | Exercising PKCE end to end needs a live auth issuer, and mocking the exchange would test the mock rather than the route. | Add it to the browser E2E suite before public launch. | Open |
| DIALOG-E2E | Destructive dialog focus and cancellation were checked manually in the browser. The rollback path when IndexedDB refuses a new-career or seed replacement has no automated UI test. | Slot choice is unit-tested, but simulating a failed browser write needs an interactive test harness. | Add a write-failure and keyboard dialog case when browser E2E tooling lands, or if a replacement save failure is reported. | Open |
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
- 2026-10-17: Save/sync status lives in the bottom status bar (plus the Settings save row), not the top bar. Reason: the top bar is for trading controls and portfolio figures; always-on system state belongs with the other status-bar meta (engine, regime).
- 2026-10-18: A save carries a monotonic `seq` that increments on every sim day advance, fill, placed order and cancelled order. A capture whose seq is below the stored slot's seq is refused, and loading binds the session to the loaded seq. Reason: a fresh engine on reload silently overwrote a real position; revision checks alone could not tell stale content from new content.
- 2026-10-18: Captures are gated on an explicit session state (`none`, `loading`, `ready`) bound to a slot and an engine id. Autosave and cloud sync run only for a ready session capturing the bound engine. Reason: autosave fired before hydration finished and captured the wrong engine.
- 2026-10-18: Player actions write the local slot immediately; only the cloud push is debounced. Reason: a reload right after a fill lost the trade, and Dexie writes are cheap.
- 2026-10-18: Keep a rolling local autosave history of the last 3 versions per slot, at most one per sim day, with a Restore previous autosave action on the title screen. Reason: a bad write should be recoverable without a cloud round trip.
- 2026-10-18: Derive the sync status from one state machine. `synced` requires a successful push, an unchanged cloud revision and a clean local snapshot. Reason: the footer said Synced while a stale local copy had already diverged from the cloud.
- 2026-10-18: Apply the market regime volatility multiplier outside the GARCH recursion, clamp conditional vol per symbol, clamp the per-step return to plus or minus 25 percent, and keep prices inside 0.1x to 10x fair value. Reason: the multiplier inside the recursion made volatility explode in bear and panic regimes, producing prices around 1e54 by day 60.
- 2026-10-18: Serialize every money value as fixed-point text and reject non-finite or out-of-range decimals at the boundary. Reason: scientific notation failed the decimal regex and made saves unsavable.
- 2026-10-18: On load, repair pre-fix saves that contain absurd prices by resetting the affected symbols to fair value, and tell the player once. Reason: old saves must not be silently destroyed by the new bounds.
- 2026-10-18: Export pending earnings jumps (`activeJumpDeltas`) as part of the engine state. Reason: a day-boundary save dropped a queued jump, so a restored engine diverged from the live one on the next tick.
- 2026-10-18: Materialize the profile blob from the live store on sign in when the device has no local copy, then push it; later changes write local immediately and push debounced. Newer `updatedAt` wins and a malformed cloud profile is ignored. Reason: the profiles table stayed empty because nothing ever created a local profile to upload.
- 2026-10-18: Cap the profile blob at 64 KB and skip the cloud push above it. Reason: settings, tutorial progress and layouts are small, and an unbounded blob would compete with save payload limits.
- 2026-10-18: Magic links and OAuth return through a dedicated `/auth/callback` route handler that exchanges the PKCE code server-side, then forwards to `next` or `/terminal`. Reason: the browser client only exchanged codes on pages that initialized auth, so a link opened on the title screen left the player signed out.
- 2026-10-18: The title screen initializes auth on mount, resolves the account before listing slots and shows a "Checking account" skeleton tile until then; signed-in players get the account menu instead of the sign-in link. Reason: cloud rows were merged in after first paint and the sign-in entry point never appeared because auth was never initialized there.
- 2026-10-18: When Supabase env vars are missing, all account UI stays hidden and only a single development warning is logged. Reason: the app must remain a clean guest experience with local saves.
- 2026-10-18: The auth callback builds its redirect from the request Host header instead of `request.url`. Reason: Next normalizes the request URL to the server's local origin, and a redirect across hosts (127.0.0.1 to localhost) silently dropped the session cookies.
- 2026-10-18: Wire the cloud store once per signed-in user, and adopt the existing cloud revision as the base when the local seq is not older. Reason: Supabase emits INITIAL_SESSION right after getSession, so wiring twice reset the base revisions and a reload could report a false conflict against the player's own save.
