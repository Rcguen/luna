-- Luna cloud metadata and private save storage.
-- Copy this complete script into Supabase SQL Editor. It never uploads ROMs.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rom_hash text not null check (rom_hash ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(title) between 1 and 200),
  imported_at timestamptz not null default now(),
  last_played_at timestamptz,
  unique (user_id, rom_hash),
  unique (user_id, id)
);

create index if not exists games_user_last_played_idx
  on public.games(user_id, last_played_at desc nulls last);

create table if not exists public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0)
);

create index if not exists play_sessions_user_started_idx
  on public.play_sessions(user_id, started_at desc);

create table if not exists public.save_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null,
  player_slot smallint not null check (player_slot between 1 and 4),
  save_type text not null check (save_type in ('battery', 'state')),
  storage_path text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 67108864),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision > 0),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint save_files_storage_path_check check (
    storage_path ~ (
      '^' || user_id::text || '/' || game_id::text ||
      '/' || player_slot::text || '/' || save_type ||
      '/' || revision::text || '-' || checksum || '\.bin$'
    )
  ),
  unique (user_id, game_id, player_slot, save_type, revision),
  unique (storage_path)
);

-- Add the ownership key and composite foreign keys only when equivalent
-- constraints are not already present. Existing data is never deleted.
do $$
declare
  games_key_name text;
  games_index_name text;
  games_user_attnum smallint;
  games_id_attnum smallint;
begin
  select attnum into games_user_attnum
  from pg_attribute
  where attrelid = 'public.games'::regclass
    and attname = 'user_id'
    and not attisdropped;

  select attnum into games_id_attnum
  from pg_attribute
  where attrelid = 'public.games'::regclass
    and attname = 'id'
    and not attisdropped;

  if games_user_attnum is null or games_id_attnum is null then
    raise exception 'public.games must contain user_id and id before adding ownership constraints';
  end if;

  if (
    select count(*)
    from pg_attribute
    where attrelid = 'public.play_sessions'::regclass
      and attname in ('user_id', 'game_id')
      and not attisdropped
  ) <> 2 then
    raise exception 'public.play_sessions must contain user_id and game_id before adding ownership constraints';
  end if;

  if (
    select count(*)
    from pg_attribute
    where attrelid = 'public.save_files'::regclass
      and attname in ('user_id', 'game_id')
      and not attisdropped
  ) <> 2 then
    raise exception 'public.save_files must contain user_id and game_id before adding ownership constraints';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.games'::regclass
      and c.contype = 'u'
      and c.conkey = array[games_user_attnum, games_id_attnum]::smallint[]
  ) then
    select i.relname into games_index_name
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.games'::regclass
      and x.indisunique
      and x.indpred is null
      and x.indexprs is null
      and x.indkey::text = games_user_attnum::text || ' ' || games_id_attnum::text
    limit 1;

    select c.conname into games_key_name
    from pg_constraint c
    where c.conrelid = 'public.games'::regclass
      and c.conname = 'games_user_id_id_key';

    if games_index_name is not null then
      if games_key_name is null then
        execute format(
          'alter table public.games add constraint games_user_id_id_key unique using index %I',
          games_index_name
        );
      else
        execute format(
          'alter table public.games add constraint games_user_id_id_key_migration unique using index %I',
          games_index_name
        );
      end if;
    elsif games_key_name is null then
      alter table public.games
        add constraint games_user_id_id_key unique (user_id, id);
    else
      alter table public.games
        add constraint games_user_id_id_key_migration unique (user_id, id);
    end if;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.play_sessions'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.games'::regclass
      and c.conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.play_sessions'::regclass and attname = 'user_id'),
        (select attnum from pg_attribute where attrelid = 'public.play_sessions'::regclass and attname = 'game_id')
      ]::smallint[]
      and c.confkey = array[games_user_attnum, games_id_attnum]::smallint[]
      and c.confdeltype = 'c'
  ) then
    alter table public.play_sessions
      add constraint play_sessions_user_game_fkey
      foreign key (user_id, game_id)
      references public.games(user_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.save_files'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.games'::regclass
      and c.conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.save_files'::regclass and attname = 'user_id'),
        (select attnum from pg_attribute where attrelid = 'public.save_files'::regclass and attname = 'game_id')
      ]::smallint[]
      and c.confkey = array[games_user_attnum, games_id_attnum]::smallint[]
      and c.confdeltype = 'c'
  ) then
    alter table public.save_files
      add constraint save_files_user_game_fkey
      foreign key (user_id, game_id)
      references public.games(user_id, id)
      on delete cascade;
  end if;
