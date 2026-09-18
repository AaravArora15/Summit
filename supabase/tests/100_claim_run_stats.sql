-- The walk behind one held badge (0023): claim_run_stats() must hand back a
-- real trek's own distance/time when there is a genuine one, hide them
-- (fall through to the location_* estimate columns) for both a
-- dev-fake-claim.ts-style trek and a claim with no trek at all, and refuse
-- to hand back another user's claim.
--
-- Same shape as 80_claim_points_breakdown.sql: real claims via
-- claim_location(), not the make_trek/make_user fixtures. Runs inside a
-- transaction that rolls back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_user       uuid;
  v_other      uuid;
  v_loc1       locations%rowtype;
  v_loc2       locations%rowtype;
  v_loc3       locations%rowtype;
  v_trek1      uuid;
  v_trek2      uuid;
  v_claim1     record;
  v_claim2     record;
  v_claim3     uuid;
  v_stats      record;
  v_other_rows integer;
  i            integer;
begin
  select * into v_loc1 from locations
  where status = 'open' and not is_secret and set_id is not null
  order by elevation_m limit 1;

  select * into v_loc2 from locations
  where status = 'open' and not is_secret and set_id is not null and id <> v_loc1.id
  order by elevation_m offset 1 limit 1;

  select * into v_loc3 from locations
  where status = 'open' and not is_secret and set_id is not null and id not in (v_loc1.id, v_loc2.id)
  order by elevation_m offset 2 limit 1;

  select id into v_user  from profiles order by explorer_number limit 1;
  select id into v_other from profiles where id <> v_user order by explorer_number limit 1;

  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- Case 1: a genuine walk. claim_run_stats() should hand its own numbers
  -- straight through.
  insert into treks (user_id, started_at, ended_at, distance_m, moving_time_s, status)
  values (v_user, now() - interval '70 minutes', now(), 6200, 3600, 'submitted')
  returning id into v_trek1;

  for i in 0..11 loop
    insert into trek_points (trek_id, geom, recorded_at, accuracy_m, is_mocked, altitude_m)
    values (
      v_trek1,
      st_translate(v_loc1.geom::geometry, (i % 3) * 0.00008, (i % 4) * 0.00008)::geography,
      now() - make_interval(secs => (11 - i) * 10),
      12, false, v_loc1.elevation_m
    );
  end loop;

  select * into v_claim1 from claim_location(v_loc1.id, v_trek1) limit 1;

  -- Case 2: a dev-fake-claim.ts-style shortcut — a real, validated trek row,
  -- just flagged as not a real walk.
  insert into treks (user_id, started_at, ended_at, distance_m, moving_time_s, status, is_dev_fake)
  values (v_user, now() - interval '55 seconds', now(), 120, 55, 'submitted', true)
  returning id into v_trek2;

  for i in 0..11 loop
    insert into trek_points (trek_id, geom, recorded_at, accuracy_m, is_mocked, altitude_m)
    values (
      v_trek2,
      st_translate(v_loc2.geom::geometry, (i % 2) * 0.00001, (i % 2) * 0.00001)::geography,
      now() - make_interval(secs => (11 - i) * 5),
      8, false, v_loc2.elevation_m
    );
  end loop;

  select * into v_claim2 from claim_location(v_loc2.id, v_trek2) limit 1;

  -- Case 3: a claim with no trek behind it at all (trek_id null) — inserted
  -- directly, since claim_location() always requires one.
  insert into claims (user_id, location_id, trek_id, claimed_at)
  values (v_user, v_loc3.id, null, now())
  returning id into v_claim3;

  -- Case 1 assertions: real numbers pass straight through.
  select * into v_stats from claim_run_stats(v_claim1.claim_id);
  if v_stats.distance_m = 6200 and v_stats.moving_time_s = 3600 then
    raise notice 'ok   a real trek''s own distance/time pass through unchanged';
  else
    raise notice 'FAIL real claim returned distance_m=% moving_time_s=% (expected 6200/3600)',
      v_stats.distance_m, v_stats.moving_time_s;
  end if;

  if v_stats.difficulty = v_loc1.difficulty then
    raise notice 'ok   location difficulty is returned alongside the real numbers';
  else
    raise notice 'FAIL location difficulty missing or wrong for the real claim';
  end if;

  -- Case 2 assertions: dev-fake numbers are hidden, location columns present.
  select * into v_stats from claim_run_stats(v_claim2.claim_id);
  if v_stats.distance_m is null and v_stats.moving_time_s is null then
    raise notice 'ok   a dev-fake-claim.ts trek''s 120m/55s never surfaces as a real number';
  else
    raise notice 'FAIL dev-fake trek leaked distance_m=% moving_time_s=%', v_stats.distance_m, v_stats.moving_time_s;
  end if;

  if v_stats.location_distance_m is not distinct from v_loc2.distance_m
     and v_stats.difficulty = v_loc2.difficulty then
    raise notice 'ok   the location''s own distance/difficulty are still there to estimate from';
  else
    raise notice 'FAIL location estimate columns missing for the dev-fake claim';
  end if;

  -- Case 3 assertions: no trek at all behaves the same as a dev-fake one.
  select * into v_stats from claim_run_stats(v_claim3);
  if v_stats.distance_m is null and v_stats.moving_time_s is null and v_stats.difficulty = v_loc3.difficulty then
    raise notice 'ok   a claim with no trek at all also falls through to the location estimate';
  else
    raise notice 'FAIL trekless claim did not fall through correctly';
  end if;

  -- Ownership: a different signed-in user asking for claim 1's stats gets nothing.
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  select count(*) into v_other_rows from claim_run_stats(v_claim1.claim_id);
  if v_other_rows <> 0 then
    raise notice 'FAIL another user could read this claim''s run stats';
  else
    raise notice 'ok   another user gets nothing for someone else''s claim_id';
  end if;
end $$;

rollback;
