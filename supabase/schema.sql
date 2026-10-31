-- Crucible database setup.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Run it once on a fresh project.

-- ── Tables ──────────────────────────────────────────────────────────────

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  height_in    int check (height_in between 36 and 108),
  team_id      uuid references public.teams(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.profiles (team_id);

create table public.events (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 100),
  kind        text not null default 'workout' check (kind in ('workout', 'social', 'other')),
  event_date  date not null,
  start_time  time,
  location    text check (char_length(location) <= 120),
  details     text check (char_length(details) <= 4000),
  created_at  timestamptz not null default now()
);
create index on public.events (team_id, event_date);

create table public.posts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 4000),
  event_id    uuid references public.events(id) on delete set null,
  media       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()   -- set by the server, can't be faked
);
create index on public.posts (team_id, created_at desc);

create table public.reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on public.comments (post_id, created_at);

-- Each lift entry is one max on one date; the history of entries is the PR history.
-- Weights are in lbs; pull-ups are max reps.
create table public.lift_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  lift        text not null check (lift in ('bench', 'squat', 'deadlift', 'ohp', 'pullup')),
  value       numeric(6, 1) not null check (value > 0 and value < 2000),
  recorded_on date not null default current_date check (recorded_on <= current_date + 1),
  created_at  timestamptz not null default now()
);
create index on public.lift_entries (user_id, lift, recorded_on);

create table public.weigh_ins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  weight_lbs  numeric(5, 1) not null check (weight_lbs between 50 and 800),
  recorded_on date not null default current_date check (recorded_on <= current_date + 1),
  created_at  timestamptz not null default now()
);
create index on public.weigh_ins (user_id, recorded_on);

-- kind 'text': a written goal. 'lift': reach target on a lift. 'weight': reach a body weight.
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('text', 'lift', 'weight')),
  lift        text check (lift in ('bench', 'squat', 'deadlift', 'ohp', 'pullup')),
  target      numeric(6, 1) check (target > 0 and target < 2000),
  body        text check (char_length(body) <= 300),
  target_date date,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  check (
    (kind = 'text' and body is not null) or
    (kind = 'lift' and lift is not null and target is not null) or
    (kind = 'weight' and target is not null)
  )
);
create index on public.goals (user_id);

-- ── Helpers ─────────────────────────────────────────────────────────────

create or replace function public.my_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

-- New sign-ups get a profile automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)), 40));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_team(team_name text) returns public.teams
language plpgsql security definer set search_path = public as $$
declare
  t public.teams;
  new_code text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  loop
    new_code := '';
    for i in 1..6 loop
      new_code := new_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.teams where invite_code = new_code);
  end loop;
  insert into public.teams (name, invite_code, created_by)
  values (trim(team_name), new_code, auth.uid())
  returning * into t;
  update public.profiles set team_id = t.id where id = auth.uid();
  return t;
end $$;

create or replace function public.join_team(code text) returns public.teams
language plpgsql security definer set search_path = public as $$
declare
  t public.teams;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into t from public.teams where invite_code = upper(trim(code));
  if not found then raise exception 'That invite code doesn''t match any crew'; end if;
  update public.profiles set team_id = t.id where id = auth.uid();
  return t;
end $$;

create or replace function public.leave_team() returns void
language sql security definer set search_path = public as $$
  update public.profiles set team_id = null where id = auth.uid();
$$;

revoke execute on function public.create_team(text), public.join_team(text), public.leave_team() from public, anon;
grant execute on function public.create_team(text), public.join_team(text), public.leave_team() to authenticated;

-- ── Permissions: only columns the app is allowed to write ──────────────

revoke all on public.teams, public.profiles, public.events, public.posts, public.reactions, public.comments,
  public.lift_entries, public.weigh_ins, public.goals from anon;
revoke insert, update on public.teams, public.profiles, public.events, public.posts, public.reactions, public.comments,
  public.lift_entries, public.weigh_ins, public.goals from authenticated;

