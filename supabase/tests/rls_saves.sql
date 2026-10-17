-- RLS isolation test for public.saves and public.profiles.
-- Run against a scratch database (local Supabase or a disposable branch):
--   supabase db reset && psql "$DATABASE_URL" -f supabase/tests/rls_saves.sql
-- The whole script runs in one transaction and rolls back, so it leaves no data behind.
--
-- It proves that as user B: selecting user A's rows returns nothing, updating A's row
-- affects nothing, and inserting a row owned by A is rejected by the insert policy.

begin;

-- Two auth users. Supabase's auth.users requires these columns to be non-null.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

-- Seed one private row for A and one for B while RLS is bypassed (running as the owner).
insert into public.saves (user_id, slot, name, seed, schema_version, payload, device_id)
values
  ('00000000-0000-0000-0000-0000000000a1', 1, 'A Career', 'SEED_A', 1, '{"owner":"a"}'::jsonb, 'dev-a'),
  ('00000000-0000-0000-0000-0000000000b1', 1, 'B Career', 'SEED_B', 1, '{"owner":"b"}'::jsonb, 'dev-b');

-- Become user B for the rest of the transaction.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
declare
  visible_count int;
  touched int;
begin
  select count(*) into visible_count from public.saves where user_id = '00000000-0000-0000-0000-0000000000a1';
  if visible_count <> 0 then
    raise exception 'RLS FAIL: user B can read % of user A''s saves', visible_count;
  end if;

  -- B sees exactly its own row.
  select count(*) into visible_count from public.saves;
  if visible_count <> 1 then
    raise exception 'RLS FAIL: user B should see exactly 1 save, saw %', visible_count;
  end if;

  -- B cannot update A's row.
  update public.saves set name = 'hacked' where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'RLS FAIL: user B updated % of user A''s rows', touched;
  end if;

  -- B cannot delete A's row.
  delete from public.saves where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'RLS FAIL: user B deleted % of user A''s rows', touched;
  end if;

  -- B cannot insert a row owned by A (blocked by the insert policy).
  begin
    insert into public.saves (user_id, slot, name, seed, schema_version, payload, device_id)
    values ('00000000-0000-0000-0000-0000000000a1', 2, 'spoof', 'SEED_A', 1, '{}'::jsonb, 'dev-b');
    raise exception 'RLS FAIL: user B inserted a save owned by user A';
  exception
    when insufficient_privilege then null; -- expected: new row violates row level security policy
  end;
end;
$$;

-- Same checks for the profile blob.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
declare
  touched int;
begin
  update public.profiles set data = '{"hacked":true}'::jsonb where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'RLS FAIL: user B updated % of user A''s profile rows', touched;
  end if;
end;
$$;

do $$ begin raise notice 'RLS isolation test passed'; end $$;

rollback;
