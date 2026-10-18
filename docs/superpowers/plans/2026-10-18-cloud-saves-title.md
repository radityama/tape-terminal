# Cloud Saves Title Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never mistake an unreadable save list for empty slots; show retryable load failures and prevent concurrent career starts.

**Architecture:** Let the save manager propagate list failures. Keep retry and busy UI on the title screen, with small pure functions for failure copy and exclusive actions so both behaviors are testable without a browser harness. Remove the query-string autostart bypass.

**Tech Stack:** Next.js 16.4.2 client page, React 19, Vitest, Dexie, Bun.

## Global Constraints

- Work on `feat/cloud-saves`; do not merge.
- Write a failing test before each bug fix, then make it pass.
- Commit this group after `bun run check` passes.
- No em or en dashes in new strings or docs; no native browser dialogs.
- Preserve player saves and unrelated generated/untracked files.
- Add deferred gaps to `docs/ROADMAP.md` with a trigger.

---

### Task 1: Surface save-list failures

**Files:** Modify `src/saves/manager.test.ts`, `src/saves/manager.ts`, `src/features/auth/AuthDialogs.tsx`.

**Interfaces:** `saveManager.listAllSlots(): Promise<MergedSlot[]>` now rejects when either source fails; `app/page.tsx` and `SettingsModal.tsx` already catch it. Auth dialogs must not leave unhandled rejections.

- [ ] **Step 1: Write the failing test.** Add to `src/saves/manager.test.ts` after existing listing tests:

```ts
test('a failed save listing is not mistaken for three empty slots', async () => {
  saveManager.setStore({
    list: async () => { throw new Error('disk unavailable'); },
    get: async () => null,
    put: async () => ({ ok: false, reason: 'invalid', message: 'unavailable' }),
    delete: async () => {},
  });
  await expect(saveManager.listAllSlots()).rejects.toThrow('disk unavailable');
});
```

- [ ] **Step 2: Confirm red.** Run `bunx vitest run src/saves/manager.test.ts -t 'failed save listing'`; expect rejection assertion to fail because the manager returns `[]`.
- [ ] **Step 3: Remove the swallowing at the source.** In `listAllSlots`, use `const local = await this.listSlots(); const cloud = this.cloud ? await this.cloud.list() : [];` and keep the merge logic unchanged. A cloud failure must reject even when local slots are readable.
- [ ] **Step 4: Fail closed at the auth callers.** In `AccountDialog` and `ClaimSavesDialog` in `src/features/auth/AuthDialogs.tsx`, catch list rejection without replacing unknown data with an empty list. Account: track a list error, show a short `role="alert"` message, and disable `Delete my cloud saves` until the count is known. Claim: fetch local and merged slots in `Promise.all`, set both lists only on success, track a list error, render `role="alert"` on failure and disable `Upload to my account` until both lists are known. Never treat a failed cloud listing as zero occupied cloud slots: that could overwrite an unknown save. On a failed claim listing, show a Retry button that repeats the read. Do not leave unhandled promise rejections.
- [ ] **Step 5: Verify.** Targeted test must pass; `bunx tsc --noEmit` must pass.

### Task 2: Guard concurrent career starts

**Files:** Modify `src/saves/slots.ts`, `src/saves/slots.test.ts`, `app/page.tsx`.

**Interfaces:** Export `runExclusive(inFlight: { current: boolean }, action: () => Promise<void>): Promise<boolean>` from `slots.ts`. It returns false without invoking `action` when one is active; a rejection resets the flag and propagates.

- [ ] **Step 1: Add red tests to `slots.test.ts`.** Add `runExclusive` to its import and test an unresolved first action, suppressed second action, third action after settlement, and a rejecting action that releases the guard:

```ts
test('only one start runs at a time and a failed start releases the guard', async () => {
  const guard = { current: false };
  let release!: () => void;
  const first = runExclusive(guard, () => new Promise<void>((resolve) => { release = resolve; }));
  expect(guard.current).toBe(true);
  expect(await runExclusive(guard, async () => { throw new Error('ran twice'); })).toBe(false);
  release();
  expect(await first).toBe(true);
  await expect(runExclusive(guard, async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
  expect(guard.current).toBe(false);
  expect(await runExclusive(guard, async () => {})).toBe(true);
});
```

- [ ] **Step 2: Confirm red.** Run `bunx vitest run src/saves/slots.test.ts`; expect missing export.
- [ ] **Step 3: Implement the guard in `slots.ts`.** Use a synchronous ref assignment before awaiting:

```ts
export async function runExclusive(inFlight: { current: boolean }, action: () => Promise<void>): Promise<boolean> {
  if (inFlight.current) return false;
  inFlight.current = true;
  try {
    await action();
    return true;
  } finally {
    inFlight.current = false;
  }
}
```

