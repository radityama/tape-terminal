-- Run only against a disposable local Supabase database:
-- psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/rls_saves.sql
-- Every assertion raises an error on failure; the transaction is rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@test.local', crypt('x', gen_salt('bf')), now(), '{}', '{}', now(), now());

insert into public.saves (user_id, slot, name, seed, schema_version, payload, device_id, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', 1, 'A Career', 'SEED_A', 1, '{"owner":"a"}', 'dev-a', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000b1', 1, 'B Career', 'SEED_B', 1, '{"owner":"b"}', 'dev-b', now() - interval '1 day');
insert into public.profiles (user_id, data)
values
  ('00000000-0000-0000-0000-0000000000a1', '{"owner":"a"}'),
  ('00000000-0000-0000-0000-0000000000b1', '{"owner":"b"}');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  visible_count integer;
  touched integer;
  old_revision integer;
  new_revision integer;
  old_updated timestamptz;
  new_updated timestamptz;
  rejected boolean := false;
begin
  select count(*) into visible_count from public.saves;
  if visible_count <> 1 then raise exception 'A should see exactly one save, saw %', visible_count; end if;
  select count(*) into visible_count from public.profiles;
  if visible_count <> 1 then raise exception 'A should see exactly one profile, saw %', visible_count; end if;

  update public.saves set name = 'hacked' where user_id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'A updated B''s save'; end if;
  delete from public.saves where user_id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'A deleted B''s save'; end if;

  update public.profiles set data = '{"hacked":true}' where user_id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'A updated B''s profile'; end if;
  delete from public.profiles where user_id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'A deleted B''s profile'; end if;

  begin
    insert into public.saves (user_id, slot, seed, schema_version, payload, device_id)
    values ('00000000-0000-0000-0000-0000000000b1', 2, 'SPOOF', 1, '{}', 'dev-a');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'A inserted a save owned by B'; end if;

  select revision, updated_at into old_revision, old_updated from public.saves where slot = 1;
  update public.saves set name = 'A Updated' where slot = 1;
  select revision, updated_at into new_revision, new_updated from public.saves where slot = 1;
  if new_revision <> old_revision + 1 or new_updated <= old_updated then
    raise exception 'Revision or updated_at trigger did not advance';
  end if;

  rejected := false;
  begin
    -- Hashed segments resist TOAST compression, unlike a repeated character payload.
    insert into public.saves (user_id, slot, seed, schema_version, payload, device_id)
    values (
      '00000000-0000-0000-0000-0000000000a1', 2, 'TOO_LARGE', 1,
      jsonb_build_object('data', (select string_agg(md5(n::text), '' order by n) from generate_series(1, 250000) n)),
      'dev-a'
    );
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'Payload larger than 2 MB was accepted'; end if;
end;
$$;

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{}';

do $$
begin
  if (select count(*) from public.saves) <> 0 then raise exception 'Anonymous user can see saves'; end if;
  if (select count(*) from public.profiles) <> 0 then raise exception 'Anonymous user can see profiles'; end if;
end;
$$;

rollback;
