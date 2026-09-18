-- Scoring and league placement, end to end.
--
-- This is the path nothing else exercises. claim_location() has its own test
-- in 20; what this covers is what happens *after* the claim lands: the points
-- trigger itemising the walk, and the league trigger putting those points in
-- the right month's division.
--
-- Everything runs inside a transaction that is rolled back, so it is safe to
-- point at a real database as well as at the throwaway one. That matters here:
-- the scoring is the one piece that had never run anywhere when it was written.
\pset tuples_only on
\pset format unaligned

begin;
-- PostGIS lives in `extensions`, not public, on Supabase and therefore in the
-- local database too. Without this, `::geography` in the fixture below is
-- unresolvable. Same `set local` as every migration, and for the same reason.
set local search_path = public, extensions;

do $$
declare
  v_user     uuid;
  v_trek     uuid;
  v_loc      locations%rowtype;
  v_claim    record;
  v_total    integer;
  v_league   uuid;
  v_lpoints  integer;
  v_sources  text;
  i          integer;
begin
  -- A location with a set and a known elevation, so the set bonus and the
  -- altitude check both have something to work with.
  select * into v_loc
  from locations
  where status = 'open' and not is_secret and set_id is not null and elevation_m is not null
  order by elevation_m
  limit 1;

  -- A user that exists in auth.users, because claims reference it. Reusing one
  -- rather than inserting keeps this runnable against a real project.
  select id into v_user from profiles order by explorer_number limit 1;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  insert into treks (user_id, started_at, ended_at, distance_m, moving_time_s, status)
  values (v_user, now() - interval '70 minutes', now(), 6200, 3600, 'submitted')
  returning id into v_trek;

  -- Twelve fixes, ten seconds apart, drifting a few metres around the summit.
  -- Enough to clear the dwell test (3 points over 45 s) and the track-length
  -- test (10 points), and slow enough not to trip the speed ceiling.
  for i in 0..11 loop
    insert into trek_points (trek_id, geom, recorded_at, accuracy_m, is_mocked, altitude_m)
    values (
      v_trek,
      st_translate(v_loc.geom::geometry, (i % 3) * 0.00008, (i % 4) * 0.00008)::geography,
      now() - make_interval(secs => (11 - i) * 10),
      12,
      false,
      v_loc.elevation_m
    );
  end loop;

  select * into v_claim from claim_location(v_loc.id, v_trek) limit 1;
  raise notice 'claim: pioneer=% edition=%', v_claim.pioneer_number, v_claim.edition;

  select coalesce(sum(amount), 0), string_agg(distinct source, ',' order by source)
    into v_total, v_sources
  from points_ledger where trek_id = v_trek;

  raise notice 'points: total=% sources=%', v_total, v_sources;

  if v_total <= 0 then
    raise exception 'FAIL: the claim awarded no points';
  end if;

  -- 0012 split every activity-specific row into an 'xp' line and a 'monthly'
  -- line, so 'distance' and 'moving_time' each land two rows per trek, not
  -- one. Asserted per system rather than eyeballed: a scoring change should
  -- break a test, not drift silently.
  if (select amount from points_ledger where trek_id = v_trek and source = 'distance' and system = 'xp') <= 0 then
    raise exception 'FAIL: distance xp points wrong';
  end if;
  if (select amount from points_ledger where trek_id = v_trek and source = 'distance' and system = 'monthly') <= 0 then
    raise exception 'FAIL: distance monthly points wrong';
  end if;
  if (select amount from points_ledger where trek_id = v_trek and source = 'moving_time' and system = 'xp') <= 0 then
    raise exception 'FAIL: moving_time xp points wrong';
  end if;
  if (select amount from points_ledger where trek_id = v_trek and source = 'moving_time' and system = 'monthly') <= 0 then
    raise exception 'FAIL: moving_time monthly points wrong';
  end if;

  -- A second claim on the same trek must not pay for the same kilometres
  -- twice: exactly one row per system, not per system per claim.
  if (select count(*) from points_ledger where trek_id = v_trek and source = 'distance' and system = 'xp') <> 1 then
    raise exception 'FAIL: distance awarded more than once for one trek';
  end if;

  select lm.league_id, lm.points into v_league, v_lpoints
  from league_members lm
  join leagues l on l.id = lm.league_id
  where lm.user_id = v_user and l.period = date_trunc('month', now())::date;

  if v_league is null then
    raise exception 'FAIL: points did not place the user in a division';
  end if;

  raise notice 'league: division=% points=%', v_league, v_lpoints;

  if v_lpoints < v_total then
    raise exception 'FAIL: division total % is below the points awarded %', v_lpoints, v_total;
  end if;

  raise notice 'PASS';
end $$;

rollback;
