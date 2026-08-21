-- Summit: environmental clipping and behavioural spoofing signals.
--
-- Builds on 0002. The governing rule from that migration still holds: a check
-- gets to REJECT only once it has been measured and shown to separate honest
-- tracks from fake ones. Everything else is recorded and left for calibration
-- against real data. 0002 learned that lesson the expensive way, when trail
-- proximity turned out not to discriminate at all in a city as densely
-- footpathed as Singapore.

-- ---------------------------------------------------------------------------
-- Places a walk should never pass through
-- ---------------------------------------------------------------------------

-- Buildings, water and restricted land, from OSM. This is the environmental
-- clipping check: a real person walks around a building and along the shore of
-- a reservoir, while a synthesised line goes straight through both because it
-- does not know they are there.
--
-- Stored as geometry rather than geography: every use is a point-in-polygon or
-- line-crossing test, which needs no distance maths, and the planar operators
-- are considerably faster over 127k polygons.
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

create table no_go_areas (
  id      bigserial primary key,
  osm_id  bigint not null unique,
  kind    text not null check (kind in ('building', 'water', 'restricted')),
  name    text,
  geom    geometry(Geometry, 4326) not null
);

create index no_go_geom_idx on no_go_areas using gist (geom);
create index no_go_kind_idx on no_go_areas (kind);

alter table no_go_areas enable row level security;
create policy "no-go areas are public" on no_go_areas for select using (true);

-- ---------------------------------------------------------------------------
-- Signals
-- ---------------------------------------------------------------------------

-- Fraction of consecutive legs that cross a building, reservoir or restricted
-- area WITHOUT running along a mapped path.
--
-- Legs, not points. A fix rarely lands exactly inside a building footprint, but
-- the segment between two fixes either crosses one or it does not, and that is
-- what a fabricated route cannot avoid without knowing the map.
--
-- The path exemption is not a softening, it is the thing that makes the check
-- mean anything here. Measured without it, 12.5% of honest tracks "crossed
-- water" because Singapore trails run over reservoirs on boardwalks and
-- causeways, and 45% "crossed buildings" because sheltered linkways, malls and
-- MRT concourses are genuinely where the footpath goes. A bridge is a path over
-- water; a linkway is a path through a building. Both are mapped, so requiring
-- the leg to be off-path as well removes the entire false-positive class.
--
-- Scoped to 1.5 km of the location for the same reason as trail coverage:
-- building footprints are only seeded within 2 km of a place. See
-- BUILDING_RADIUS_M in scripts/seed-osm.mjs. Change one, change the other.
--
-- Measured across 40 locations, honest track versus straight-line spoof:
--
--     threshold   spoofs caught   honest wrongly rejected
--       0.05         23 / 40             8 / 40
--       0.10         17 / 40             6 / 40
--       0.30          6 / 40             1 / 40
--
-- The best available trade still rejects one honest walker in forty to catch
-- one spoofer in seven, and the honest fixture follows trails exactly while a
-- real phone wanders by ten metres, so the true false-positive rate is worse
-- than that. It flags. It does not reject.
create or replace function track_clipping(p_trek_id uuid, p_location_id uuid)
returns real
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with loc as (select geom from locations where id = p_location_id),
  pts as (
    select p.geom::geometry as g, p.recorded_at
    from trek_points p, loc
    where p.trek_id = p_trek_id and st_dwithin(p.geom, loc.geom, 1500)
  ),
  legs as (
    select st_makeline(lag(g) over w, g) as seg
    from pts window w as (order by recorded_at)
  ),
  real_legs as (
    select seg from legs where seg is not null and st_length(seg) > 0
  )
  select case when count(*) = 0 then null else
    count(*) filter (
      where exists (
        select 1 from no_go_areas a
        where a.geom && seg and st_intersects(a.geom, seg)
      )
      and not exists (
        select 1 from trails t where st_dwithin(t.geom, seg::geography, 25)
      )
    )::real / count(*)::real
  end
  from real_legs;
$$;

-- Spread of device-reported altitude across a track.
--
-- The point is flatness, not accuracy. Many spoofing tools emit a constant
-- altitude, or none, because simulating a terrain profile is work. A real walk
-- to a summit varies even on flat ground, because GPS altitude is noisy.
--
-- Returns null when the device reported no altitude at all, which is common
-- indoors and under canopy and is not evidence of anything.
create or replace function track_altitude_spread(p_trek_id uuid)
returns real
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case when count(altitude_m) >= 10 then stddev_pop(altitude_m)::real end
  from trek_points where trek_id = p_trek_id;
$$;