grant update (name) on public.teams to authenticated;
grant update (display_name, height_in) on public.profiles to authenticated;
grant insert (team_id, title, kind, event_date, start_time, location, details) on public.events to authenticated;
grant update (title, kind, event_date, start_time, location, details) on public.events to authenticated;
grant insert (team_id, body, event_id, media) on public.posts to authenticated;
grant insert (post_id) on public.reactions to authenticated;
grant insert (post_id, body) on public.comments to authenticated;
grant insert (lift, value, recorded_on) on public.lift_entries to authenticated;
grant insert (weight_lbs, recorded_on) on public.weigh_ins to authenticated;
grant insert (kind, lift, target, body, target_date) on public.goals to authenticated;
grant update (done, body, target, target_date) on public.goals to authenticated;

-- ── Row level security: you only ever see your own crew ────────────────

alter table public.teams     enable row level security;
alter table public.profiles  enable row level security;
alter table public.events    enable row level security;
alter table public.posts     enable row level security;
alter table public.reactions enable row level security;
alter table public.comments  enable row level security;
alter table public.lift_entries enable row level security;
alter table public.weigh_ins    enable row level security;
alter table public.goals        enable row level security;

create policy "see my team"    on public.teams for select to authenticated using (id = public.my_team_id());
create policy "rename my team" on public.teams for update to authenticated using (id = public.my_team_id());

create policy "see me and teammates" on public.profiles for select to authenticated
  using (id = auth.uid() or team_id = public.my_team_id());
create policy "edit my profile" on public.profiles for update to authenticated using (id = auth.uid());

create policy "team events read"   on public.events for select to authenticated using (team_id = public.my_team_id());
create policy "team events add"    on public.events for insert to authenticated with check (team_id = public.my_team_id());
create policy "team events edit"   on public.events for update to authenticated using (team_id = public.my_team_id()) with check (team_id = public.my_team_id());
create policy "team events delete" on public.events for delete to authenticated using (team_id = public.my_team_id());

create policy "team posts read" on public.posts for select to authenticated using (team_id = public.my_team_id());
create policy "post as me"      on public.posts for insert to authenticated
  with check (team_id = public.my_team_id() and user_id = auth.uid());
create policy "delete my posts" on public.posts for delete to authenticated using (user_id = auth.uid());

create policy "team reactions read" on public.reactions for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "react as me" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
create policy "unreact" on public.reactions for delete to authenticated using (user_id = auth.uid());

create policy "team comments read" on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "comment as me" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
create policy "delete my comments" on public.comments for delete to authenticated using (user_id = auth.uid());

-- Stats: the whole crew can see them (a profile is only visible to teammates); only you can change yours.
create policy "crew lifts read"   on public.lift_entries for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = user_id));
create policy "log my lifts"      on public.lift_entries for insert to authenticated with check (user_id = auth.uid());
create policy "delete my lifts"   on public.lift_entries for delete to authenticated using (user_id = auth.uid());

create policy "crew weigh-ins read" on public.weigh_ins for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = user_id));
create policy "log my weigh-ins"    on public.weigh_ins for insert to authenticated with check (user_id = auth.uid());
create policy "delete my weigh-ins" on public.weigh_ins for delete to authenticated using (user_id = auth.uid());

create policy "crew goals read" on public.goals for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = user_id));
create policy "add my goals"    on public.goals for insert to authenticated with check (user_id = auth.uid());
create policy "edit my goals"   on public.goals for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete my goals" on public.goals for delete to authenticated using (user_id = auth.uid());

-- ── Photo / video storage (private; files live under <team>/<user>/) ───

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do nothing;

create policy "team media read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_team_id()::text);
create policy "upload my media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_team_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text);
create policy "delete my media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[2] = auth.uid()::text);

-- ── Live updates ───────────────────────────────────────────────────────

alter publication supabase_realtime add table public.posts, public.events, public.comments, public.reactions,
  public.lift_entries, public.weigh_ins, public.goals;
