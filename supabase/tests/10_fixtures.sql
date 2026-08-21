-- Test fixtures. Not part of the migration set.

-- PostGIS lives in the `extensions` schema, matching Supabase. Without this the
-- plpgsql `declare v_trail geometry` below cannot resolve the type.
set search_path = public, extensions;

-- Drop every prior overload by name before redefining. `create or replace`
-- only replaces an identical signature, so adding a parameter leaves the old
-- version in place and every call then fails as ambiguous rather than as
-- obviously stale, which is a confusing way to lose ten minutes.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure::text as sig
    from pg_proc
    where proname in ('make_trek', 'make_user')
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

-- A synthetic but realistic trek: walk in along the nearest real OSM trail,
-- then stand at the location long enough to satisfy the dwell test.
--
-- Timestamps are derived from the ACTUAL distance between consecutive fixes,
-- not from a fixed step. An earlier version assumed a 600 m approach and spaced
-- fixes evenly in time, which meant that wherever the nearest trail happened to
-- be kilometres long, the fixture walked it at 20 m/s and every claim was
-- rejected for implausible speed. The fixture has to be plausible before it can
-- test anything else.
create or replace function make_trek(
  p_user_id     uuid,
  p_location_id uuid,
  p_realistic   boolean default true,   -- false = straight line, the spoof shape
  p_altitude    real    default null,   -- null = use the location's DEM value
  p_speed_mps   real    default 1.3,    -- normal walking pace
  -- Real GPS altitude jitters by a few metres on every fix. Constant altitude
  -- is a spoofing tell, so the fixture has to be able to produce both.
  p_flat_altitude boolean default false
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  c_approach_m constant real := 600;
  v_loc     locations%rowtype;
  v_trail   geometry;
  v_trek_id uuid;
  v_t       timestamptz := now() - interval '3 hours';
  v_alt     real;
  v_frac    double precision;
  v_span    double precision;
  v_from    double precision;
  v_to      double precision;
  v_len     double precision;
  i         int;
  v_pt      geometry;
  v_prev    geometry;
  v_gap     double precision;
  v_bridge_m double precision;
begin
  select * into v_loc from locations where id = p_location_id;
  v_alt := coalesce(p_altitude, v_loc.elevation_m, 20);

  insert into treks (user_id, started_at, ended_at, distance_m, moving_time_s, status)
  values (p_user_id, v_t, v_t + interval '75 minutes', 2500, 4200, 'submitted')
  returning id into v_trek_id;

  if p_realistic then
    select t.geom::geometry into v_trail
    from trails t order by t.geom <-> v_loc.geom limit 1;
  end if;

  if v_trail is not null then
    -- Walk the stretch of trail that ends nearest the location, not the whole
    -- way, so the approach is about c_approach_m long wherever it runs.
    --
    -- If the location sits near the START of the way there is no room to walk
    -- backwards, so the window slides forward instead. An earlier version just
    -- took least(v_frac, ...), which silently produced a 10 m approach whenever
    -- v_frac was small. That is how the driving-pace test stopped testing
    -- anything: over 10 m the per-leg time floor dominated and the requested
    -- speed never took effect.
    v_len  := greatest(st_length(v_trail::geography), 1);
    v_frac := st_linelocatepoint(v_trail, v_loc.geom::geometry);
    v_span := least(c_approach_m / v_len, 1.0);

    if v_frac >= v_span then
      v_from := v_frac - v_span;
      v_to   := v_frac;
    else
      v_from := 0;
      v_to   := v_span;
    end if;
  end if;

  v_prev := null;

  for i in 0..24 loop
    if v_trail is not null then
      v_pt := st_lineinterpolatepoint(v_trail, v_from + ((v_to - v_from) * i / 24.0));
    else
      -- The spoof shape: a straight line from 600 m out, ignoring the ground.
      v_pt := st_lineinterpolatepoint(
        st_makeline(st_project(v_loc.geom, c_approach_m, radians(200))::geometry,
                    v_loc.geom::geometry),
        i / 24.0);
    end if;

    -- Advance the clock by however long that leg would actually take at the
    -- requested pace. The floor is an epsilon, not a second: a one-second floor
    -- caps the achievable speed at (leg length) m/s, which quietly defeats any
    -- test that asks for a fast one.
    if v_prev is not null then
      v_gap := st_distance(v_prev::geography, v_pt::geography) / nullif(p_speed_mps, 0);
      v_t := v_t + (greatest(v_gap, 0.001) || ' seconds')::interval;
    end if;

    insert into trek_points (trek_id, geom, recorded_at, accuracy_m, altitude_m)
    values (v_trek_id, v_pt::geography, v_t, 8,
            case when p_flat_altitude then v_alt
                 else v_alt + (random() - 0.5) * 6 end);

    v_prev := v_pt;
  end loop;

  -- Bridge from wherever the trail ended to the location itself.
  --
  -- The nearest mapped way does not necessarily pass the place: at Bukit Timah
  -- it runs over the summit, at Gangsa Hill it stops a few hundred metres
  -- short. Without this the fixture jumped that gap in one ten-second step,
  -- which is 20 m/s, and every claim there was refused for implausible speed.
  -- The fixture was teleporting, not the test subject.
  if v_prev is not null then
    v_bridge_m := st_distance(v_prev::geography, v_loc.geom);
    if v_bridge_m > 15 then
      for i in 1..10 loop
        v_pt := st_lineinterpolatepoint(
                  st_makeline(v_prev, v_loc.geom::geometry), i / 10.0);
        v_t := v_t + ((v_bridge_m / 10.0 / nullif(p_speed_mps, 0)) || ' seconds')::interval;
        insert into trek_points (trek_id, geom, recorded_at, accuracy_m, altitude_m)
        values (v_trek_id, v_pt::geography, v_t, 8,
                case when p_flat_altitude then v_alt else v_alt + (random() - 0.5) * 6 end);
      end loop;
    end if;
  end if;

  -- Dwell: 10 fixes over 90 s, scattered inside a 15 m circle, like a real
  -- person standing still with GPS noise.
  for i in 0..9 loop
    v_t := v_t + interval '10 seconds';
    insert into trek_points (trek_id, geom, recorded_at, accuracy_m, altitude_m)
    values (v_trek_id,
            st_project(v_loc.geom, (i % 4) * 5, radians(i * 37))::geography,
            v_t, 9,
            case when p_flat_altitude then v_alt
                 else v_alt + (random() - 0.5) * 6 end);
  end loop;

  return v_trek_id;
end;
$$;

create or replace function make_user(p_email text)
returns uuid language plpgsql
set search_path = public, extensions
as $$
declare v_id uuid := gen_random_uuid();
begin
  -- The id is supplied explicitly rather than left to a column default,
  -- because Supabase's real auth.users has no default on it. GoTrue always
  -- generates the uuid itself. A local stub that defaults the column hides
  -- that and the fixture then fails only in production.
  insert into auth.users (id, email) values (v_id, p_email);
  return v_id;
end; $$;
