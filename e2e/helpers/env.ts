import fs from 'node:fs';
import path from 'node:path';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOCAL_SUPABASE_PORT = '54321';

/**
 * Load .env.e2e.local into process.env without overwriting explicit shell values.
 * The file is gitignored and is generated from `supabase status` against the local stack.
 */
export function loadE2EEnv(): void {
  const file = path.resolve(process.cwd(), '.env.e2e.local');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

/**
 * Refuse to run against anything that is not the disposable local Supabase stack.
 * This prevents a misconfigured shell (or the developer .env.local) from pointing the
 * destructive cloud-deletion scenarios at a hosted project.
 */
export function assertDisposableTarget(): void {
  if (process.env.E2E_LOCAL_SUPABASE !== '1') {
    throw new Error(
      'E2E refused to start: E2E_LOCAL_SUPABASE=1 is required. Run `bun run test:e2e`, which targets the local Supabase stack.',
    );
  }
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) throw new Error('E2E refused to start: NEXT_PUBLIC_SUPABASE_URL is not set.');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('E2E refused to start: NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');
  }
  if (!LOCAL_HOSTS.has(url.hostname) || url.port !== LOCAL_SUPABASE_PORT) {
    throw new Error(
      `E2E refused to start: Supabase target ${url.origin} is not the local disposable stack on port ${LOCAL_SUPABASE_PORT}.`,
    );
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('E2E refused to start: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
  }
}

export function mailpitUrl(): string {
  return process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324';
}

export function dbContainer(): string {
  return process.env.E2E_DB_CONTAINER ?? 'supabase_db_tape-terminal';
}

export function appUrl(): string {
  return process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
}
