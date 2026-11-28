-- RESA online sync — self-hosted schema.
--
-- Replaces src-tauri/migrations/baas/0001_sync.sql for an own server: the same
-- client contract (sync_records + sync_push + GoTrue auth), but rows live in a
-- workspace instead of a single user, which is what lets a team share tasks.
--
-- Apply after the stack is healthy:
--   docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 < sql/10-sync.sql

create extension if not exists pgcrypto;

-- The JWT subject helper PostgREST and the policies below expect. Same contract
-- as Supabase's auth.uid(): the token's `sub` claim.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

-- ---------------------------------------------------------------- workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'فضای کاری',
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'manager', 'member')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('manager', 'member')),
  token uuid not null default gen_random_uuid(),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);

-- ------------------------------------------------------------- sync records
create table if not exists public.sync_records (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity text not null,
  record_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  device_id text,
  rev bigint not null default 1,
  updated_by uuid,
  primary key (workspace_id, entity, record_id)
);

create index if not exists sync_records_pull_idx
  on public.sync_records (workspace_id, server_updated_at);

-- --------------------------------------------------------------- membership
-- A personal workspace is created on first use, so a solo account needs no
-- setup step and the current client keeps working unchanged.
create or replace function public.ensure_personal_workspace(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select m.workspace_id into ws
    from workspace_members m
   where m.user_id = uid and m.role = 'owner'
   order by m.created_at
   limit 1;
  if ws is not null then
    return ws;
  end if;
  insert into workspaces (name, owner_id) values (coalesce(p_name, 'فضای کاری من'), uid) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner');
  return ws;
end;
$$;

create or replace function public.is_workspace_member(p_workspace uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace and m.user_id = auth.uid()
  )
$$;

create or replace function public.workspace_role(p_workspace uuid)
returns text
language sql stable
security definer
set search_path = public
as $$
  select m.role from public.workspace_members m
   where m.workspace_id = p_workspace and m.user_id = auth.uid()
$$;

-- Accepting an invite is the only way into someone else's workspace.
create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  invite record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into invite from workspace_invites
   where token = p_token and accepted_at is null;
  if invite is null then
    raise exception 'دعوت‌نامه معتبر نیست.' using errcode = '22023';
  end if;
  insert into workspace_members (workspace_id, user_id, role)
  values (invite.workspace_id, uid, invite.role)
  on conflict (workspace_id, user_id) do nothing;
  update workspace_invites set accepted_at = now() where id = invite.id;
  return invite.workspace_id;
end;
$$;

-- --------------------------------------------------------------- push / pull
-- Conditional upsert. `p_workspace` is optional so an older client keeps
-- syncing into its own personal workspace.
create or replace function public.sync_push(items jsonb, p_workspace uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws uuid;
  item jsonb;
  accepted integer := 0;
begin
  if uid is null then
    raise exception 'sync_push requires an authenticated user' using errcode = '28000';
  end if;

  if p_workspace is null then
    ws := public.ensure_personal_workspace();
  else
    if not public.is_workspace_member(p_workspace) then
      raise exception 'not a member of this workspace' using errcode = '42501';
    end if;
    ws := p_workspace;
  end if;

  for item in select value from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop
    insert into public.sync_records as r
      (workspace_id, entity, record_id, payload, updated_at, deleted, device_id, rev, updated_by)
    values (
      ws,
      item->>'entity',
      item->>'record_id',
      coalesce(item->'payload', '{}'::jsonb),
      coalesce((item->>'updated_at')::timestamptz, now()),
      coalesce((item->>'deleted')::boolean, false),
      item->>'device_id',
      1,
      uid
    )
    on conflict (workspace_id, entity, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          device_id = excluded.device_id,
          rev = r.rev + 1,
          server_updated_at = now(),
          updated_by = uid
      where excluded.updated_at >= r.updated_at;
    if found then
      accepted := accepted + 1;
    end if;
  end loop;

  return jsonb_build_object('workspace', ws, 'accepted', accepted);
end;
$$;

-- ------------------------------------------------------------------ security
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.sync_records enable row level security;

drop policy if exists "workspaces: members read" on public.workspaces;
create policy "workspaces: members read" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));

drop policy if exists "workspaces: owner writes" on public.workspaces;
create policy "workspaces: owner writes" on public.workspaces
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "members: workspace read" on public.workspace_members;
create policy "members: workspace read" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "members: managers write" on public.workspace_members;
create policy "members: managers write" on public.workspace_members
  for all to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'manager'))
  with check (public.workspace_role(workspace_id) in ('owner', 'manager'));

drop policy if exists "invites: managers" on public.workspace_invites;
create policy "invites: managers" on public.workspace_invites
  for all to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'manager'))
  with check (public.workspace_role(workspace_id) in ('owner', 'manager'));

drop policy if exists "sync_records: workspace read" on public.sync_records;
create policy "sync_records: workspace read" on public.sync_records
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "sync_records: workspace write" on public.sync_records;
create policy "sync_records: workspace write" on public.sync_records
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Creating a workspace is allowed for the account that owns it, and the owner
-- must be able to add themselves as the first member before any membership
-- policy can apply.
drop policy if exists "workspaces: owner inserts" on public.workspaces;
create policy "workspaces: owner inserts" on public.workspaces
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "members: owner bootstrap" on public.workspace_members;
create policy "members: owner bootstrap" on public.workspace_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspaces w
       where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

-- Anyone may rename themselves inside a workspace they belong to.
drop policy if exists "members: self name" on public.workspace_members;
create policy "members: self name" on public.workspace_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A row inserted with `returning` must also pass the SELECT policy, so the
-- owner has to be able to read the workspace they just created, and a member
-- their own membership row, before the membership exists.
drop policy if exists "workspaces: members read" on public.workspaces;
create policy "workspaces: members read" on public.workspaces
  for select to authenticated
  using (owner_id = auth.uid() or public.is_workspace_member(id));

drop policy if exists "members: workspace read" on public.workspace_members;
create policy "members: workspace read" on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

-- Only a manager may change a role; anyone may rename themselves.
create or replace function public.guard_member_role() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(public.workspace_role(old.workspace_id), '') not in ('owner', 'manager') then
    raise exception 'only a manager can change roles' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_guard on public.workspace_members;
create trigger workspace_members_guard
  before update on public.workspace_members
  for each row execute function public.guard_member_role();
