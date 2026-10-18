# Cloud Saves Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent hostile auth redirects and anonymous reads of save/profile tables without changing existing player data.

**Architecture:** Keep redirect and origin validation in pure helpers under `src/lib/supabase/`, called by the existing Next route. Add a forward-only SQL migration for table grants. Preserve the applied first migration and the shared `pgcrypto` extension.

**Tech Stack:** Next.js 16.4.2 route handler, Vitest, Supabase CLI, PostgreSQL RLS tests, Bun.

## Global Constraints

- Branch stays `feat/cloud-saves`; do not merge.
- Test first for callback redirects, error copy and anonymous database reads.
- Commit this security group once `bun run check` and the local RLS assertions pass.
- Do not add em or en dashes in strings or documentation.
- Do not print secrets, rewrite the applied `0001_cloud_saves.sql`, or reset a database containing local QA data.
- Leave generated `next-env.d.ts` and unrelated untracked artifacts alone.
- Every deferred gap belongs in `docs/ROADMAP.md` with a trigger.

---

### Task 1: Safe callback path and trusted origin

**Files:**
- Create: `src/lib/supabase/callback.ts`
- Create: `src/lib/supabase/callback.test.ts`
- Modify: `app/auth/callback/route.ts`

**Interfaces:**
- Consumes: Web `URL`, `Request`, Next `NextResponse`, existing `createServerSupabase()`.
- Produces: `safeNext(value: string | null, origin: string): string`, `callbackOrigin(request: Request, siteUrl?: string): string`, `authErrorMessage(code: string | null): string`.

- [ ] **Step 1: Write the failing helper tests.** Create `src/lib/supabase/callback.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { authErrorMessage, callbackOrigin, safeNext } from './callback';

const origin = 'https://tape.example';

describe('safeNext', () => {
  test.each([
    ['/terminal', '/terminal'],
    ['//evil.com', '/terminal'],
    ['/\\evil.com', '/terminal'],
    ['/\t/evil.com', '/terminal'],
    ['/%2F%2Fevil.com', '/terminal'],
    ['https://evil.com', '/terminal'],
    ['', '/terminal'],
    [null, '/terminal'],
    ['/terminal?tab=positions', '/terminal?tab=positions'],
  ])('%s resolves to %s', (value, expected) => {
    expect(safeNext(value, origin)).toBe(expected);
  });
});

test('configured origin ignores forwarded host and accepts only an HTTP site URL', () => {
  const request = new Request('http://127.0.0.1:3100/auth/callback', {
    headers: { host: 'attacker.test', 'x-forwarded-host': 'attacker.test' },
  });
  expect(callbackOrigin(request, 'https://tape.example/app')).toBe(origin);
  expect(() => callbackOrigin(request, 'javascript:alert(1)')).toThrow();
  expect(() => callbackOrigin(request, '   ')).toThrow();
});

test('without a configured URL the local forwarded-host behavior remains', () => {
  const request = new Request('http://127.0.0.1:3100/auth/callback', {
    headers: { 'x-forwarded-host': 'localhost:3100', 'x-forwarded-proto': 'http' },
  });
  expect(callbackOrigin(request)).toBe('http://localhost:3100');
});

test('provider errors never echo attacker-supplied descriptions', () => {
  expect(authErrorMessage('access_denied')).toBe('Sign in was cancelled.');
  expect(authErrorMessage('otp_expired')).toBe('This sign-in link has expired. Request a new one.');
  expect(authErrorMessage('<script>alert(1)</script>')).toBe('Sign in could not be completed. Please try again.');
});
```

- [ ] **Step 2: Confirm the red tests.** Run `bunx vitest run src/lib/supabase/callback.test.ts`. Expect a missing `./callback` module error.

- [ ] **Step 3: Implement the helper.** Create `src/lib/supabase/callback.ts`:

```ts
const DEFAULT_NEXT = '/terminal';

export function safeNext(value: string | null, origin: string): string {
  if (!value || !value.startsWith('/') || /[\\\s\x00-\x1f\x7f]/.test(value)) return DEFAULT_NEXT;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || decoded.startsWith('/\\') || /[\\\s\x00-\x1f\x7f]/.test(decoded)) {
      return DEFAULT_NEXT;
    }
    const target = new URL(value, origin);
    if (target.origin !== new URL(origin).origin || target.pathname.startsWith('//')) return DEFAULT_NEXT;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

export function callbackOrigin(request: Request, siteUrl?: string): string {
  if (siteUrl !== undefined && siteUrl !== '') {
    if (/[\\\s\x00-\x1f\x7f]/.test(siteUrl)) throw new Error('Invalid NEXT_PUBLIC_SITE_URL');
    const configured = new URL(siteUrl);
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password) {
      throw new Error('Invalid NEXT_PUBLIC_SITE_URL');
    }
    return configured.origin;
  }
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return host ? `${proto}://${host}` : url.origin;
}

export function authErrorMessage(code: string | null): string {
  if (code === 'access_denied') return 'Sign in was cancelled.';
  if (code === 'otp_expired') return 'This sign-in link has expired. Request a new one.';
  return 'Sign in could not be completed. Please try again.';
}
```

- [ ] **Step 4: Update the route to consume the tested helpers.** Replace `app/auth/callback/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../src/lib/supabase/server';
import { authErrorMessage, callbackOrigin, safeNext } from '../../../src/lib/supabase/callback';

