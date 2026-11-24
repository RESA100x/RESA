-- RESA online sync — remote half.
--
-- Apply once per Arianet BaaS project, either from the panel's SQL Editor or
-- with `arianet baas db push`. Safe to re-run.
--
-- One row per (user, entity, record id). The client keeps SQLite as the source
-- of truth and ships whole rows as JSON, so this table does not have to mirror
-- every local column. `updated_at` is the client's last-write-wins clock and
-- `server_updated_at` is the pull cursor (server clock, immune to skew).

create table if not exists public.sync_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity text not null,
  record_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  device_id text,
  rev bigint not null default 1,
  primary key (user_id, entity, record_id)
);

create index if not exists sync_records_pull_idx
  on public.sync_records (user_id, server_updated_at);

alter table public.sync_records enable row level security;

drop policy if exists "sync_records: owner only" on public.sync_records;
create policy "sync_records: owner only" on public.sync_records
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Conditional upsert. The client sends a batch of rows; the server keeps the
-- newest one by `updated_at` so two devices editing offline converge instead of
-- letting the last upload win blindly.
create or replace function public.sync_push(items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  accepted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'sync_push requires an authenticated user' using errcode = '28000';
  end if;

  for item in select value from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop
    insert into public.sync_records as r
      (user_id, entity, record_id, payload, updated_at, deleted, device_id, rev)
    values (
      auth.uid(),
      item->>'entity',
      item->>'record_id',
      coalesce(item->'payload', '{}'::jsonb),
      coalesce((item->>'updated_at')::timestamptz, now()),
      coalesce((item->>'deleted')::boolean, false),
      item->>'device_id',
      1
    )
    on conflict (user_id, entity, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          device_id = excluded.device_id,
          rev = r.rev + 1,
          server_updated_at = now()
      where excluded.updated_at >= r.updated_at;

    if found then
      accepted := accepted + 1;
    end if;
  end loop;

  return jsonb_build_object('accepted', accepted, 'at', now());
end;
$$;

grant execute on function public.sync_push(jsonb) to authenticated;

grant select, insert, update, delete on public.sync_records to authenticated;
