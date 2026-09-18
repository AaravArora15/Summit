-- Wildcard (0024): my_wildcard() must lazily assign one open, non-secret
-- location per user per day and keep returning the same one on later calls
-- the same day, withholding name/slug/set until claimed; reroll_wildcard()
-- must swap it exactly once and refuse a second reroll or a reroll after
-- it's claimed; wildcard_bearing() must hand back a live distance/bearing
-- toward the hidden pick without ever revealing it, and stop answering once
-- it's claimed; claiming the picked location must pay the flat wildcard
-- bonus, flip `claimed`, and reveal the name; claiming anything else must
-- not.
--
-- No separate "can't read someone else's" check here, unlike
-- claim_points_breakdown()/claim_run_stats(): none of these three RPCs take
-- a caller-supplied id to attack with — all three always resolve through
-- auth.uid() only.
--
-- Real claims via make_trek()/claim_location(), same fixtures the "what
-- gets refused" section already uses. Runs inside a transaction that rolls
-- back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_user        uuid;
  v_user2       uuid;
  v_user3       uuid;
  v_w1          record;
  v_w1_again    record;
  v_w2          record;
  v_reroll_err  text;
  v_loc         locations%rowtype;
  v_other_loc   uuid;
  v_trek        uuid;
  v_claim       record;
  v_xp          integer;
  v_mo          integer;
  v_bearing     record;
