-- Speed gating: the sustained-window check in claim_location (0018).
--
-- The per-leg check this replaced refused a real jog whenever two consecutive
-- fixes were far enough apart for GPS jitter to read as a sprint. These cases
-- pin down both directions: noise that used to look like speed must now pass,
-- and genuine sustained pace must still fail.
--
-- Same harness as 40/50: identity switched through request.jwt.claim.sub,
-- everything inside a transaction that rolls back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  c_loc    uuid;
  v_user   uuid;
  v_trek   uuid;
  v_result text;
begin
  select id into c_loc from locations where slug = 'everestbasecamptrek';

  -------------------------------------------------------------------- the bug

  -- An honest walk whose clock has one compressed gap: fixes i and i+1 are
  -- two seconds apart instead of twenty. On consecutive-pair checking that
  -- single leg reads as ~12 m/s and the whole trek dies. Over a five-second
  -- window it is invisible, which is the point.
  select make_user('jitter-' || floor(random() * 1e6)::int || '@t') into v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select make_trek(v_user, c_loc) into v_trek;

  with ordered as (
    select recorded_at,
           lag(recorded_at) over (order by recorded_at) as prev_at
      from trek_points where trek_id = v_trek
  ), victim as (
    select recorded_at from ordered
     where prev_at is not null
     order by recorded_at
     offset 4 limit 1
  )
  update trek_points tp
     set recorded_at = (select prev_at + interval '2 seconds' from ordered o
                         where o.recorded_at = (select recorded_at from victim))
   where tp.trek_id = v_trek
     and tp.recorded_at = (select recorded_at from victim);

  if not exists (
    select 1 from trek_points a join trek_points b
      on b.trek_id = a.trek_id
     and b.recorded_at = (select max(recorded_at) from trek_points
                           where trek_id = a.trek_id
                             and recorded_at < a.recorded_at)
     where a.trek_id = v_trek
       and extract(epoch from a.recorded_at - b.recorded_at) between 1 and 3
       and st_distance(a.geom, b.geom) > 20
  ) then
    raise notice 'FAIL fixture did not produce a fast-looking leg';
    return;
  end if;

  v_result := try_claim(v_user, v_trek, c_loc);
  if v_result like '%implausible speed%' then
    raise notice 'FAIL honest walk with one noisy gap was refused: %', v_result;
  elsif v_result not like 'ACCEPTED%' then
    -- Not a speed refusal, but the fixture is supposed to produce a fully
    -- honest claim otherwise. Anything else means the test is broken, not
    -- lenient.
    raise notice 'FAIL noisy-gap trek failed for another reason: %', v_result;
  else
    raise notice 'ok   noisy gap no longer fatal (%)', v_result;
  end if;

  ------------------------------------------------------- sustained pace still dies

  -- make_trek spaces every leg at exactly the requested pace, so a 20 m/s
  -- track is uniformly 20 m/s: every five-second window sees it too.
  select make_user('driver-' || floor(random() * 1e6)::int || '@t') into v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select make_trek(v_user, c_loc, true, null, 20) into v_trek;

  v_result := try_claim(v_user, v_trek, c_loc);
  if v_result like '%implausible speed%' then
    raise notice 'ok   sustained 20 m/s still refused';
  else
    raise notice 'FAIL driving pace slipped through: %', v_result;
  end if;
end $$;

rollback;