end
$$;

-- Replace this named check safely so a partial earlier version cannot leave
-- behind a weaker path validation. Existing rows are preserved; incompatible
-- rows cause the migration to stop instead of being rewritten.
alter table public.save_files
  drop constraint if exists save_files_storage_path_check;

alter table public.save_files
  add constraint save_files_storage_path_check check (
    storage_path ~ (
      '^' || user_id::text || '/' || game_id::text ||
      '/' || player_slot::text || '/' || save_type ||
      '/' || revision::text || '-' || checksum || '\.bin$'
    )
  );

create index if not exists save_files_latest_idx
  on public.save_files(user_id, game_id, player_slot, save_type, revision desc);

alter table public.save_files
  add column if not exists pinned boolean not null default false;

create index if not exists save_files_retention_idx
  on public.save_files(user_id, game_id, player_slot, save_type, pinned, revision desc);

revoke all on table public.games from public, anon;
revoke all on table public.play_sessions from public, anon;
revoke all on table public.save_files from public, anon;
grant select, insert, update, delete on table public.games to authenticated;
grant select, insert, update, delete on table public.play_sessions to authenticated;
grant select, insert, update, delete on table public.save_files to authenticated;

alter table public.games enable row level security;
alter table public.play_sessions enable row level security;
alter table public.save_files enable row level security;

drop policy if exists games_owner_select on public.games;
create policy games_owner_select
  on public.games for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists games_owner_insert on public.games;
create policy games_owner_insert
  on public.games for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists games_owner_update on public.games;
create policy games_owner_update
  on public.games for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists games_owner_delete on public.games;
create policy games_owner_delete
  on public.games for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists sessions_owner_all on public.play_sessions;
create policy sessions_owner_all
  on public.play_sessions for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists saves_owner_all on public.save_files;
create policy saves_owner_all
  on public.save_files for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Preserve an existing bucket and all of its objects. Only its security
-- settings are normalized.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('luna-saves', 'luna-saves', false, 67108864, array['application/octet-stream'])
on conflict (id) do update
set public = false,
    file_size_limit = 67108864,
    allowed_mime_types = array['application/octet-stream'];

drop policy if exists luna_saves_select on storage.objects;
create policy luna_saves_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'luna-saves'
    and name ~ (
      '^' || (select auth.uid()::text) ||
      '/[0-9a-f-]{36}/[1-4]/(battery|state)/[1-9][0-9]*-[0-9a-f]{64}\.bin$'
    )
  );

drop policy if exists luna_saves_insert on storage.objects;
create policy luna_saves_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'luna-saves'
    and name ~ (
      '^' || (select auth.uid()::text) ||
      '/[0-9a-f-]{36}/[1-4]/(battery|state)/[1-9][0-9]*-[0-9a-f]{64}\.bin$'
    )
  );

drop policy if exists luna_saves_update on storage.objects;
create policy luna_saves_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'luna-saves'
    and name ~ (
      '^' || (select auth.uid()::text) ||
      '/[0-9a-f-]{36}/[1-4]/(battery|state)/[1-9][0-9]*-[0-9a-f]{64}\.bin$'
    )
  )
  with check (
    bucket_id = 'luna-saves'
    and name ~ (
      '^' || (select auth.uid()::text) ||
      '/[0-9a-f-]{36}/[1-4]/(battery|state)/[1-9][0-9]*-[0-9a-f]{64}\.bin$'
    )
  );

drop policy if exists luna_saves_delete on storage.objects;
create policy luna_saves_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'luna-saves'
    and name ~ (
      '^' || (select auth.uid()::text) ||
      '/[0-9a-f-]{36}/[1-4]/(battery|state)/[1-9][0-9]*-[0-9a-f]{64}\.bin$'
    )
  );
