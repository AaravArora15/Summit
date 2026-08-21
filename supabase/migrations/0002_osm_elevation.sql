-- Summit: OSM provenance, terrain elevation, and track-plausibility signals.
--
-- Adds to the 0001 schema:
--
--   1. OSM identity on locations, so a place traces back to a real mapped
--      feature rather than a coordinate someone typed.
--   2. Terrain elevation from a DEM, for difficulty and for one cheap check.
--   3. A trails table holding OSM path geometry.
--   4. Plausibility signals recorded on every claim.
--
-- ---------------------------------------------------------------------------
-- What the measurements actually showed
-- ---------------------------------------------------------------------------
--
-- The original plan was to reject a claim when its track did not follow the
-- mapped path network. That idea was tested against 40 seeded locations, with a
-- realistic track (interpolated along the nearest real OSM way) and a spoofed
-- one (a straight line from 600 m out) at each. Coverage is the fraction of
-- fixes within 25 m of any mapped path:
--
--     honest    min 0.474    p10 0.714    median 1.000
--     spoofed   median 0.471  p90 0.800    max    0.886
--
-- The distributions overlap almost entirely. No threshold separates them. The
-- reason is specific to this city: Singapore is saturated with footpaths, so a
-- straight line drawn between two points is nearly always within 25 m of
-- something. A threshold set to catch the spoof would have rejected roughly a
-- tenth of honest walkers, which is the worst possible trade for a product
-- whose whole promise is a permanent number you earned.
--
-- Track straightness (net displacement over distance walked) discriminated far
-- better in the same test:
--
--     honest    min 0.010    median 0.263  max 0.900
--     spoofed   0.891 for every case
--
-- Better, but the tails still touch, and the honest side of that comparison is
-- itself synthetic. Calibrating a rejection threshold against a fixture I wrote
-- would be measuring my own assumptions.
--
-- So: this migration RECORDS both signals on every claim and rejects on none of
-- them. Rejection is reserved for the checks that are unambiguous, all of which
-- were verified to fire correctly: the Android mock-location flag, implausible
-- speed, missing dwell, a track too short to be a walk, and a duplicate claim.
-- Once there are real tracks in the table, query claim_signals, look at where
-- honest and suspicious actually fall, and only then set a threshold.
--
-- The general rule, worth keeping: ship the check that is provably right, log
-- the one that is merely plausible, and never let a metric you have not
-- calibrated reject a real user's walk.

-- ---------------------------------------------------------------------------
-- OSM provenance and terrain elevation on locations
-- ---------------------------------------------------------------------------

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

alter table locations
  add column osm_type         text check (osm_type in ('node', 'way', 'relation')),
  add column osm_id           bigint,
  -- Terrain height at the location, metres above sea level, from a DEM.
  add column elevation_m      real,
  -- Which DEM produced it. SRTM is a *surface* model: under rainforest canopy
  -- it returns treetop height, not ground. Bukit Timah reads 179 m against an
  -- official summit of 163.6 m for exactly this reason, so the tolerance band
  -- below is sized around that error and the source is worth keeping.
  add column elevation_source text;

create unique index locations_osm_idx on locations (osm_type, osm_id)
  where osm_id is not null;

-- ---------------------------------------------------------------------------
-- Device-reported altitude on each fix
-- ---------------------------------------------------------------------------

alter table trek_points
  -- Note this is WGS84 ellipsoidal on most Android devices and geoid-corrected
  -- on iOS, a difference of about 7 m in Singapore. One more reason the
  -- elevation band is wide.
  add column altitude_m          real,
  add column altitude_accuracy_m real;

-- ---------------------------------------------------------------------------
-- OSM path network
-- ---------------------------------------------------------------------------

create table trails (
  id       bigserial primary key,
  osm_id   bigint not null unique,
  city_id  uuid references cities(id) on delete cascade,
  name     text,
  highway  text not null,   -- 'path', 'footway', 'track', 'steps', ...
  geom     geography(LineString, 4326) not null
);

create index trails_geom_idx on trails using gist (geom);

alter table trails enable row level security;
create policy "trails are public" on trails for select using (true);

-- ---------------------------------------------------------------------------
-- Plausibility signals
-- ---------------------------------------------------------------------------

-- Fraction of the approach that ran within 25 m of a mapped path.
--
-- Scoped to 1.5 km around the location, which is coupled to the 2 km footway
-- radius in scripts/seed-osm.mjs: seeding footways for all of Singapore is
-- ~200k ways, so they are only fetched near seeded places. Scoring the whole
-- track would judge the middle of a long walk against reference data that was
-- never downloaded. Change one radius, change the other.
--
-- Returns null when there is no mapped path near the place at all, rather than
-- zero. Absence of evidence is not evidence.
create or replace function track_trail_coverage(p_trek_id uuid, p_location_id uuid)
returns real
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with loc as (select geom from locations where id = p_location_id),
  pts as (
    select p.geom from trek_points p, loc
    where p.trek_id = p_trek_id and st_dwithin(p.geom, loc.geom, 1500)
  ),
  nearby as (
    select exists (
      select 1 from trails t, loc where st_dwithin(t.geom, loc.geom, 1000)
    ) as has_data
  )
  select case
    when not (select has_data from nearby) then null
    when (select count(*) from pts) < 5 then null
    else (
      select count(*) filter (
        where exists (select 1 from trails t where st_dwithin(t.geom, p.geom, 25))
      )::real / count(*)::real
      from pts p
    )
  end;