- [ ] **Step 4: Wire the same guard to both entry points.** In `app/page.tsx`, add `useRef`, `const inFlight = useRef(false)`, `const [starting, setStarting] = useState(false)`. Add a local `runStart(action)` that calls `runExclusive(inFlight, async () => { setStarting(true); try { await action(); } finally { setStarting(false); } })`; `handleStartCareer` wraps its existing list/choose/start flow with it. `ReplaceSlotDialog.onReplace` also wraps its close/start flow with it. Disable Start New Career when `starting || !authReady || !slotsReady`; while busy show `Creating career...` and disable the destructive choice button if it remains open. Keep the existing save failure rollback.
- [ ] **Step 5: Verify.** Run slot tests and typecheck; assert from tests that a rejected first action releases the guard.

### Task 3: Retryable load and restore errors

**Files:** Create `src/saves/loadFeedback.ts` and `src/saves/loadFeedback.test.ts`; modify `app/page.tsx`, `docs/ROADMAP.md`.

**Interfaces:** Export `loadFailureMessage(outcome: Exclude<LoadOutcome, { ok: true }>): string`. Never interpolate raw corrupt details. A failed list has a global Retry button; a failed resume has a per-slot Retry button; a failed history restore has a per-slot Retry button that reopens confirmation.

- [ ] **Step 1: Write a failing copy test.** In `src/saves/loadFeedback.test.ts`, test missing, newer, corrupt and never echo a raw detail:

```ts
import { expect, test } from 'vitest';
import { loadFailureMessage } from './loadFeedback';
import { SaveCorruptError, SaveVersionError } from './localStore';

test('load errors name the failure without showing untrusted save contents', () => {
  expect(loadFailureMessage({ ok: false, reason: 'missing' })).toMatch(/no longer available/i);
  expect(loadFailureMessage({ ok: false, reason: 'newer', error: new SaveVersionError(99, 1) })).toMatch(/newer version/i);
  const corrupt = new SaveCorruptError('<script>unsafe</script>');
  expect(loadFailureMessage({ ok: false, reason: 'corrupt', error: corrupt })).not.toContain('unsafe');
});
```

- [ ] **Step 2: Confirm red.** Run `bunx vitest run src/saves/loadFeedback.test.ts`; expect missing module.
- [ ] **Step 3: Implement fixed messages in `loadFeedback.ts`.** Use a type-only import of `LoadOutcome` from `./manager` and a switch on `outcome.reason`: missing -> `This save is no longer available.`, newer -> `This save needs a newer version of TAPE.`, corrupt -> `This save is damaged and could not be loaded.`.
- [ ] **Step 4: Make title errors visible and retryable.** Extract `loadSlots()` in `app/page.tsx` from the auth-ready effect. On start reset `slotsReady=false` and listing error; on success set slots/history/slotsReady; on failure set listing error and leave Start disabled. Render `<p role="alert">Could not check save slots.</p>` plus `<button onClick={() => void loadSlots()}>Retry</button>` in place of the skeleton on failure. Handle `saveManager.load()` failed outcomes and thrown failures in `handleContinue` with a slot-keyed error; show it under that slot's row with `role="alert"` and Retry calling `handleContinue(slot)`. Wrap `restoreHistory()` in try/catch, close the confirmation after false/throw, show a slot-keyed alert and Retry that reopens the confirmation, never repeat a destructive restore without confirmation. Clear errors on success. Avoid state updates after effect unmount.
- [ ] **Step 5: Remove `?autostart=1` bypass.** Delete the query-param branch from the title ladder effect and change its comment to `// Decorative preview only; saved market prices come from the seeded simulation.`; reduce the effect dependencies to `[]`. This prevents a query from bypassing slot selection and an occupied save confirmation.
- [ ] **Step 6: Update roadmap.** Rewrite the Open `LOAD-UI` row: inline errors and retry now exist; full damaged-save recovery and raw export remain deferred with trigger `Before public launch, or on a reported unreadable save`. Append a dated decision explaining why listing failures block new starts. Do not mark the row Resolved.
- [ ] **Step 7: Verify and commit.** Run `bun run check` and `git diff --check`; stage only the files in this plan and this plan file, then commit `fix(saves): show title load failures and guard career starts`. Leave generated `next-env.d.ts` unstaged.

## Self-review checkpoints

- A failed local or cloud listing cannot be interpreted as an empty slot.
- Busy exclusion happens synchronously before the first await for both start paths.
- A failed restore never retries destructively without another explicit confirmation.
- Existing title-to-terminal success paths and failed-save rollback remain intact.