begin
  v_user  := make_user('wildcard-a-' || floor(random() * 1e6)::text || '@t');
  v_user2 := make_user('wildcard-b-' || floor(random() * 1e6)::text || '@t');
  v_user3 := make_user('wildcard-c-' || floor(random() * 1e6)::text || '@t');

  -- Case 1: first call assigns a pick.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select * into v_w1 from my_wildcard();

  if v_w1.wildcard_id is null then
    raise notice 'FAIL my_wildcard() assigned nothing (ran out of open locations?)';
  else
    raise notice 'ok   first call assigns a pick (location_id %)', v_w1.location_id;
  end if;

  if not v_w1.rerolled and not v_w1.claimed then
    raise notice 'ok   a fresh pick starts un-rerolled and unclaimed';
  else
    raise notice 'FAIL fresh pick has rerolled=% claimed=%', v_w1.rerolled, v_w1.claimed;
  end if;

  if v_w1.name is null and v_w1.slug is null and v_w1.set_key is null and v_w1.set_name is null then
    raise notice 'ok   the pick''s name/slug/set stay hidden before it''s claimed';
  else
    raise notice 'FAIL an unclaimed pick leaked name=% slug=% set_key=%', v_w1.name, v_w1.slug, v_w1.set_key;
  end if;

  if v_w1.expires_at = v_w1.assigned_at + interval '24 hours' then
    raise notice 'ok   the claim window is exactly 24 hours from assignment';
  else
    raise notice 'FAIL expires_at does not match assigned_at + 24h';
  end if;

  select * into v_loc from locations where id = v_w1.location_id;
  if v_loc.status = 'open' and not v_loc.is_secret then
    raise notice 'ok   the pick is always an open, non-secret location';
  else
    raise notice 'FAIL picked a status=% is_secret=% location', v_loc.status, v_loc.is_secret;
  end if;

  -- wildcard_bearing(): standing exactly 1000m due east of the real (hidden)
  -- pin, the reported bearing back to it must read ~west (270°) and the
  -- distance must read ~1000m — computed server-side against the true
  -- geometry, which this call never receives.
  select * into v_bearing from wildcard_bearing(
    st_y(st_project(v_loc.geom, 1000, radians(90))::geometry),
    st_x(st_project(v_loc.geom, 1000, radians(90))::geometry)
  );
  if v_bearing.distance_m between 990 and 1010 then
    raise notice 'ok   wildcard_bearing() reports the right live distance (~%m)', round(v_bearing.distance_m);
  else
    raise notice 'FAIL wildcard_bearing() distance was % (expected ~1000)', v_bearing.distance_m;
  end if;
  if v_bearing.bearing_deg between 265 and 275 then
    raise notice 'ok   wildcard_bearing() reports the right live direction (~270°, west)';
  else
    raise notice 'FAIL wildcard_bearing() bearing was % (expected ~270)', v_bearing.bearing_deg;
  end if;

  -- Case 2: same day, same pick — idempotent, not reassigned every call.
  select * into v_w1_again from my_wildcard();
  if v_w1_again.wildcard_id = v_w1.wildcard_id and v_w1_again.location_id = v_w1.location_id then
    raise notice 'ok   asking again the same day returns the same pick';
  else
    raise notice 'FAIL a second call the same day picked a different one';
  end if;

  -- Case 3: reroll swaps the location and flips rerolled.
  perform reroll_wildcard();
  select * into v_w1 from my_wildcard();
  if v_w1.rerolled and v_w1.location_id <> v_w1_again.location_id then
    raise notice 'ok   reroll swaps to a different location and flips rerolled';
  else
    raise notice 'FAIL reroll did not change location_id or set rerolled';
  end if;

  -- Case 4: a second reroll the same day is refused.
  begin
    perform reroll_wildcard();
    v_reroll_err := null;
  exception when others then
    v_reroll_err := sqlerrm;
  end;
  if v_reroll_err = 'already rerolled today''s wildcard' then
    raise notice 'ok   a second reroll the same day is refused';
  else
    raise notice 'FAIL second reroll gave % instead of the expected refusal', coalesce(v_reroll_err, 'no error');
  end if;

  -- Case 5: claiming the picked location pays the wildcard bonus and marks
  -- it claimed.
  select * into v_loc from locations where id = v_w1.location_id;
  v_trek := make_trek(v_user, v_loc.id);
  select * into v_claim from claim_location(v_loc.id, v_trek) limit 1;

  select coalesce(sum(amount), 0) into v_xp
    from points_ledger where claim_id = v_claim.claim_id and source = 'wildcard' and system = 'xp';
  select coalesce(sum(amount), 0) into v_mo
    from points_ledger where claim_id = v_claim.claim_id and source = 'wildcard' and system = 'monthly';

  if v_xp = 50 and v_mo = 100 then
    raise notice 'ok   claiming today''s pick pays the wildcard bonus (50 xp / 100 monthly)';
  else
    raise notice 'FAIL wildcard bonus paid xp=% monthly=% (expected 50/100)', v_xp, v_mo;
  end if;

  select * into v_w1 from my_wildcard();
  if v_w1.claimed then
    raise notice 'ok   my_wildcard() reports claimed once the matching claim lands';
  else
    raise notice 'FAIL my_wildcard() still reports unclaimed after the claim landed';
  end if;

  if v_w1.name = v_loc.name and v_w1.slug = v_loc.slug then
    raise notice 'ok   the reveal shows the real name/slug once claimed (%)', v_w1.name;
  else
    raise notice 'FAIL claimed pick did not reveal name=% slug=% (expected % / %)',
      v_w1.name, v_w1.slug, v_loc.name, v_loc.slug;
  end if;

  if not exists (
    select 1 from wildcard_bearing(st_y(v_loc.geom::geometry), st_x(v_loc.geom::geometry))
  ) then
    raise notice 'ok   wildcard_bearing() has nothing left to say once claimed';
  else
    raise notice 'FAIL wildcard_bearing() still answered after the pick was claimed';
  end if;

  -- Case 6: a reroll after it's claimed is refused. A fresh user
  -- (v_user3) that never rerolls, so this hits the "already claimed" branch
  -- rather than v_user's own already-established "already rerolled" one.
  perform set_config('request.jwt.claim.sub', v_user3::text, true);
  select * into v_w1 from my_wildcard();
  v_trek := make_trek(v_user3, v_w1.location_id);
  perform claim_location(v_w1.location_id, v_trek);

  begin
    perform reroll_wildcard();
    v_reroll_err := null;
  exception when others then
    v_reroll_err := sqlerrm;
  end;
  if v_reroll_err = 'today''s wildcard is already claimed' then
    raise notice 'ok   rerolling an already-claimed wildcard is refused';
  else
    raise notice 'FAIL post-claim reroll gave % instead of the expected refusal', coalesce(v_reroll_err, 'no error');
  end if;

  -- Case 7: claiming a location that is *not* today's pick pays no bonus.
  perform set_config('request.jwt.claim.sub', v_user2::text, true);
  select * into v_w2 from my_wildcard();

  select l.id into v_other_loc
  from locations l
  where l.status = 'open' and not l.is_secret and l.id <> v_w2.location_id
    and not exists (select 1 from claims c where c.user_id = v_user2 and c.location_id = l.id)
  limit 1;

  v_trek := make_trek(v_user2, v_other_loc);
  select * into v_claim from claim_location(v_other_loc, v_trek) limit 1;

  select coalesce(sum(amount), 0) into v_xp
    from points_ledger where claim_id = v_claim.claim_id and source = 'wildcard';

  select * into v_w2 from my_wildcard();
  if v_xp = 0 and not v_w2.claimed then
    raise notice 'ok   claiming somewhere else pays no wildcard bonus and leaves the pick unclaimed';
  else
    raise notice 'FAIL claiming a different location paid a wildcard bonus or marked it claimed';
  end if;
end $$;

rollback;
