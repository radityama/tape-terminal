-- Cloud saves and profile blobs for TAPE. Ownership is enforced by row level security,
-- so the browser talks to PostgREST directly with the anon key and no custom API route.

create extension if not exists pgcrypto;

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  name text not null default 'Career' check (char_length(name) between 1 and 40),
  seed text not null,
  mode text not null default 'career' check (mode in ('career', 'sandbox')),
  schema_version int not null check (schema_version > 0),
  rank text,
  equity numeric,
  sim_day int,
  payload jsonb not null,
  revision int not null default 1 check (revision > 0),
  device_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The unique constraint is also the (user_id, slot) lookup index.
  unique (user_id, slot),
  constraint payload_size check (pg_column_size(payload) < 2097152)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint profile_size check (pg_column_size(data) < 65536)
);

alter table public.saves enable row level security;
alter table public.profiles enable row level security;

-- (select auth.uid()) is evaluated once per statement instead of once per row.
create policy "own saves select" on public.saves for select using ((select auth.uid()) = user_id);
create policy "own saves insert" on public.saves for insert with check ((select auth.uid()) = user_id);
create policy "own saves update" on public.saves for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own saves delete" on public.saves for delete using ((select auth.uid()) = user_id);

create policy "own profile select" on public.profiles for select using ((select auth.uid()) = user_id);
create policy "own profile insert" on public.profiles for insert with check ((select auth.uid()) = user_id);
create policy "own profile update" on public.profiles for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own profile delete" on public.profiles for delete using ((select auth.uid()) = user_id);

-- Every save write bumps the revision and the timestamp. Optimistic concurrency in the
-- client updates where revision = expectedRevision, so a lost update updates zero rows.
create or replace function public.touch_save()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

create trigger saves_touch
  before update on public.saves
  for each row execute function public.touch_save();

create or replace function public.touch_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_profile();

-- The API roles only need DML; RLS decides which rows they may touch. anon gets nothing.
grant select, insert, update, delete on public.saves to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
revoke all on public.saves from anon;
revoke all on public.profiles from anon;
