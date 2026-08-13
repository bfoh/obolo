-- 40 · What an admin is, and who may hand out roles
--
-- An admin is an owner for every authorization decision in the database. The
-- two differ in exactly one respect: an admin may not create, promote to,
-- demote or suspend an OWNER. That single asymmetry is what stops an added
-- administrator from locking the business owner out of their own books, and it
-- costs an admin nothing they would ever legitimately need.
--
-- ---------------------------------------------------------------------------
-- HOW "admin is an owner" IS IMPLEMENTED, AND WHY IT IS DONE HERE
-- ---------------------------------------------------------------------------
-- Authorization in OBOLO funnels through one function. `public.is_owner()`,
-- `core.require_owner()`, `core.can_post()`, and the `where
-- current_user_role() in ('owner', 'warehouse_staff')` clauses inside a dozen
-- `public.v_*` views all resolve the caller's role by calling
-- `public.current_user_role()`.
--
-- So `current_user_role()` now returns the caller's EFFECTIVE role, mapping a
-- stored 'admin' to 'owner'. Every existing check inherits the new role with no
-- change, including the cost-masking `case when is_owner() then ... end` in
-- views this migration never touches. The alternative -- adding 'admin' to
-- fifteen scattered IN-lists -- would mean copying a dozen large view bodies
-- forward into this file, where they would silently drift from the definitions
-- they were copied from.
--
-- The STORED role is still available, and is what the team screen displays:
--   public.current_user_account_role()  -- 'admin' stays 'admin'
--   public.is_account_owner()           -- true only for a real owner
--   public.me() / public.team()         -- both already return the stored role
--
-- The rule to remember: authorization asks for the effective role, and display
-- and role-granting ask for the stored one.

-- ---------------------------------------------------------------------------
-- Effective role: what every authorization check sees.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = core, public
as $$
  select case u.role
           when 'admin' then 'owner'::public.user_role
           else u.role
         end
    from core.app_users u
   where u.id = auth.uid()
     and u.status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- Stored role: what the person actually is. Display and role-granting only --
-- never reach for this to decide whether an action is allowed, or admins will
-- start failing checks they are meant to pass.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_account_role()
returns public.user_role
language sql
stable
security definer
set search_path = core, public
as $$
  select u.role
    from core.app_users u
   where u.id = auth.uid()
     and u.status = 'active'
$$;

create or replace function public.is_account_owner()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(public.current_user_account_role() = 'owner', false)
$$;

create or replace function core.require_account_owner()
returns void
language plpgsql
stable
set search_path = core, public
as $$
begin
  if not public.is_account_owner() then
    raise exception 'only an owner may do this'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

comment on function public.current_user_role() is
  'Caller''s EFFECTIVE role: a stored admin resolves to owner. Identity always from auth.uid(), never a parameter. Every authorization check in the database goes through here.';
comment on function public.current_user_account_role() is
  'Caller''s STORED role, so an admin reads as admin. For display and role-granting only -- never for authorization.';
comment on function public.is_account_owner() is
  'True only for a real owner, so an admin cannot promote, demote or suspend one.';

-- ---------------------------------------------------------------------------
-- Suspension now actually withdraws access.
--
-- A bug this migration is fixing rather than introducing. `can_access_location()`
-- is the single gate behind roughly twenty-five `public.v_*` views, and it
-- checked only for a row in core.user_locations. Suspending someone sets
-- app_users.status and leaves their location assignments alone -- so a
-- suspended account went on reading stock levels, batches, movements,
-- transfers, counts and returns for its locations. Cost stayed masked, since
-- that hangs off is_owner(), but quantities and trading history did not.
--
-- The app never noticed because getCurrentUser() resolves a suspended user to
-- null. Anyone holding the account's session token and calling PostgREST
-- directly did not have to go through the app.
--
-- One function, so the fix lands in every view at once.
-- ---------------------------------------------------------------------------
create or replace function public.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select public.is_owner()
      or exists (
        select 1
          from core.user_locations ul
          join core.app_users u on u.id = ul.user_id
         where ul.user_id = auth.uid()
           and ul.location_id = p_location_id
           and u.status = 'active'
      )
$$;

comment on function public.can_access_location(uuid) is
  'Whether the caller may see a location at all. Requires an ACTIVE app_users row: a suspended account keeps its location assignments but loses its access.';

