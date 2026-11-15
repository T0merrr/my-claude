-- Maggie Koala Spotter: schema, rules and storage.
--
-- Design notes
-- * Clients never write to tables directly. Every write goes through a
--   SECURITY DEFINER function below, which is where island bounds, the
--   48-hour window, rate limits and ownership are enforced.
-- * Clients never read the sightings table directly either (apart from
--   their own rows). The public map reads get_public_sightings(), which is
--   the single place the 48-hour rule and the hidden flag are applied, and
--   which never returns device_id.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sightings (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  captured_at     timestamptz not null,
  location        extensions.geography(Point, 4326) not null,
  location_source text not null check (location_source in ('exif', 'device', 'manual')),
  time_source     text not null check (time_source in ('exif', 'device', 'manual')),
  verified        boolean not null default false,
  photo_path      text not null,
  thumbnail_path  text not null,
  koala_count     smallint check (koala_count between 1 and 20),
  has_joey        boolean,
  activity        text check (activity in ('sleeping', 'awake', 'moving')),
  track_name      text check (char_length(track_name) <= 80),
  hint            text check (char_length(hint) <= 280),
  camera_model    text check (char_length(camera_model) <= 120),
  -- Anonymous Supabase auth user. Null for seeded rows.
  device_id       uuid references auth.users (id) on delete set null,
  hidden          boolean not null default false,
  hidden_reason   text check (hidden_reason in ('flags', 'admin')),
  -- Set when an admin has looked at the post. A reviewed post is no longer
  -- auto-hidden by flags, so an admin's "unhide" sticks.
  reviewed_at     timestamptz
);

create index sightings_captured_at_idx on public.sightings (captured_at desc);
create index sightings_device_created_idx on public.sightings (device_id, created_at desc);
create index sightings_location_idx on public.sightings using gist (location);

create table public.confirmations (
  id          uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings (id) on delete cascade,
  device_id   uuid not null references auth.users (id) on delete cascade,
  type        text not null check (type in ('still_here', 'not_found')),
  created_at  timestamptz not null default now(),
  unique (sighting_id, device_id)
);

create index confirmations_device_created_idx on public.confirmations (device_id, created_at desc);

create table public.flags (
  id          uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings (id) on delete cascade,
  device_id   uuid not null references auth.users (id) on delete cascade,
  reason      text not null check (reason in ('not_a_koala', 'wrong_location', 'inappropriate', 'spam', 'other')),
  created_at  timestamptz not null default now(),
  unique (sighting_id, device_id)
);

