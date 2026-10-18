import { execFileSync } from 'node:child_process';
import { assertDisposableTarget, dbContainer, loadE2EEnv } from './helpers/env';

// Refuse to run destructive account flows against anything but the disposable local stack.
export default function globalSetup(): void {
  loadE2EEnv();
  assertDisposableTarget();

  // A migration drift check would turn every E2E failure into a schema mystery.
  try {
    const version = execFileSync(
      'docker',
      ['exec', '-i', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', 'select max(version) from supabase_migrations.schema_migrations'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (version !== '0002') {
      throw new Error(`Expected local migrations through 0002, found ${version || 'none'}.`);
    }
  } catch (error) {
    throw new Error(
      `E2E needs the disposable local Supabase stack with migrations applied. Run \`bunx supabase start\` and \`bunx supabase migration up --local\`. ${error instanceof Error ? error.message : ''}`,
    );
  }
}
