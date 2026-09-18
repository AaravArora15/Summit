-- Per-set titles, the 400-point set-complete XP payout, and suggestion
-- review — all from 0022.
--
-- Two synthetic locations in one throwaway set (not a real seeded set: a
-- real one has far too many locations to fully claim in a test), offset a
-- little from the real 'everestbasecamptrek' fixture location so
-- make_trek()'s nearest-trail lookup still finds a genuinely close trail —
-- same reason 30_points_and_league.sql anchors on a real seeded location
-- rather than an arbitrary point.
--
-- Same harness as 30/40/50/60/70/80: identity switched through
-- request.jwt.claim.sub, everything inside a transaction that rolls back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_anchor        locations%rowtype;
  v_user          uuid;
  v_admin         uuid;
  v_other         uuid;
  v_city          uuid;
  v_set           uuid;
  v_loc1          uuid;
  v_loc2          uuid;
  v_trek1         uuid;
  v_trek2         uuid;
  v_claim1        record;
  v_claim2        record;
  v_title         text;
  v_is_admin      boolean;
  v_amount        integer;
  v_suggestion    uuid;
  v_pending_count integer;
  v_new_loc       uuid;
  v_rand          text := floor(random() * 1e6)::text;
begin
  select * into v_anchor from locations where slug = 'everestbasecamptrek';
  v_city := v_anchor.city_id;

  select id into v_user  from profiles order by explorer_number limit 1;
  select id into v_admin from profiles where id <> v_user order by explorer_number limit 1;
  select id into v_other from profiles where id not in (v_user, v_admin) order by explorer_number limit 1;

  insert into location_sets (city_id, key, name, colour)
  values (v_city, 'test-titles-' || v_rand, 'Ridgeline', '#335544')
  returning id into v_set;

  insert into locations (city_id, set_id, slug, name, geom, rarity, difficulty, status)
  values (v_city, v_set, 'titletestloc1' || v_rand, 'Test Loc One',
          st_project(v_anchor.geom, 40, radians(10)), 'common', 1, 'open')
  returning id into v_loc1;
  insert into locations (city_id, set_id, slug, name, geom, rarity, difficulty, status)
  values (v_city, v_set, 'titletestloc2' || v_rand, 'Test Loc Two',
          st_project(v_anchor.geom, 40, radians(190)), 'common', 1, 'open')
  returning id into v_loc2;

  perform set_config('request.jwt.claim.sub', v_user::text, true);

  select make_trek(v_user, v_loc1) into v_trek1;
  select * into v_claim1 from claim_location(v_loc1, v_trek1) limit 1;

  select make_trek(v_user, v_loc2) into v_trek2;
  select * into v_claim2 from claim_location(v_loc2, v_trek2) limit 1;

  -------------------------------------------------------------------- points

  select amount into v_amount
    from points_ledger
   where claim_id = v_claim2.claim_id and source = 'set_complete' and system = 'xp';
  if v_amount = 400 then
    raise notice 'ok   set_complete pays 400 xp';
  else
    raise notice 'FAIL set_complete xp amount is % (expected 400)', v_amount;
  end if;

  select amount into v_amount
    from points_ledger
   where claim_id = v_claim2.claim_id and source = 'set_complete' and system = 'monthly';
  if v_amount = 80 then
    raise notice 'ok   set_complete monthly stays at 80';
  else
    raise notice 'FAIL set_complete monthly amount is % (expected 80)', v_amount;
  end if;

  -------------------------------------------------------------------- title

  select title, is_admin into v_title, v_is_admin from my_profile();
  if v_title = 'Ridgeline Keeper' then
    raise notice 'ok   my_profile() derives the per-set title';
  else
    raise notice 'FAIL my_profile() title is % (expected "Ridgeline Keeper")', v_title;
  end if;

  if v_is_admin is false then
    raise notice 'ok   is_admin defaults to false';
  else
    raise notice 'FAIL is_admin defaulted to %', v_is_admin;
  end if;

  -------------------------------------------------------------------- review

  perform set_config('request.jwt.claim.sub', v_other::text, true);
  select suggest_location('Hidden Overlook', 12.34, 56.78, 'great view') into v_suggestion;

  -- Non-admin: sees nothing, and both write RPCs refuse.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select count(*) into v_pending_count from pending_location_suggestions();
  if v_pending_count = 0 then
    raise notice 'ok   a non-admin sees no pending suggestions';
  else
    raise notice 'FAIL non-admin saw % pending suggestions', v_pending_count;
  end if;

  begin
    perform reject_location_suggestion(v_suggestion, 'no');
    raise notice 'FAIL a non-admin could reject a suggestion';
  exception when others then
    raise notice 'ok   a non-admin is refused (%)', sqlerrm;
  end;

  update profiles set is_admin = true where id = v_admin;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select count(*) into v_pending_count from pending_location_suggestions();
  if v_pending_count = 1 then
    raise notice 'ok   the admin sees the pending suggestion';
  else
    raise notice 'FAIL admin saw % pending suggestions (expected 1)', v_pending_count;
  end if;

  select approve_location_suggestion(
           v_suggestion, 'hiddenoverlooktest' || v_rand, null::uuid, 'rare'::rarity, 2::smallint
         )
    into v_new_loc;

  if exists (
    select 1 from locations
    where id = v_new_loc and name = 'Hidden Overlook' and rarity = 'rare' and difficulty = 2
  ) then
    raise notice 'ok   approval created a real, claimable location';
  else
    raise notice 'FAIL approved location missing or wrong';
  end if;

  if (select status from location_suggestions where id = v_suggestion) = 'approved' then
    raise notice 'ok   the suggestion is marked approved';
  else
    raise notice 'FAIL suggestion status did not update';
  end if;

  begin
    perform approve_location_suggestion(v_suggestion, 'shouldnotwork' || v_rand);
    raise notice 'FAIL approving an already-reviewed suggestion was accepted';
  exception when others then
    raise notice 'ok   re-approving an already-reviewed suggestion is refused (%)', sqlerrm;
  end;
end $$;

rollback;