function errorRedirect(origin: string, message: string) {
  return NextResponse.redirect(new URL(`/terminal?auth_error=${encodeURIComponent(message)}`, origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let origin: string;
  try {
    origin = callbackOrigin(request, process.env.NEXT_PUBLIC_SITE_URL);
  } catch {
    return new Response('Sign in is not configured on this deployment.', { status: 500 });
  }
  const code = url.searchParams.get('code');
  const providerCode = url.searchParams.get('error');
  const next = safeNext(url.searchParams.get('next'), origin);

  if (providerCode || url.searchParams.has('error_description')) {
    return errorRedirect(origin, authErrorMessage(providerCode));
  }
  if (!code) return errorRedirect(origin, 'The sign-in link is missing its code.');

  const supabase = await createServerSupabase();
  if (!supabase) return errorRedirect(origin, 'Sign in is not configured on this deployment.');

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return errorRedirect(origin, authErrorMessage(error.code ?? null));

  return NextResponse.redirect(new URL(next, origin));
}
```

- [ ] **Step 5: Verify helper and route.** Run `bunx vitest run src/lib/supabase/callback.test.ts` (all tests pass) and `bunx tsc --noEmit` (no errors). Keep existing local forwarded-host behavior only when the optional site URL is unset.

### Task 2: Deny anonymous reads by grant

**Files:**
- Create: `supabase/migrations/0002_tighten_grants.sql`
- Modify: `supabase/tests/rls_saves.sql:82-93`

**Interfaces:**
- Consumes: applied `0001_cloud_saves.sql`, existing owner-isolation assertions.
- Produces: a forward-only anonymous SELECT revocation and a transactional SQL test proving `insufficient_privilege` on both tables.

- [ ] **Step 1: Replace the anonymous assertion at the end of `supabase/tests/rls_saves.sql` with the red test.** Keep the preceding assertions intact:

```sql
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{}';

do $$
declare denied boolean := false;
begin
  begin
    perform count(*) from public.saves;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous SELECT on saves was not denied'; end if;

  denied := false;
  begin
    perform count(*) from public.profiles;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous SELECT on profiles was not denied'; end if;
end;
$$;

rollback;
```

- [ ] **Step 2: Confirm red against local 0001-only schema.** On the disposable local Supabase stack, run `docker exec -i supabase_db_tape-terminal psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f /dev/stdin < supabase/tests/rls_saves.sql`; expect `Anonymous SELECT on saves was not denied`. If the container is not running, use `bunx supabase start` first. Do not reset the local QA database.

- [ ] **Step 3: Add the minimal forward migration.** Create `supabase/migrations/0002_tighten_grants.sql`:

```sql
revoke select on public.saves, public.profiles from anon;
```

- [ ] **Step 4: Apply only pending migrations and rerun the SQL test.** Run `bunx supabase migration up --local`, then rerun `docker exec -i supabase_db_tape-terminal psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f /dev/stdin < supabase/tests/rls_saves.sql`. Expect exit 0 and `ROLLBACK`; anonymous reads must raise insufficient privilege while authenticated owner checks still pass. The CLI reference confirms `migration up --local` applies pending migrations without resetting existing rows.

### Task 3: Document deployment boundary and commit security group

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (Supabase setup section)
- Modify: `docs/ROADMAP.md` (known gaps and decisions log)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SITE_URL` from Task 1 and grant migration from Task 2.
- Produces: public-deployment origin instructions and explicit client-seq trust boundary.

- [ ] **Step 1: Add the optional deployment origin to `.env.example`.** After the Supabase variables, add:

```text
# On hosted deployments, set this to the public app origin so auth callbacks
# never derive redirect hosts from forwarded request headers.
NEXT_PUBLIC_SITE_URL=""
```

- [ ] **Step 2: Extend README's Supabase setup.** Add these sentences near the existing callback setup: `Set NEXT_PUBLIC_SITE_URL to the public app origin on hosted deployments, for example https://tape.example. Leave it empty for local development, where the callback uses the incoming host. Allow <origin>/auth/callback in Supabase Auth redirect URLs. Apply the forward migration with bunx supabase migration up --local on the local stack; do not reset a database containing saves.`

- [ ] **Step 3: Update `docs/ROADMAP.md`.** Add an Open row `SEQ-TRUST` explaining the seq guard is client-only and must not be trusted for a global leaderboard, with trigger `When global leaderboard submissions are designed` and server validation of submissions; append dated decisions for safe callback paths (including normalized leading double slashes), configured public origin, fixed auth error messages and revoking anonymous grants. Record that applied 0001 retains its historical pgcrypto declaration and 0002 does not drop a shared extension.

- [ ] **Step 4: Verify and commit.** Run `bun run check`, rerun the RLS assertion after migration, and run `git diff --check`. Stage only `src/lib/supabase/callback.ts`, `src/lib/supabase/callback.test.ts`, `app/auth/callback/route.ts`, `supabase/migrations/0002_tighten_grants.sql`, `supabase/tests/rls_saves.sql`, `.env.example`, `README.md`, `docs/ROADMAP.md`, and this plan file; commit with `git commit -m "fix(auth): harden callback redirects and anonymous grants"`. Do not stage `next-env.d.ts` or unrelated untracked files.

## Self-review checkpoints

- Safe paths, encoded leading slashes, raw controls, provider errors and origin override have red-then-green tests.
- Existing saves stay intact: no `db reset`, no edits to applied 0001, SQL assertions roll back.
- Manual E2E, title reliability, hygiene and visual tasks stay in their own subsequent plans and commits.
