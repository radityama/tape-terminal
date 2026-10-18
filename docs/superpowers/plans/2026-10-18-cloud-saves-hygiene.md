# Cloud Saves Merge Review: Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove leftover AI Studio and unsupported tooling from the repository without deleting the user's local files.

**Architecture:** Git tracking, ignore rules, package identity and documentation only. No application code changes.

**Tech Stack:** Git, Bun, Next.js 16.4.2, Markdown.

## Global Constraints

- Do not delete local `.aistudio/` files. Untrack them only.
- Do not touch generated `next-env.d.ts`, `tape.zip`, or local Supabase artifacts.
- No em or en dashes in any string or document.
- Do not stage or commit in the child task. The parent reviews and commits.
- The installed Next.js 16.4.2 CLI guide at `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md` lists no `clean` command, so the script must be removed.

---

### Task 1: Remove stale repository identity and untrack local artifacts

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Untrack: `.aistudio/` (8 tracked PNGs)

**Interfaces:**
- Consumes: nothing from earlier groups.
- Produces: package name `tape`, `CLAUDE.md` that imports `AGENTS.md`, a README roadmap link.

- [ ] **Step 1: Untrack the AI Studio artifacts without deleting them**

Run:
```bash
git rm -r --cached .aistudio
```

Expected: eight `rm '.aistudio/...'` lines, and `ls .aistudio/artifacts` still lists the local files.

- [ ] **Step 2: Ignore the local tool folders**

Append to `.gitignore`:
```gitignore
.aistudio/
.freebuff/
```

- [ ] **Step 3: Rename the package and drop the unsupported script**

In `package.json` change line 2 to:
```json
  "name": "tape",
```
Remove this trailing comma and script entry:
```json
    "check": "bun run lint && bunx tsc --noEmit && bun run test && bun run build",
    "clean": "next clean"
```
so the block ends:
```json
    "check": "bun run lint && bunx tsc --noEmit && bun run test && bun run build"
```

In `bun.lock` change the workspace name at line 6 from `"name": "ai-studio-applet"` to `"name": "tape"`.

- [ ] **Step 4: Make CLAUDE.md delegate to AGENTS.md**

Replace the whole file `CLAUDE.md` with exactly:
```markdown
@AGENTS.md
```

- [ ] **Step 5: Link the roadmap from the README**

After the line `TAPE is a professional, browser-based stock trading game and financial terminal. It combines Bloomberg-class information density, realistic market microstructure, and a career progression system. Everything runs client-side with deterministic seeded generation.` add:
```markdown

Planning, known gaps and deferred work live in [docs/ROADMAP.md](docs/ROADMAP.md).
```

- [ ] **Step 6: Verify the hygiene changes**

Run:
```bash
git ls-files .aistudio
git check-ignore -v .aistudio/artifacts/brain/95502694-bf23-4926-a419-4ffadc54c187/.tempmediaStorage/media_1792237774290_7693c283.png
grep -rn 'ai-studio-applet' package.json bun.lock
grep -rn 'next clean' package.json
test -d .aistudio/artifacts && echo local-aistudio-kept
git diff --check
```

Expected: `git ls-files .aistudio` prints nothing, `git check-ignore` prints the `.aistudio/` rule, both greps print nothing, `local-aistudio-kept` prints, and `git diff --check` prints nothing.

- [ ] **Step 7: Report, do not commit**

Report the exact command output and any deviation. Leave staging and the full `bun run check` to the parent.
