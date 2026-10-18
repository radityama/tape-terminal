#!/usr/bin/env bash
# Browser E2E against a disposable local Supabase stack only.
# Generates .env.e2e.local from `supabase status`, builds the production app with those
# values inlined, then runs Playwright (whose webServer starts `next start`).
set -euo pipefail

cd "$(dirname "$0")/../.."

if ! docker ps --format '{{.Names}}' | grep -q '^supabase_db_'; then
  echo "E2E requires a running local Supabase stack (docker). Start it with: bunx supabase start" >&2
  exit 1
fi

if [ ! -f .env.e2e.local ]; then
  bunx supabase status -o env 2>/dev/null | awk -F= '
    /^API_URL=/ { url=$2 }
    /^ANON_KEY=/ { key=$2 }
    END {
      gsub(/"/, "", url); gsub(/"/, "", key);
      print "NEXT_PUBLIC_SUPABASE_URL=" url;
      print "NEXT_PUBLIC_SUPABASE_ANON_KEY=" key;
      print "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100";
    }' > .env.e2e.local
fi

set -a
# shellcheck disable=SC1091
. ./.env.e2e.local
set +a

export E2E_LOCAL_SUPABASE=1

# Reject a non-local Supabase target before compiling or starting anything.
node -e '
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "54321") {
    console.error(`Refusing to run E2E against ${url.origin}. Only the local stack is allowed.`);
    process.exit(1);
  }
'

if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then
  bun run build
fi

exec bunx playwright test "$@"
