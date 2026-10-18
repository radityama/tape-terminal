import { execFileSync } from 'node:child_process';
import { assertDisposableTarget, dbContainer } from './env';

/**
 * Query the disposable local Postgres container. Only used for assertions; every call is
 * guarded so a hosted database can never be reached by the suite.
 */
export function queryLocalDb(sql: string): string {
  assertDisposableTarget();
  return execFileSync(
    'docker',
    ['exec', '-i', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function cloudSaveCount(email: string): number {
  const rows = queryLocalDb(
    `select count(*) from public.saves s join auth.users u on u.id = s.user_id where u.email = ${literal(email)}`,
  );
  return Number(rows || 0);
}

export function cloudSlots(email: string): number[] {
  const rows = queryLocalDb(
    `select s.slot from public.saves s join auth.users u on u.id = s.user_id where u.email = ${literal(email)} order by s.slot`,
  );
  return rows ? rows.split('\n').map(Number) : [];
}

export function cloudRevision(email: string, slot: number): number | null {
  const rows = queryLocalDb(
    `select s.revision from public.saves s join auth.users u on u.id = s.user_id where u.email = ${literal(email)} and s.slot = ${Math.trunc(slot)}`,
  );
  return rows ? Number(rows) : null;
}
