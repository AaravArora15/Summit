-- Summit: initial schema
-- Postgres 15 + PostGIS on Supabase.
--
-- Design rules encoded here:
--   1. Pioneer numbers are allocated server-side, under a row lock, with a
--      unique constraint as the backstop. Never computed on the client.
--   2. The client submits a trek. The server decides what it was worth.
--   3. Arrival is proven by dwell (several fixes over time inside a generous
--      radius), not by a single point inside a tight one. Under rainforest
--      canopy a single-fix test fails honest users and passes spoofers.

-- Supabase installs PostGIS into a dedicated `extensions` schema rather than
-- public, so `geography` and `st_dwithin` are not resolvable by default. This
-- block makes a local database match that layout exactly, so what is tested is
-- what ships. Without it these migrations apply locally and fail on Supabase
-- with "type geography does not exist", which is a confusing way to discover
-- the difference.
-- Wrapped in a single transaction with `set local search_path`, rather than a
-- bare session-level SET at the top.
--
-- The reason is connection pooling. Supabase's direct connection is IPv6-only
-- on the free tier, so many networks can only reach the transaction pooler,
-- and in transaction mode each statement can land on a different backend. A
-- session-level SET would then apply to one statement and be gone for the next,
-- and every reference to `geography` or `st_dwithin` after it would fail. One
-- transaction pins the whole file to one backend, and `set local` scopes the
-- path to exactly that transaction.
begin;
set local search_path = public, extensions;

create schema if not exists extensions;
create extension if not exists postgis  with schema extensions;
create extension if not exists pgcrypto with schema extensions;



-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table cities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  country       text not null,
  centre        geography(Point, 4326) not null,
  -- "The 472nd climber in Singapore" is a per-city counter, and is therefore
  -- race-prone in exactly the same way pioneer numbers are.
  explorer_taken integer not null default 0
);

-- The six colour groups from the sets board (screen 14).
create table location_sets (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references cities(id) on delete cascade,
  key         text not null,               -- 'rainforest', 'coastal', ...
  name        text not null,               -- 'Rainforest'
  colour      text not null,               -- '#35604A', the deed cap colour
  blurb       text,
  sort_order  integer not null default 0,
  unique (city_id, key)
);

create type rarity as enum ('common', 'rare', 'epic', 'legendary');

create table locations (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references cities(id) on delete cascade,
  set_id          uuid references location_sets(id) on delete set null,
  slug            text not null unique,     -- 'hiddenforest', used in the badge ID
  name            text not null,
  geom            geography(Point, 4326) not null,

  rarity          rarity not null default 'common',
  difficulty      smallint not null default 1 check (difficulty between 1 and 4),
  distance_m      integer,
  ascent_m        integer,
  avg_time_min    integer,

  -- Scarcity. Past the cap, claims still succeed but carry a null number
  -- (the "Explorer edition" the onboarding screen promises).
  pioneer_cap     integer not null default 500,
  pioneer_taken   integer not null default 0,

  -- Secret spots are found, not signposted. Their coordinates are never sent
  -- to the client (see the secret_spot_hints view) and claiming one also
  -- requires a photo, per the hunt screen.
  is_secret       boolean not null default false,

  -- Per-location override for canopy, urban canyon, or an unusually large
  -- summit area. Null falls back to the global default in claim_location().
  arrival_radius_m integer,

  status          text not null default 'open'
                  check (status in ('open', 'closed', 'seasonal')),
  status_note     text,
  created_at      timestamptz not null default now()
);

create index locations_geom_idx on locations using gist (geom);
create index locations_city_idx on locations (city_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null,
  home_city_id    uuid references cities(id),
  explorer_number integer,                  -- #0472, permanent, per city
  created_at      timestamptz not null default now(),
  unique (home_city_id, explorer_number)
);

-- ---------------------------------------------------------------------------
-- Treks
-- ---------------------------------------------------------------------------

create type trek_status as enum ('recording', 'submitted', 'validated', 'rejected');

create table treks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  distance_m    numeric(10,1),
  moving_time_s integer,
  status        trek_status not null default 'recording',
  reject_reason text,
  created_at    timestamptz not null default now()
);

create index treks_user_idx on treks (user_id, started_at desc);

-- One row per GPS fix. Timestamps and accuracy are kept because the
-- validation depends on both: a linestring alone loses the timing that makes
-- dwell and speed checkable.
create table trek_points (
  id          bigserial primary key,
  trek_id     uuid not null references treks(id) on delete cascade,
  geom        geography(Point, 4326) not null,
  recorded_at timestamptz not null,
  accuracy_m  real,          -- the OS-reported accuracy circle
  is_mocked   boolean not null default false  -- Android only; iOS never sets this
);