$$;

-- Net displacement over distance actually walked, across the approach.
--
-- A synthesised A-to-B line sits near 1.0 because it never deviates. A real
-- approach winds around terrain and sits well below. Recorded, not enforced:
-- see the note at the top of this file.
create or replace function track_straightness(p_trek_id uuid, p_location_id uuid)
returns real
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with loc as (select geom from locations where id = p_location_id),
  pts as (
    select p.geom, p.recorded_at from trek_points p, loc
    where p.trek_id = p_trek_id and st_dwithin(p.geom, loc.geom, 1500)
  ),
  legs as (
    select st_distance(geom, lag(geom) over (order by recorded_at)) as d from pts
  )
  select case when (select count(*) from pts) >= 8 and sum(d) > 0 then
    (st_distance(
       (select geom from pts order by recorded_at asc  limit 1),
       (select geom from pts order by recorded_at desc limit 1)
     ) / sum(d))::real
  end
  from legs;
$$;

-- One row per claim, holding what the track looked like when it was accepted.
-- Separate from claims because this is forensic data, not part of the badge:
-- the claim is the user's, these numbers are ours.
create table claim_signals (
  claim_id       uuid primary key references claims(id) on delete cascade,
  trail_coverage real,
  straightness   real,
  max_speed_mps  real,
  point_count    integer,
  altitude_delta real,     -- device altitude minus DEM, at the location
  flagged        boolean not null default false,
  flag_reason    text,
  recorded_at    timestamptz not null default now()
);

alter table claim_signals enable row level security;
-- Deliberately no select policy for users. Telling someone which signal flagged
-- them is telling them what to change.