-- How machine-like the timing of the fixes is.
--
-- Coefficient of variation of the gaps between consecutive fixes. A phone
-- delivering real GPS batches produces irregular gaps: the OS coalesces, the
-- radio drops, the user goes under a bridge. A generator emitting a fix every
-- exactly-N milliseconds produces a value near zero.
--
-- This is the walking equivalent of the Pokemon Go tell where an account spins
-- a stop at the identical millisecond offset every time.
create or replace function track_cadence_regularity(p_trek_id uuid)
returns real
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with gaps as (
    select extract(epoch from recorded_at - lag(recorded_at) over (order by recorded_at)) as g
    from trek_points where trek_id = p_trek_id
  ),
  clean as (select g from gaps where g is not null and g > 0)
  select case
    when (select count(*) from clean) >= 10 and avg(g) > 0
    then (stddev_pop(g) / avg(g))::real
  end
  from clean;
$$;

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

alter table claim_signals
  add column clipping         real,   -- fraction of legs crossing a no-go area
  add column altitude_spread  real,   -- stddev of reported altitude, metres
  add column cadence_cv       real,   -- 0 = perfectly regular, machine-like
  add column device_integrity text,   -- 'ok' | 'rooted' | 'emulator' | 'unknown'
  add column account_age_days integer;

-- Everything the client asserts about its own hardware. Separate from the
-- measured signals because it is self-reported and a rooted device can lie
-- about being rooted. Useful in aggregate, never on its own.
alter table treks
  add column device_integrity text;

revoke all on function track_clipping(uuid, uuid) from public;
revoke all on function track_altitude_spread(uuid) from public;
revoke all on function track_cadence_regularity(uuid) from public;

-- ---------------------------------------------------------------------------
-- claim_location, with the behavioural signals folded in
-- ---------------------------------------------------------------------------