create index trek_points_geom_idx on trek_points using gist (geom);
create index trek_points_trek_idx on trek_points (trek_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

create table claims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  trek_id        uuid references treks(id) on delete set null,
  pioneer_number integer,                   -- null = Explorer edition
  photo_path     text,                      -- required for secret spots
  claimed_at     timestamptz not null default now(),

  unique (user_id, location_id),            -- you claim a place once
  unique (location_id, pioneer_number)      -- the backstop: no duplicate #0048
);

create index claims_user_idx on claims (user_id, claimed_at desc);

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------

-- Itemised so the reward screen can show every point against the thing that
-- earned it, and so the total is auditable rather than magical.
create table points_ledger (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  trek_id     uuid references treks(id) on delete cascade,
  source      text not null check (source in (
                'distance', 'moving_time', 'new_route', 'first_discovery',
                'secret_spot', 'beat_average', 'set_complete')),
  amount      integer not null,
  awarded_at  timestamptz not null default now()
);

create index points_user_idx on points_ledger (user_id, awarded_at desc);

-- ---------------------------------------------------------------------------
-- Pioneer number allocation
-- ---------------------------------------------------------------------------
--
-- The sharp edge of the whole product. Two people summiting at the same moment
-- must not both receive #0048.
--
-- Three independent defences, in order of which one you would rather rely on:
--   1. SELECT ... FOR UPDATE serialises concurrent callers on the location row.
--   2. The counter is incremented and read in the same statement.
--   3. unique (location_id, pioneer_number) refuses a duplicate even if 1 and 2
--      are wrong.