-- ---------------------------------------------------------------------------
-- claim_location
-- ---------------------------------------------------------------------------

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
  -- Precision comes from dwell and continuity, not a small radius.
  c_default_radius_m   constant integer := 90;
  c_dwell_seconds      constant integer := 45;
  c_min_dwell_points   constant integer := 3;
  c_max_accuracy_m     constant real    := 60;
  c_max_speed_mps      constant real    := 6.0;  -- ~21 km/h, generous for a walk
  c_min_track_points   constant integer := 10;

  -- Elevation, asymmetric on purpose. Under canopy the DEM reads treetops, so
  -- an honest walker on the ground reports an altitude BELOW it, sometimes by
  -- 40 m. Above the DEM the only errors are GPS noise and the geoid offset, so
  -- that side can be tighter.
  --
  -- Be clear about what this buys: a determined spoofer sets altitude along
  -- with latitude and longitude and walks straight through. It catches a lazy
  -- fake that leaves altitude at zero. It is a free signal, not a defence.
  c_alt_below_dem_m    constant real    := 60;
  c_alt_above_dem_m    constant real    := 45;

  -- Flagging thresholds. These do NOT reject; they mark a claim for review.
  --
  -- Set deliberately loose, because the two error costs are wildly asymmetric:
  -- a missed flag means a spoofed claim sits unexamined in the table, while a
  -- false flag costs a row in claim_signals that nobody has to act on. The
  -- measured spoof sat at straightness 0.891 and coverage 0.371, so thresholds
  -- of 0.90 / 0.30 missed it by a hair in testing. These catch it with room.
  c_flag_straightness  constant real    := 0.80;
  c_flag_coverage      constant real    := 0.50;

  v_user_id     uuid := auth.uid();
  v_location    locations%rowtype;
  v_radius_m    integer;
  v_dwell_count integer;
  v_dwell_span  integer;
  v_mocked      integer;
  v_points      integer;
  v_max_speed   real;
  v_coverage    real;
  v_straight    real;
  v_alt         real;
  v_alt_delta   real;
  v_flag        boolean := false;
  v_reason      text;
  v_number      integer;
  v_claim_id    uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Lock the location row. Concurrent claimants queue here rather than both
  -- reading the same pioneer_taken.
  select * into v_location from locations where id = p_location_id for update;

  if not found then
    raise exception 'unknown location' using errcode = 'P0002';
  end if;

  if v_location.status <> 'open' then
    raise exception 'location is closed: %', coalesce(v_location.status_note, v_location.status)
      using errcode = 'P0001';
  end if;

  -- A friendly message beats a unique-constraint violation reaching the UI.
  if exists (
    select 1 from claims where user_id = v_user_id and location_id = p_location_id
  ) then
    raise exception 'you have already claimed %', v_location.name using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from treks where id = p_trek_id and user_id = v_user_id
  ) then
    raise exception 'trek does not belong to caller' using errcode = '42501';
  end if;

  if v_location.is_secret and p_photo_path is null then
    raise exception 'secret spots require a photo' using errcode = 'P0001';
  end if;

  -- --- hard checks: only things that are unambiguous ------------------------

  select count(*) into v_points from trek_points where trek_id = p_trek_id;

  if v_points < c_min_track_points then
    raise exception 'track too short to be a trek' using errcode = 'P0001';
  end if;

  select count(*) into v_mocked
  from trek_points where trek_id = p_trek_id and is_mocked;

  if v_mocked > 0 then
    raise exception 'mocked location reported' using errcode = 'P0001';
  end if;

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
         coalesce(extract(epoch from max(recorded_at) - min(recorded_at)), 0),
         avg(altitude_m)
    into v_dwell_count, v_dwell_span, v_alt
  from trek_points
  where trek_id = p_trek_id
    and coalesce(accuracy_m, 0) <= c_max_accuracy_m
    and st_dwithin(geom, v_location.geom, v_radius_m);

  if v_dwell_count < c_min_dwell_points or v_dwell_span < c_dwell_seconds then
    raise exception 'did not dwell at the location' using errcode = 'P0001';
  end if;

  if v_location.elevation_m is not null and v_alt is not null then
    v_alt_delta := v_alt - v_location.elevation_m;
    if v_alt_delta < -c_alt_below_dem_m or v_alt_delta > c_alt_above_dem_m then
      raise exception 'reported altitude does not match the terrain' using errcode = 'P0001';
    end if;
  end if;

  -- --- soft signals: recorded, never rejected ------------------------------

  v_coverage := track_trail_coverage(p_trek_id, p_location_id);
  v_straight := track_straightness(p_trek_id, p_location_id);

  if v_straight is not null and v_straight > c_flag_straightness then
    v_flag := true;
    v_reason := 'straight track (' || round(v_straight::numeric, 3) || ')';
  end if;

  if v_coverage is not null and v_coverage < c_flag_coverage then
    v_flag := true;
    v_reason := concat_ws('; ', v_reason,
      'low trail coverage (' || round(v_coverage::numeric, 3) || ')');
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

  insert into claim_signals (
    claim_id, trail_coverage, straightness, max_speed_mps,
    point_count, altitude_delta, flagged, flag_reason
  )
  values (
    v_claim_id, v_coverage, v_straight, v_max_speed,
    v_points, v_alt_delta, v_flag, v_reason
  );

  return query
  select v_claim_id, v_number,
         case when v_number is null then 'explorer' else 'pioneer' end;
end;
$$;

revoke all on function claim_location(uuid, uuid, text) from public;
grant execute on function claim_location(uuid, uuid, text) to authenticated;
revoke all on function track_trail_coverage(uuid, uuid) from public;
revoke all on function track_straightness(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Secret spot geofencing
-- ---------------------------------------------------------------------------

-- Geofencing needs the phone to hold a circle locally, but a secret spot's
-- coordinates must never reach the client or the hunt is over before it begins.
--
-- The resolution: hand out a deliberately coarse circle. The centre is snapped
-- to a ~300 m grid and the radius is wide, so the phone can say "there is
-- something around here" without being able to walk straight to it. Snapping
-- rather than random jitter matters: a random offset re-queried enough times
-- averages out to the true point, while a grid cell returns the same answer
-- every time and never narrows.
--
-- iOS monitors at most 20 regions per app, so this returns a bounded set
-- ordered by distance and the client re-registers as it moves.
create or replace function secret_spots_near(
  p_lat    double precision,
  p_lng    double precision,
  p_radius integer default 20000,
  p_limit  integer default 20
)
returns table (
  id           uuid,
  name         text,
  fuzzed_lat   double precision,
  fuzzed_lng   double precision,
  fence_radius integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  -- 0.0027 degrees is about 300 m at the equator.
  select
    l.id,
    l.name,
    round((st_y(l.geom::geometry) / 0.0027)::numeric)::double precision * 0.0027,
    round((st_x(l.geom::geometry) / 0.0027)::numeric)::double precision * 0.0027,
    400
  from locations l
  where l.is_secret
    and l.status = 'open'
    and st_dwithin(l.geom, st_point(p_lng, p_lat)::geography, p_radius)
    and not exists (
      select 1 from claims c where c.location_id = l.id and c.user_id = auth.uid()
    )
  order by l.geom <-> st_point(p_lng, p_lat)::geography
  limit least(p_limit, 20);
$$;

revoke all on function secret_spots_near(double precision, double precision, integer, integer) from public;
grant execute on function secret_spots_near(double precision, double precision, integer, integer) to authenticated;

commit;