-- What changed from 0002, and why each thing landed where it did.
--
-- One new HARD reject: a per-user rate limit. That is a policy, not a
-- detection. It does not try to guess whether a walk was real, it says nobody
-- claims six places in an hour, which is true of every honest user and costs
-- them nothing. Policies are safe to enforce; inferences are not.
--
-- Everything else added here FLAGS.
--
-- A pedometer cross-check was built here and then removed. The reasoning is
-- worth keeping, because the idea is a good one and will come back:
--
--   The appeal was that the step counter is a different sensor from GPS, so a
--   fabricated location feed does not move it, making "5 km covered, 0 steps"
--   categorical rather than a threshold judgement. That is exactly the property
--   every geometric check here lacks.
--
--   It could not reject anyway. A cyclist produces the same reading, as does a
--   wheelchair user, so without a declared activity type on the trek it cannot
--   separate a spoofer from someone who rode the trail. And the platforms do
--   not agree: getStepCountAsync is iOS-only, while Android's live watch stops
--   when the screen locks, which is most of any real trek. So it bought a
--   permanent iOS/Android split and a native dependency in exchange for one
--   more flag.
--
--   Revisit it when treks declare an activity type. At that point it can be a
--   hard reject for declared walks, which is worth real cost. Until then it was
--   not.
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
  c_default_radius_m   constant integer := 90;
  c_dwell_seconds      constant integer := 45;
  c_min_dwell_points   constant integer := 3;
  c_max_accuracy_m     constant real    := 60;
  c_max_speed_mps      constant real    := 6.0;
  c_min_track_points   constant integer := 10;
  c_alt_below_dem_m    constant real    := 60;
  c_alt_above_dem_m    constant real    := 45;

  -- Policy, not detection. Nobody walks to six places in an hour.
  c_max_claims_per_hour constant integer := 5;

  -- Flag thresholds. Loose on purpose: a missed flag leaves a fake claim
  -- unexamined, a false flag costs a row nobody has to act on.
  c_flag_straightness  constant real := 0.80;
  c_flag_coverage      constant real := 0.50;
  -- 0.10, not the 0.30 the sweep below suggested. Re-measured at the five
  -- densest urban locations, straight-line spoofs clipped 0.12 to 0.18 while
  -- honest tracks sat at 0.00 to 0.05, so a 0.30 threshold would never have
  -- fired on a real fake. The sweep's 0.30 row was optimising for a rejection
  -- rule; this is a flag, where a false positive costs a row nobody must act on.
  c_flag_clipping      constant real := 0.10;
  c_flag_cadence_cv    constant real := 0.05;  -- near-zero = machine timing
  c_flag_new_account_h constant integer := 24;

  v_user_id     uuid := auth.uid();
  v_location    locations%rowtype;
  v_trek        treks%rowtype;
  v_radius_m    integer;
  v_dwell_count integer;
  v_dwell_span  integer;
  v_mocked      integer;
  v_points      integer;
  v_max_speed   real;
  v_coverage    real;
  v_straight    real;
  v_clipping    real;
  v_alt_spread  real;
  v_cadence     real;
  v_alt         real;
  v_alt_delta   real;
  v_age_days    integer;
  v_recent      integer;
  v_flags       text[] := '{}';
  v_number      integer;
  v_claim_id    uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_location from locations where id = p_location_id for update;
  if not found then
    raise exception 'unknown location' using errcode = 'P0002';
  end if;

  if v_location.status <> 'open' then
    raise exception 'location is closed: %', coalesce(v_location.status_note, v_location.status)
      using errcode = 'P0001';
  end if;

  if exists (select 1 from claims where user_id = v_user_id and location_id = p_location_id) then
    raise exception 'you have already claimed %', v_location.name using errcode = 'P0001';
  end if;

  select * into v_trek from treks where id = p_trek_id and user_id = v_user_id;
  if not found then
    raise exception 'trek does not belong to caller' using errcode = '42501';
  end if;

  if v_location.is_secret and p_photo_path is null then
    raise exception 'secret spots require a photo' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
  from claims where user_id = v_user_id and claimed_at > now() - interval '1 hour';

  if v_recent >= c_max_claims_per_hour then
    raise exception 'too many claims in the last hour, try again shortly'
      using errcode = 'P0001';
  end if;

  -- --- hard checks ----------------------------------------------------------

  select count(*) into v_points from trek_points where trek_id = p_trek_id;
  if v_points < c_min_track_points then
    raise exception 'track too short to be a trek' using errcode = 'P0001';
  end if;

  select count(*) into v_mocked from trek_points where trek_id = p_trek_id and is_mocked;
  if v_mocked > 0 then
    raise exception 'mocked location reported' using errcode = 'P0001';
  end if;

  select max(speed) into v_max_speed
  from (
    select st_distance(geom, lag(geom) over w)
           / nullif(extract(epoch from recorded_at - lag(recorded_at) over w), 0) as speed
    from trek_points where trek_id = p_trek_id
    window w as (order by recorded_at)
  ) legs;

  if v_max_speed > c_max_speed_mps then
    raise exception 'implausible speed on track' using errcode = 'P0001';
  end if;

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

  -- --- soft signals ---------------------------------------------------------

  v_coverage   := track_trail_coverage(p_trek_id, p_location_id);
  v_straight   := track_straightness(p_trek_id, p_location_id);
  v_clipping   := track_clipping(p_trek_id, p_location_id);
  v_alt_spread := track_altitude_spread(p_trek_id);
  v_cadence    := track_cadence_regularity(p_trek_id);

  if v_straight is not null and v_straight > c_flag_straightness then
    v_flags := v_flags || format('straight track (%s)', round(v_straight::numeric, 3));
  end if;

  if v_coverage is not null and v_coverage < c_flag_coverage then
    v_flags := v_flags || format('low trail coverage (%s)', round(v_coverage::numeric, 3));
  end if;

  if v_clipping is not null and v_clipping > c_flag_clipping then
    v_flags := v_flags || format('crosses buildings or water off-path (%s)', round(v_clipping::numeric, 3));
  end if;

  -- Exactly zero spread means a constant altitude was reported for every fix,
  -- which a real GPS never produces. Nulls mean the device reported none.
  if v_alt_spread is not null and v_alt_spread = 0 then
    v_flags := v_flags || 'altitude identical on every fix'::text;
  end if;

  if v_cadence is not null and v_cadence < c_flag_cadence_cv then
    v_flags := v_flags || format('machine-regular fix timing (cv %s)', round(v_cadence::numeric, 4));
  end if;

  if v_trek.device_integrity in ('rooted', 'emulator') then
    v_flags := v_flags || ('device reports ' || v_trek.device_integrity)::text;
  end if;

  -- A day-old account taking a legendary is not proof of anything, and plenty
  -- of real people join for a specific place. Worth a look, never a refusal.
  select extract(day from now() - u.created_at)::integer into v_age_days
  from auth.users u where u.id = v_user_id;

  if v_location.rarity in ('epic', 'legendary')
     and exists (
       select 1 from auth.users u
       where u.id = v_user_id and u.created_at > now() - make_interval(hours => c_flag_new_account_h)
     ) then
    v_flags := v_flags || format('account under %sh old claiming %s', c_flag_new_account_h, v_location.rarity);
  end if;

  -- --- allocation -----------------------------------------------------------

  if v_location.pioneer_taken < v_location.pioneer_cap then
    update locations set pioneer_taken = pioneer_taken + 1
     where id = p_location_id returning pioneer_taken into v_number;
  else
    v_number := null;
  end if;

  insert into claims (user_id, location_id, trek_id, pioneer_number, photo_path)
  values (v_user_id, p_location_id, p_trek_id, v_number, p_photo_path)
  returning id into v_claim_id;

  insert into claim_signals (
    claim_id, trail_coverage, straightness, max_speed_mps, point_count,
    altitude_delta, clipping, altitude_spread, cadence_cv,
    device_integrity, account_age_days, flagged, flag_reason
  )
  values (
    v_claim_id, v_coverage, v_straight, v_max_speed, v_points,
    v_alt_delta, v_clipping, v_alt_spread, v_cadence,
    v_trek.device_integrity, v_age_days,
    array_length(v_flags, 1) is not null,
    array_to_string(v_flags, '; ')
  );

  return query
  select v_claim_id, v_number,
         case when v_number is null then 'explorer' else 'pioneer' end;
end;
$$;

revoke all on function claim_location(uuid, uuid, text) from public;
grant execute on function claim_location(uuid, uuid, text) to authenticated;

commit;