create or replace function claim_location(
  p_location_id uuid,
  p_trek_id     uuid,
  p_photo_path  text default null
)
returns table (
  claim_id       uuid,
  pioneer_number integer,
  edition        text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Tuned for rainforest canopy, where a 5 m accuracy circle is fantasy.
  -- Precision comes from dwell and track continuity, not a small radius.
  c_default_radius_m   constant integer := 90;
  c_dwell_seconds      constant integer := 45;
  c_min_dwell_points   constant integer := 3;
  c_max_accuracy_m     constant real    := 60;   -- ignore fixes worse than this
  c_max_speed_mps      constant real    := 6.0;  -- ~21 km/h, generous for a walk
  c_min_track_points   constant integer := 10;

  v_user_id     uuid := auth.uid();
  v_location    locations%rowtype;
  v_radius_m    integer;
  v_dwell_count integer;
  v_dwell_span  integer;
  v_mocked      integer;
  v_points      integer;
  v_max_speed   real;
  v_number      integer;
  v_claim_id    uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Lock the location row. Concurrent claimants queue here rather than both
  -- reading the same pioneer_taken.
  select * into v_location
  from locations
  where id = p_location_id
  for update;

  if not found then
    raise exception 'unknown location' using errcode = 'P0002';
  end if;

  if v_location.status <> 'open' then
    raise exception 'location is closed: %', coalesce(v_location.status_note, v_location.status)
      using errcode = 'P0001';
  end if;

  -- The trek must belong to the caller. Never trust the trek id alone.
  if not exists (
    select 1 from treks
    where id = p_trek_id and user_id = v_user_id
  ) then
    raise exception 'trek does not belong to caller' using errcode = '42501';
  end if;

  -- Secret spots need photo proof. The hint describes something only someone
  -- standing there can photograph, which is stronger evidence than coordinates.
  if v_location.is_secret and p_photo_path is null then
    raise exception 'secret spots require a photo' using errcode = 'P0001';
  end if;

  -- --- integrity checks -----------------------------------------------------

  select count(*) into v_points
  from trek_points where trek_id = p_trek_id;

  if v_points < c_min_track_points then
    raise exception 'track too short to be a trek' using errcode = 'P0001';
  end if;

  select count(*) into v_mocked
  from trek_points where trek_id = p_trek_id and is_mocked;

  if v_mocked > 0 then
    raise exception 'mocked location reported' using errcode = 'P0001';
  end if;

  -- Fastest leg between consecutive fixes. Catches teleports and drives.
  select max(speed) into v_max_speed
  from (
    select st_distance(geom, lag(geom) over w)
           / nullif(extract(epoch from recorded_at - lag(recorded_at) over w), 0) as speed
    from trek_points
    where trek_id = p_trek_id
    window w as (order by recorded_at)
  ) legs;

  if v_max_speed > c_max_speed_mps then
    raise exception 'implausible speed on track' using errcode = 'P0001';
  end if;

  -- --- arrival: dwell, not a point -----------------------------------------

  v_radius_m := coalesce(v_location.arrival_radius_m, c_default_radius_m);

  select count(*),
         coalesce(extract(epoch from max(recorded_at) - min(recorded_at)), 0)
    into v_dwell_count, v_dwell_span
  from trek_points
  where trek_id = p_trek_id
    and coalesce(accuracy_m, 0) <= c_max_accuracy_m
    and st_dwithin(geom, v_location.geom, v_radius_m);

  if v_dwell_count < c_min_dwell_points or v_dwell_span < c_dwell_seconds then
    raise exception 'did not dwell at the location' using errcode = 'P0001';
  end if;

  -- --- allocation -----------------------------------------------------------

  if v_location.pioneer_taken < v_location.pioneer_cap then
    update locations
       set pioneer_taken = pioneer_taken + 1
     where id = p_location_id
    returning pioneer_taken into v_number;
  else
    v_number := null;  -- Explorer edition: still yours, just without a number
  end if;

  insert into claims (user_id, location_id, trek_id, pioneer_number, photo_path)
  values (v_user_id, p_location_id, p_trek_id, v_number, p_photo_path)
  returning id into v_claim_id;

  return query
  select v_claim_id,
         v_number,
         case when v_number is null then 'explorer' else 'pioneer' end;
end;
$$;

revoke all on function claim_location(uuid, uuid, text) from public;
grant execute on function claim_location(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Explorer number allocation (the #0472 permanent identity)
-- ---------------------------------------------------------------------------

create or replace function claim_explorer_number(p_city_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_number  integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select explorer_number into v_number
  from profiles where id = v_user_id;

  if v_number is not null then
    return v_number;      -- never changes, never transfers
  end if;

  perform 1 from cities where id = p_city_id for update;

  update cities
     set explorer_taken = explorer_taken + 1
   where id = p_city_id
  returning explorer_taken into v_number;

  update profiles
     set explorer_number = v_number,
         home_city_id    = p_city_id
   where id = v_user_id;

  return v_number;
end;
$$;

revoke all on function claim_explorer_number(uuid) from public;
grant execute on function claim_explorer_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Nearby locations (the explore map query)
-- ---------------------------------------------------------------------------

create or replace function locations_near(
  p_lat    double precision,
  p_lng    double precision,
  p_radius integer default 5000
)
returns table (
  id           uuid,
  name         text,
  slug         text,
  set_id       uuid,
  rarity       rarity,
  difficulty   smallint,
  distance_m   double precision,
  pioneer_taken integer,
  pioneer_cap  integer,
  status       text
)
language sql
stable
as $$
  select l.id, l.name, l.slug, l.set_id, l.rarity, l.difficulty,
         st_distance(l.geom, st_point(p_lng, p_lat)::geography) as distance_m,
         l.pioneer_taken, l.pioneer_cap, l.status
  from locations l
  where not l.is_secret                    -- secret spots never ship coordinates
    and st_dwithin(l.geom, st_point(p_lng, p_lat)::geography, p_radius)
  order by distance_m;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table profiles      enable row level security;
alter table treks         enable row level security;
alter table trek_points   enable row level security;
alter table claims        enable row level security;
alter table points_ledger enable row level security;
alter table locations     enable row level security;
alter table location_sets enable row level security;
alter table cities        enable row level security;

-- Reference data is world-readable, except secret spot coordinates.
create policy "sets are public"   on location_sets for select using (true);
create policy "cities are public" on cities        for select using (true);
create policy "open locations are public" on locations
  for select using (not is_secret);

-- Your own treks.
create policy "own treks" on treks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own trek points" on trek_points
  for all using (
    exists (select 1 from treks t where t.id = trek_id and t.user_id = auth.uid())
  ) with check (
    exists (select 1 from treks t where t.id = trek_id and t.user_id = auth.uid())
  );

-- Claims are readable by everyone (the league and badge holders are public),
-- but only ever written by claim_location(), which is SECURITY DEFINER.
create policy "claims are public" on claims for select using (true);

-- Points are yours alone, and are only written server-side.
create policy "own points" on points_ledger for select using (user_id = auth.uid());

create policy "profiles are public" on profiles for select using (true);
create policy "own profile write" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

commit;
