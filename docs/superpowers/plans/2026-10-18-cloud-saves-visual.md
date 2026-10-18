# Cloud Saves Merge Review: Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the small bundled design-system pass: one floating shadow token, token-based overlay and accent text colors, one title eyebrow and sentence-case title labels.

**Architecture:** Token definitions in `app/globals.css`, then mechanical class replacements in the listed components. No behavior changes and no new dependencies.

**Tech Stack:** Tailwind CSS 4, Next.js 16.4.2, React 19.

## Global Constraints

- Keep the single 2px radius language. Do not introduce new radii, colors, or shadows.
- The amber accent stays the only accent. Do not recolor semantic up/down states.
- Do not alter terminal micro-labels. The eyebrow and form-label changes apply to the title screen only.
- No em or en dashes in any string or document.
- Do not touch `next-env.d.ts`, `tape.zip`, or local Supabase artifacts.
- Do not stage or commit. The parent reviews, runs the full gate, and commits.

---

### Task 1: Bundle the floating shadow, overlay and accent text tokens

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `src/features/dialog/Dialog.tsx`
- Modify: `src/features/auth/AuthDialogs.tsx`
- Modify: `src/features/auth/SyncIndicator.tsx`
- Modify: `src/features/command-bar/CommandBar.tsx`
- Modify: `src/features/eod-report/EndOfDayModal.tsx`
- Modify: `src/features/watchlist/WatchlistPanel.tsx`
- Modify: `src/features/tutorial/SpotlightTutorial.tsx`
- Modify: `src/features/screener/ScreenerModal.tsx`
- Modify: `src/features/company/CompanyModal.tsx`
- Modify: `src/features/career/CareerModal.tsx`
- Modify: `src/features/toasts/ToastContainer.tsx`
- Modify: `src/features/settings/SettingsModal.tsx`
- Modify: `src/features/topbar/TopBar.tsx`
- Modify: `src/features/chart/TradingViewChart.tsx`
- Modify: `src/features/bottom-dock/BottomTabs.tsx`
- Modify: `src/features/ticket/OrderTicket.tsx`

**Interfaces:**
- Consumes: existing CSS variables in `:root`.
- Produces: `--shadow-float` token and `.shadow-float` utility class used by all floating surfaces.

- [ ] **Step 1: Add the shadow token and utility**

In `app/globals.css`, add to the `:root` block after `--down: #E5534B;`:
```css
  /* Single floating-surface elevation. Hairline ring plus one soft drop. */
  --shadow-float: 0 0 0 1px rgba(255, 255, 255, 0.04), 0 12px 32px rgba(0, 0, 0, 0.4);
```

After the `:root` block add:
```css
.shadow-float {
  box-shadow: var(--shadow-float);
}
```

- [ ] **Step 2: Replace the old shadow utilities**

Replace every `shadow-2xl` and `shadow-lg` class with `shadow-float` in these files only:
`app/page.tsx` (price ladder), `src/features/dialog/Dialog.tsx`, `src/features/auth/SyncIndicator.tsx`, `src/features/command-bar/CommandBar.tsx`, `src/features/eod-report/EndOfDayModal.tsx`, `src/features/watchlist/WatchlistPanel.tsx` (context menu), `src/features/tutorial/SpotlightTutorial.tsx`, `src/features/screener/ScreenerModal.tsx`, `src/features/company/CompanyModal.tsx`, `src/features/career/CareerModal.tsx`, `src/features/toasts/ToastContainer.tsx`.

- [ ] **Step 3: Use the canvas color for modal overlays**

Replace both `bg-black/75` and `bg-black/80` with `bg-[var(--bg-0)]/80` in:
`src/features/dialog/Dialog.tsx`, `src/features/eod-report/EndOfDayModal.tsx`, `src/features/screener/ScreenerModal.tsx`, `src/features/command-bar/CommandBar.tsx`, `src/features/company/CompanyModal.tsx`, `src/features/career/CareerModal.tsx`, `src/features/bottom-dock/BottomTabs.tsx`, `src/features/ticket/OrderTicket.tsx`.

- [ ] **Step 4: Use the canvas color for text on the accent**

Replace `text-black` with `text-[var(--bg-0)]` wherever the text sits on `bg-[var(--accent)]` or `hover:bg-[var(--accent)]`:
- `app/layout.tsx` selection styles: `selection:text-black` becomes `selection:text-[var(--bg-0)]`.
- `app/page.tsx` account button, selected difficulty, start button.
- `src/features/dialog/Dialog.tsx` primary button.
- `src/features/auth/AuthDialogs.tsx` primary button class.
- `src/features/tutorial/SpotlightTutorial.tsx` next button.
- `src/features/eod-report/EndOfDayModal.tsx` continue button.
- `src/features/screener/ScreenerModal.tsx` hover state: `hover:text-black` becomes `hover:text-[var(--bg-0)]`.
- `src/features/company/CompanyModal.tsx` primary button.
- `src/features/settings/SettingsModal.tsx` three accent buttons.
- `src/features/topbar/TopBar.tsx` speed buttons and the accent hover icon button.
- `src/features/chart/TradingViewChart.tsx` active timeframe.
- `src/features/ticket/OrderTicket.tsx` accent confirm button.

Leave `text-black` on `bg-[var(--up)]` and `bg-[var(--down)]` unchanged, they are outside this pass.

- [ ] **Step 5: Drop text selection blocking from the dialog shell**

In `src/features/dialog/Dialog.tsx`, remove `select-none` from the fixed backdrop wrapper so dialog text can be selected. Keep selection rules on terminal panels and controls unchanged.

- [ ] **Step 6: Reduce the title eyebrow to one and use sentence case**

In `app/page.tsx`:
- Delete the `CLIENT-SIDE SIMULATION` span, keeping only the `STOCKS EDITION` badge in that row.
- Change the label `Universe Seed` to `Universe seed`.
- Change the label `Difficulty Preset` to `Difficulty preset`.
- Leave all terminal labels unchanged.

- [ ] **Step 7: Verify the pass**

Run:
```bash
grep -rn 'shadow-2xl\|shadow-lg' app src --include='*.tsx'
grep -rn 'bg-black/75\|bg-black/80' app src --include='*.tsx'
grep -rn 'CLIENT-SIDE SIMULATION' app/page.tsx
grep -n 'Universe Seed\|Difficulty Preset' app/page.tsx
grep -n 'shadow-float' app/globals.css app/page.tsx src/features/dialog/Dialog.tsx
grep -n 'select-none' src/features/dialog/Dialog.tsx
git diff --check
```

Expected: the first three greps print nothing, the title-label grep prints nothing, `shadow-float` appears in the token file and the sampled components, the Dialog grep prints nothing, and `git diff --check` prints nothing.

- [ ] **Step 8: Check contrast and report**

Run this one-off check from the repo root:
```bash
python3 - <<'PY'
def lum(hex_color):
    c = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

for fg, bg, label in [
    ('#E0A03A', '#0A0B0D', 'accent text on canvas'),
    ('#E0A03A', '#0F1114', 'accent text on panel'),
    ('#0A0B0D', '#E0A03A', 'canvas text on accent'),
]:
    print(f'{label}: {ratio(fg, bg):.2f}:1')
PY
```

Expected: every ratio is at least 4.5:1. Report the values.

- [ ] **Step 9: Report, do not commit**

Report changed files, grep output, contrast ratios, and any deviation. Leave staging and `bun run check` to the parent.