create index flags_device_created_idx on public.flags (device_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: a device can see only its own rows. No direct writes.
-- ---------------------------------------------------------------------------

alter table public.sightings     enable row level security;
alter table public.confirmations enable row level security;
alter table public.flags         enable row level security;

revoke all on public.sightings, public.confirmations, public.flags from anon, authenticated;
grant select on public.sightings, public.confirmations, public.flags to authenticated;

create policy "own sightings are readable" on public.sightings
  for select to authenticated using (device_id = (select auth.uid()));

create policy "own confirmations are readable" on public.confirmations
  for select to authenticated using (device_id = (select auth.uid()));

create policy "own flags are readable" on public.flags
  for select to authenticated using (device_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Island bounds. Keep in sync with lib/island.ts.
-- ---------------------------------------------------------------------------

create or replace function public.is_on_island(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lat between -19.195 and -19.095
     and p_lng between 146.765 and 146.895;
$$;

-- ---------------------------------------------------------------------------
-- Public read: the only way the map gets data.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_sightings()
returns table (
  id                uuid,
  created_at        timestamptz,
  captured_at       timestamptz,
  lat               double precision,
  lng               double precision,
  location_source   text,
  time_source       text,
  verified          boolean,
  photo_path        text,
  thumbnail_path    text,
  koala_count       smallint,
  has_joey          boolean,
  activity          text,
  track_name        text,
  hint              text,
  still_here_count  integer,
  not_found_count   integer,
  last_confirmed_at timestamptz,
  is_mine           boolean,
  my_vote           text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.created_at,
    s.captured_at,
    extensions.st_y(s.location::extensions.geometry) as lat,
    extensions.st_x(s.location::extensions.geometry) as lng,
    s.location_source,
    s.time_source,
    s.verified,
    s.photo_path,
    s.thumbnail_path,
    s.koala_count,
    s.has_joey,
    s.activity,
    s.track_name,
    s.hint,
    coalesce(c.still_here, 0)::integer,
    coalesce(c.not_found, 0)::integer,
    c.last_confirmed_at,
    coalesce(s.device_id = auth.uid(), false) as is_mine,
    (select v.type from public.confirmations v
      where v.sighting_id = s.id and v.device_id = auth.uid()) as my_vote
  from public.sightings s
  left join lateral (
    select
      count(*) filter (where k.type = 'still_here') as still_here,
      count(*) filter (where k.type = 'not_found')  as not_found,
      max(k.created_at) as last_confirmed_at
    from public.confirmations k
    where k.sighting_id = s.id
  ) c on true
  where not s.hidden
    and s.captured_at > now() - interval '48 hours'
  order by s.captured_at desc
  limit 500;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Error messages are stable codes; the client maps them to friendly text.

create or replace function public.create_sighting(
  p_id              uuid,
  p_lat             double precision,
  p_lng             double precision,
  p_captured_at     timestamptz,
  p_location_source text,
  p_time_source     text,
  p_photo_path      text,
  p_thumbnail_path  text,
  p_koala_count     integer default null,
  p_has_joey        boolean default null,
  p_activity        text default null,
  p_track_name      text default null,
  p_hint            text default null,
  p_camera_model    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_verified boolean;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  -- Offline retries resend the same id. Treat a repeat as success.
  if exists (select 1 from public.sightings where id = p_id and device_id = v_uid) then
    return p_id;
  end if;

  if p_lat is null or p_lng is null or not public.is_on_island(p_lat, p_lng) then
    raise exception 'outside_island';
  end if;

  if p_captured_at is null or p_captured_at > now() + interval '10 minutes' then
    raise exception 'time_in_future';
  end if;

  if p_captured_at < now() - interval '48 hours' then
    raise exception 'too_old';
  end if;

  -- Photos must live in the caller's own folder of the bucket.
  if p_photo_path not like v_uid::text || '/%'
     or p_thumbnail_path not like v_uid::text || '/%' then
    raise exception 'bad_photo_path';
  end if;

  if (select count(*) from public.sightings
       where device_id = v_uid and created_at > now() - interval '1 hour') >= 6
     or (select count(*) from public.sightings
          where device_id = v_uid and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate_limited';
  end if;

  -- "Verified" means only this: the position and time both came from the
  -- photo's own data, the position is on the island, and the photo was
  -- taken within 24 hours of upload. The client reports the sources, so
  -- this is a signal and not proof.
  v_verified := p_location_source = 'exif'
            and p_time_source = 'exif'
            and p_captured_at >= now() - interval '24 hours';

  insert into public.sightings (
    id, captured_at, location, location_source, time_source, verified,
    photo_path, thumbnail_path, koala_count, has_joey, activity,
    track_name, hint, camera_model, device_id
  ) values (
    p_id,
    p_captured_at,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    p_location_source,
    p_time_source,
    v_verified,
    p_photo_path,
    p_thumbnail_path,
    p_koala_count,
    p_has_joey,
    p_activity,
    nullif(btrim(p_track_name), ''),
    nullif(btrim(p_hint), ''),
    nullif(btrim(left(p_camera_model, 120)), ''),
    v_uid
  );

  return p_id;
end;
$$;

create or replace function public.vote_sighting(p_sighting_id uuid, p_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  if p_type not in ('still_here', 'not_found') then
    raise exception 'bad_vote';
  end if;

  select s.device_id into v_owner
    from public.sightings s
   where s.id = p_sighting_id
     and not s.hidden
     and s.captured_at > now() - interval '48 hours';

  if not found then
    raise exception 'sighting_gone';
  end if;

  if v_owner = v_uid then
    raise exception 'own_sighting';
  end if;

  if (select count(*) from public.confirmations
       where device_id = v_uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'rate_limited';
  end if;

  insert into public.confirmations (sighting_id, device_id, type)
  values (p_sighting_id, v_uid, p_type)
  on conflict (sighting_id, device_id)
  do update set type = excluded.type, created_at = now();
end;
$$;

create or replace function public.flag_sighting(p_sighting_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  if not exists (select 1 from public.sightings where id = p_sighting_id) then
    raise exception 'sighting_gone';
  end if;

  if (select count(*) from public.flags
       where device_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;

  insert into public.flags (sighting_id, device_id, reason)
  values (p_sighting_id, v_uid, p_reason)
  on conflict (sighting_id, device_id) do nothing;

  -- Three different devices flagging a post hides it until an admin looks.
  update public.sightings s
     set hidden = true, hidden_reason = 'flags'
   where s.id = p_sighting_id
     and not s.hidden
     and s.reviewed_at is null
     and (select count(*) from public.flags f where f.sighting_id = s.id) >= 3;
end;
$$;

create or replace function public.delete_my_sighting(p_sighting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  delete from public.sightings where id = p_sighting_id and device_id = v_uid;

  if not found then
    raise exception 'sighting_gone';
  end if;
end;
$$;

revoke execute on function
  public.get_public_sightings(),
  public.create_sighting(uuid, double precision, double precision, timestamptz, text, text, text, text, integer, boolean, text, text, text, text),
  public.vote_sighting(uuid, text),
  public.flag_sighting(uuid, text),
  public.delete_my_sighting(uuid)
from public, anon, authenticated;

grant execute on function public.get_public_sightings() to anon, authenticated;

grant execute on function
  public.create_sighting(uuid, double precision, double precision, timestamptz, text, text, text, text, integer, boolean, text, text, text, text),
  public.vote_sighting(uuid, text),
  public.flag_sighting(uuid, text),
  public.delete_my_sighting(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public-read bucket, a device can add and remove only inside its
-- own folder. JPEG only, 3 MB cap (the app uploads about 300 KB).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sighting-photos', 'sighting-photos', true, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "devices upload into their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sighting-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "devices delete from their own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sighting-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Admin listing. Callable only with the service role key (server side).
-- Returns everything, including hidden posts and posts older than 48 hours.
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_sightings()
returns table (
  id               uuid,
  created_at       timestamptz,
  captured_at      timestamptz,
  lat              double precision,
  lng              double precision,
  location_source  text,
  time_source      text,
  verified         boolean,
  photo_path       text,
  thumbnail_path   text,
  koala_count      smallint,
  has_joey         boolean,
  activity         text,
  track_name       text,
  hint             text,
  camera_model     text,
  device_id        uuid,
  hidden           boolean,
  hidden_reason    text,
  reviewed_at      timestamptz,
  still_here_count integer,
  not_found_count  integer,
  flag_count       integer,
  flag_reasons     text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id, s.created_at, s.captured_at,
    extensions.st_y(s.location::extensions.geometry),
    extensions.st_x(s.location::extensions.geometry),
    s.location_source, s.time_source, s.verified,
    s.photo_path, s.thumbnail_path,
    s.koala_count, s.has_joey, s.activity, s.track_name, s.hint,
    s.camera_model, s.device_id, s.hidden, s.hidden_reason, s.reviewed_at,
    (select count(*) from public.confirmations k where k.sighting_id = s.id and k.type = 'still_here')::integer,
    (select count(*) from public.confirmations k where k.sighting_id = s.id and k.type = 'not_found')::integer,
    (select count(*) from public.flags f where f.sighting_id = s.id)::integer,
    coalesce((select array_agg(f.reason order by f.created_at) from public.flags f where f.sighting_id = s.id), '{}')
  from public.sightings s
  order by s.created_at desc
  limit 1000;
$$;

revoke execute on function public.admin_list_sightings() from public, anon, authenticated;
grant execute on function public.admin_list_sightings() to service_role;
