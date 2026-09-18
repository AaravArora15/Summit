-- 0018: measure pace over a sustained window, not between consecutive fixes.
--
-- The per-leg check in 0001 compared each fix only against the one before it.
-- At the recorder's 2-second cadence, GPS jitter of +-16 m between two
-- consecutive fixes reads as ~15 m/s for anyone standing still or jogging,
-- and honest treks were refused as "implausible speed on track" (observed on
-- a real 1 km / 5:30 jog).
--
-- This version measures each fix against the most recent fix at least
-- c_speed_window_s older. Over five seconds the noise averages out while a
-- genuine teleport or drive still shows through: 15 m/s of driving puts the
-- points 75+ m apart no matter how you slice the window.

CREATE OR REPLACE FUNCTION public.claim_location(p_location_id uuid, p_trek_id uuid, p_photo_path text DEFAULT NULL::text)
 RETURNS TABLE(claim_id uuid, pioneer_number integer, edition text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  c_default_radius_m   constant integer := 90;
  c_dwell_seconds      constant integer := 45;
  c_min_dwell_points   constant integer := 3;
  c_max_accuracy_m     constant real    := 60;
  c_max_speed_mps      constant real    := 6.0;
  -- Speed is judged over windows at least this long. Shorter baselines mostly
  -- measure position noise, not movement (see the header comment).
  c_speed_window_s     constant integer := 5;
  c_min_track_points   constant integer := 10;
  c_alt_below_dem_m    constant real    := 60;
  c_alt_above_dem_m    constant real    := 45;

  c_max_claims_per_hour constant integer := 5;

  c_flag_straightness  constant real := 0.80;
  c_flag_coverage      constant real := 0.50;
  c_flag_clipping      constant real := 0.10;
  c_flag_cadence_cv    constant real := 0.05;
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

  select count(*) into v_points from trek_points where trek_id = p_trek_id;
  if v_points < c_min_track_points then
    raise exception 'track too short to be a trek' using errcode = 'P0001';
  end if;

  select count(*) into v_mocked from trek_points where trek_id = p_trek_id and is_mocked;
  if v_mocked > 0 then
    raise exception 'mocked location reported' using errcode = 'P0001';
  end if;

  -- Sustained speed. For every fix, compare it against the newest fix that is
  -- at least c_speed_window_s older, so every measurement spans long enough
  -- for receiver noise to cancel. Fixes with no such predecessor contribute
  -- nothing (null), which also leaves very short tracks unjudged here -- the
  -- point-count gate above already refuses those.
  select max(speed) into v_max_speed
  from (
    select st_distance(p.geom, prev.geom)
           / nullif(extract(epoch from p.recorded_at - prev.recorded_at), 0) as speed
    from trek_points p
    cross join lateral (
      select q.geom, q.recorded_at
        from trek_points q
       where q.trek_id = p.trek_id
         and q.recorded_at <= p.recorded_at - make_interval(secs => c_speed_window_s)
       order by q.recorded_at desc
       limit 1
    ) prev
    where p.trek_id = p_trek_id
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

  if v_alt_spread is not null and v_alt_spread = 0 then
    v_flags := v_flags || 'altitude identical on every fix'::text;
  end if;

  if v_cadence is not null and v_cadence < c_flag_cadence_cv then
    v_flags := v_flags || format('machine-regular fix timing (cv %s)', round(v_cadence::numeric, 4));
  end if;

  if v_trek.device_integrity in ('rooted', 'emulator') then
    v_flags := v_flags || ('device reports ' || v_trek.device_integrity)::text;
  end if;

  select extract(day from now() - u.created_at)::integer into v_age_days
  from auth.users u where u.id = v_user_id;

  if v_location.rarity in ('epic', 'legendary')
     and exists (
       select 1 from auth.users u
       where u.id = v_user_id and u.created_at > now() - make_interval(hours => c_flag_new_account_h)
     ) then
    v_flags := v_flags || format('account under %sh old claiming %s', c_flag_new_account_h, v_location.rarity);
  end if;

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

  -- The one addition over 0003's version: a claim is proof enough that this
  -- trek was real, so it is what finally sets the status the league counter
  -- and the personal-best comparison above have been waiting on.
  update treks set status = 'validated' where id = p_trek_id and status <> 'validated';

  return query
  select v_claim_id, v_number,
         case when v_number is null then 'explorer' else 'pioneer' end;
end;
$function$;
