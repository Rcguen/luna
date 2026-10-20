-- Luna cloud metadata and private save storage.
-- Apply with Supabase CLI or the SQL editor. No ROM bytes belong in Supabase.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rom_hash text not null check (rom_hash ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(title) between 1 and 200),
  imported_at timestamptz not null default now(),
  last_played_at timestamptz,
  unique (user_id, rom_hash)
);

create index if not exists games_user_last_played_idx on public.games(user_id, last_played_at desc nulls last);

create table if not exists public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0)
);

create index if not exists play_sessions_user_started_idx on public.play_sessions(user_id, started_at desc);

create table if not exists public.save_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  player_slot smallint not null check (player_slot between 1 and 4),
  save_type text not null check (save_type in ('battery', 'state')),
  storage_path text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 67108864),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_id, player_slot, save_type, revision),
  unique (storage_path)
);

create index if not exists save_files_latest_idx on public.save_files(user_id, game_id, player_slot, save_type, revision desc);

alter table public.games enable row level security;
alter table public.play_sessions enable row level security;
alter table public.save_files enable row level security;

drop policy if exists games_owner_select on public.games;
create policy games_owner_select on public.games for select using (auth.uid() = user_id);
drop policy if exists games_owner_insert on public.games;
create policy games_owner_insert on public.games for insert with check (auth.uid() = user_id);
drop policy if exists games_owner_update on public.games;
create policy games_owner_update on public.games for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists games_owner_delete on public.games;
create policy games_owner_delete on public.games for delete using (auth.uid() = user_id);

drop policy if exists sessions_owner_all on public.play_sessions;
create policy sessions_owner_all on public.play_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists saves_owner_all on public.save_files;
create policy saves_owner_all on public.save_files for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('luna-saves', 'luna-saves', false, 67108864, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 67108864;

drop policy if exists luna_saves_select on storage.objects;
create policy luna_saves_select on storage.objects for select to authenticated
using (bucket_id = 'luna-saves' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists luna_saves_insert on storage.objects;
create policy luna_saves_insert on storage.objects for insert to authenticated
with check (bucket_id = 'luna-saves' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists luna_saves_update on storage.objects;
create policy luna_saves_update on storage.objects for update to authenticated
using (bucket_id = 'luna-saves' and (storage.foldername(name))[1] = (select auth.uid()::text))
with check (bucket_id = 'luna-saves' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists luna_saves_delete on storage.objects;
create policy luna_saves_delete on storage.objects for delete to authenticated
using (bucket_id = 'luna-saves' and (storage.foldername(name))[1] = (select auth.uid()::text));