revoke all on function public.can_access_location(uuid) from public;
grant execute on function public.can_access_location(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Bootstrapping an owner stays owner-only.
--
-- Unchanged except for the guard: `is_owner()` is now true for admins, and an
-- admin creating an owner would walk straight around the asymmetry this
-- migration exists to establish.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_owner(p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_user_id uuid;
  v_exists  boolean;
begin
  select exists (select 1 from core.app_users where role = 'owner' and status = 'active')
    into v_exists;

  if v_exists and not public.is_account_owner() then
    raise exception 'an owner already exists; ask them to add you'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'no auth user with email %', p_email
      using errcode = 'no_data_found',
            hint = 'Create the account in Supabase Auth first, then run this.';
  end if;

  insert into core.app_users (id, full_name, email, role)
  values (v_user_id, p_full_name, p_email, 'owner')
  on conflict (id) do update
     set role = 'owner', status = 'active', full_name = excluded.full_name;

  insert into core.user_locations (user_id, location_id)
  select v_user_id, id from core.locations
  on conflict do nothing;

  return v_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Adding someone
--
-- The auth account is created by the application using the service role, since
-- only it can reach the Auth admin API. This function gives that account a role
-- and its locations. Owners and admins may both call it; only an owner may
-- hand out 'owner'.
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

  -- Re-adding an existing person overwrites their role, so the same guard has
  -- to cover the person being written over, not just the role being written.
  select role into v_existing_role from core.app_users where id = p_user_id;
  if v_existing_role = 'owner' and not public.is_account_owner() then
    raise exception 'only an owner may change an owner''s account'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.app_users (id, full_name, email, role)
  values (p_user_id, btrim(p_full_name), lower(btrim(p_email)), p_role)
  on conflict (id) do update
     set full_name = excluded.full_name,
         role      = excluded.role,
         status    = 'active';

  delete from core.user_locations where user_id = p_user_id;

  -- Owners and admins answer for every location, so give them all of them
  -- rather than making the caller remember to tick every box.
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
-- Changing someone's rights
-- ---------------------------------------------------------------------------
create or replace function public.update_team_member(
  p_user_id      uuid,
  p_role         public.user_role default null,
  p_status       text default null,
  p_location_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_target_role public.user_role;
  v_new_role    public.user_role;
begin
  perform core.require_owner();

  select role into v_target_role from core.app_users where id = p_user_id;
  if v_target_role is null then
    raise exception 'no such team member' using errcode = 'no_data_found';
  end if;

  -- Nobody edits their own role or status. Not a trust question: it is the
  -- only way to accidentally suspend or demote yourself out of the app, and
  -- the person who can undo it is you.
  if p_user_id = auth.uid() and (p_role is not null or nullif(btrim(p_status), '') is not null) then
    raise exception 'you cannot change your own role or status'
      using errcode = 'insufficient_privilege',
            hint = 'Ask another owner or admin to do it.';
  end if;

  if not public.is_account_owner() then
    if v_target_role = 'owner' then
      raise exception 'only an owner may change an owner''s account'
        using errcode = 'insufficient_privilege';
    end if;
    if p_role = 'owner' then
      raise exception 'only an owner may grant the owner role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  v_new_role := coalesce(p_role, v_target_role);

  -- The last-owner trigger on core.app_users is what actually prevents an
  -- owner from locking everyone out; this just reaches it with a clearer path.
  update core.app_users
     set role   = v_new_role,
         status = coalesce(nullif(btrim(p_status), ''), status)
   where id = p_user_id;

  if p_location_ids is not null then
    delete from core.user_locations where user_id = p_user_id;
    insert into core.user_locations (user_id, location_id)
    select p_user_id, unnest(p_location_ids)
    on conflict do nothing;
  end if;

  -- Someone promoted into full access reaches every location by definition.
  if v_new_role in ('owner', 'admin') then
    insert into core.user_locations (user_id, location_id)
    select p_user_id, id from core.locations
    on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The system administrator
--
-- A break-glass account for whoever maintains the deployment, so a problem can
-- be looked at without borrowing the owner's password. Two things make this
-- safe to have standing:
--
--   * It is provisioned out of band by scripts/create-system-admin.mjs, which
--     creates the Auth account and then calls this. Nothing in the app offers
--     it, and no password is written down in this repository.
--   * It cannot touch an owner account, exactly like any other admin.
--
-- THE GRANT IS THE AUTHORIZATION. This function takes an email rather than
-- deriving identity from auth.uid(), which everywhere else in this codebase
-- would be an IDOR. It is safe only because EXECUTE is granted to service_role
-- alone: a caller holding the service key already bypasses RLS entirely, so
-- this hands them nothing they did not already have. Never grant it to
-- `authenticated`.
-- ---------------------------------------------------------------------------
create or replace function public.provision_system_admin(p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_user_id uuid;
  v_role    public.user_role;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no auth user with email %', p_email
      using errcode = 'no_data_found',
            hint = 'Create the account in Supabase Auth first, then run this.';
  end if;

  select role into v_role from core.app_users where id = v_user_id;
  if v_role = 'owner' then
    raise exception 'that account is an owner; demoting it to admin is not what you want'
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Use a separate address for the system administrator.';
  end if;

  insert into core.app_users (id, full_name, email, role)
  values (v_user_id, btrim(p_full_name), lower(btrim(p_email)), 'admin')
  on conflict (id) do update
     set role      = 'admin',
         status    = 'active',
         full_name = excluded.full_name;

  insert into core.user_locations (user_id, location_id)
  select v_user_id, id from core.locations
  on conflict do nothing;

  return v_user_id;
end $$;

comment on function public.provision_system_admin(text, text) is
  'Break-glass admin provisioning. Takes an email, so it is safe ONLY because EXECUTE is granted to service_role alone. Never grant to authenticated.';

-- ---------------------------------------------------------------------------
-- Grants. CREATE OR REPLACE preserves an existing ACL, but these are restated
-- so the file stands on its own when replayed against a fresh database.
-- ---------------------------------------------------------------------------
revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_account_role() from public;
revoke all on function public.is_account_owner() from public;
revoke all on function public.bootstrap_owner(text, text) from public;
revoke all on function public.add_team_member(uuid, text, text, public.user_role, uuid[]) from public;
revoke all on function public.update_team_member(uuid, public.user_role, text, uuid[]) from public;
revoke all on function public.provision_system_admin(text, text) from public;

grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_user_account_role() to authenticated, service_role;
grant execute on function public.is_account_owner() to authenticated, service_role;
grant execute on function public.bootstrap_owner(text, text) to authenticated;
grant execute on function public.add_team_member(uuid, text, text, public.user_role, uuid[]) to authenticated;
grant execute on function public.update_team_member(uuid, public.user_role, text, uuid[]) to authenticated;

-- Deliberately NOT granted to authenticated. See the comment above.
grant execute on function public.provision_system_admin(text, text) to service_role;
