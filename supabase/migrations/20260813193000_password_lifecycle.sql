-- 42 · Password lifecycle
--
-- Until now a starting password was permanent. An owner typed one into the
-- "Add someone" form, read it out, and it stayed the account's password for
-- good -- the form's own hint said "they can change it after signing in", and
-- there was nowhere in the app to do that. A credential that gets spoken across
-- a warehouse office has to be temporary, or it is not a credential.
--
-- Three parts, all of them here rather than in the client:
--
--   must_change_password   a flag the app cannot route around, since the layout
--                          reads it from me() on every request
--   set_password_changed() clears it, and only ever for auth.uid()
--   require_password_change()  re-arms it for someone else, under the same
--                          owner/admin rules as every other team change
--
-- Deliberately no email anywhere. Resetting is something an owner or admin does
-- from the team screen, which needs no SMTP, no deliverability and no custom
-- domain -- and works for warehouse staff who may have no practical email
-- access. A "forgot password" link over Resend can be added later without
-- changing any of this: it would set the same flag through the same function.

alter table core.app_users
  add column if not exists must_change_password boolean not null default false;

comment on column core.app_users.must_change_password is
  'Set when someone else chose the password. The app refuses to go anywhere but /password until it is cleared.';

-- ---------------------------------------------------------------------------
-- me() and team() have to carry the flag, because they are the only way the
-- app learns anything about an account.
--
-- Dropped before creating: CREATE OR REPLACE cannot add a column to a
-- function's return type. Nothing depends on either function -- they are called
-- over PostgREST, never from a view -- so this is safe to replay.
-- ---------------------------------------------------------------------------
drop function if exists public.me();
create function public.me()
returns table (
  id                   uuid,
  full_name            text,
  email                text,
  role                 public.user_role,
  status               text,
  location_ids         uuid[],
  must_change_password boolean
)
language sql
stable
security definer
set search_path = core, public
as $$
  select u.id,
         u.full_name,
         u.email,
         u.role,
         u.status,
         coalesce(
           array_agg(ul.location_id) filter (where ul.location_id is not null),
           '{}'::uuid[]
         ) as location_ids,
         u.must_change_password
    from core.app_users u
    left join core.user_locations ul on ul.user_id = u.id
   where u.id = auth.uid()
     and u.status = 'active'
   group by u.id, u.full_name, u.email, u.role, u.status, u.must_change_password
$$;

drop function if exists public.team();
create function public.team()
returns table (
  id                   uuid,
  full_name            text,
  email                text,
  role                 public.user_role,
  status               text,
  location_ids         uuid[],
  created_at           timestamptz,
  must_change_password boolean
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  return query
    select u.id, u.full_name, u.email, u.role, u.status,
           coalesce(
             array_agg(ul.location_id) filter (where ul.location_id is not null),
             '{}'::uuid[]
           ),
           u.created_at,
           u.must_change_password
      from core.app_users u
      left join core.user_locations ul on ul.user_id = u.id
     group by u.id, u.full_name, u.email, u.role, u.status, u.created_at,
              u.must_change_password
     order by u.role, u.full_name;
end $$;

-- ---------------------------------------------------------------------------
-- Clearing the flag.
--
-- Takes no arguments, like every other identity-bearing function here. The app
-- calls it straight after Supabase Auth accepts the new password; it does not
-- and cannot set the password itself, which stays entirely with GoTrue.
-- ---------------------------------------------------------------------------
create or replace function public.set_password_changed()
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update core.app_users
     set must_change_password = false
   where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Re-arming it for someone else.
--
-- ORDER MATTERS AT THE CALL SITE. The server action calls this FIRST and only
-- touches the Auth admin API if it succeeds. Doing it the other way round would
-- mean an admin could set an owner's password and only then be told they were
-- not allowed to -- the refusal would arrive after the damage.
-- ---------------------------------------------------------------------------
create or replace function public.require_password_change(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_target_role public.user_role;
begin
  perform core.require_owner();

  select role into v_target_role from core.app_users where id = p_user_id;
  if v_target_role is null then
    raise exception 'no such team member' using errcode = 'no_data_found';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'change your own password from your account page'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The same asymmetry as everywhere else: an admin may not reach an owner.
  -- Without this, resetting a password would be the way around it.
  if v_target_role = 'owner' and not public.is_account_owner() then
    raise exception 'only an owner may reset an owner''s password'
      using errcode = 'insufficient_privilege';
  end if;

  update core.app_users
     set must_change_password = true
   where id = p_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Someone added by an owner or admin did not choose their own password, so
-- they arrive holding a credential a second person knows. Flag it on the way
-- in.
--
-- Only on INSERT. Re-adding an existing person does not change their password
-- -- addTeamMember reuses the account rather than resetting it, precisely so
-- that re-adding cannot be used to seize one -- so forcing a change would be
-- asking them to fix something that is not broken.
-- ---------------------------------------------------------------------------
create or replace function public.add_team_member(
  p_user_id      uuid,
  p_full_name    text,
  p_email        text,
  p_role         public.user_role,
  p_location_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_existing_role public.user_role;
begin
  perform core.require_owner();

  if p_role = 'owner' and not public.is_account_owner() then
    raise exception 'only an owner may grant the owner role'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'no account exists for that user'
      using errcode = 'no_data_found';
  end if;

  select role into v_existing_role from core.app_users where id = p_user_id;
  if v_existing_role = 'owner' and not public.is_account_owner() then
    raise exception 'only an owner may change an owner''s account'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.app_users (id, full_name, email, role, must_change_password)
  values (p_user_id, btrim(p_full_name), lower(btrim(p_email)), p_role, true)
  on conflict (id) do update
     set full_name = excluded.full_name,
         role      = excluded.role,
         status    = 'active';

  delete from core.user_locations where user_id = p_user_id;

  if p_role in ('owner', 'admin') then
    insert into core.user_locations (user_id, location_id)
    select p_user_id, id from core.locations
    on conflict do nothing;
  else
    insert into core.user_locations (user_id, location_id)
    select p_user_id, unnest(p_location_ids)
    on conflict do nothing;
  end if;

  return p_user_id;
end $$;

-- ---------------------------------------------------------------------------
revoke all on function public.me() from public;
revoke all on function public.team() from public;
revoke all on function public.set_password_changed() from public;
revoke all on function public.require_password_change(uuid) from public;
revoke all on function public.add_team_member(uuid, text, text, public.user_role, uuid[]) from public;

grant execute on function public.me() to authenticated;
grant execute on function public.team() to authenticated;
grant execute on function public.set_password_changed() to authenticated;
grant execute on function public.require_password_change(uuid) to authenticated;
grant execute on function public.add_team_member(uuid, text, text, public.user_role, uuid[]) to authenticated;
