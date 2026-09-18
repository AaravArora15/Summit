-- Capture Territory (0025): create_territory() must be admin-only, refuse a
-- wrong location count, and refuse a location that's not open/public/free
-- of an existing territory; claiming every location in a territory must
-- capture it exactly once, banking a real (>= 0) duration and paying the
-- flat territory_capture bonus; my_territories()/territory_locations() must
-- track held/total/captured correctly along the way; territory_leaderboard()
-- must list every capture for that territory with `is_you` scoped to the
-- caller.
--
-- No admin-authorization escape-hatch test for the read APIs themselves —
-- unlike suggestion review, nothing here is reviewer-only: my_territories(),
-- territory_locations() and territory_leaderboard() are all plain
-- authenticated reads, same bar as league standings.
--
-- Real claims via make_trek()/claim_location(). Runs inside a transaction
-- that rolls back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_admin        uuid;
  v_user         uuid;
  v_other        uuid;
  v_locs         uuid[];
  v_spare        uuid[];
  v_territory    uuid;
  v_err          text;
  v_trek         uuid;
  v_claim        record;
  v_row          record;
  v_xp           integer;
  v_mo           integer;
  v_held         integer;
  v_total        integer;
  v_captured     boolean;
  v_duration     integer;
  v_leaderboard_rows integer;
  i              integer;
begin
  v_admin := make_user('territory-admin-' || floor(random() * 1e6)::text || '@t');
  v_user  := make_user('territory-user-'  || floor(random() * 1e6)::text || '@t');
  v_other := make_user('territory-other-' || floor(random() * 1e6)::text || '@t');
  update profiles set is_admin = true where id = v_admin;

  select array_agg(id) into v_locs
  from (
    select id from locations
    where status = 'open' and not is_secret and territory_id is null
    order by id limit 4
  ) x;

  select array_agg(id) into v_spare
  from (
    select id from locations
    where status = 'open' and not is_secret and territory_id is null
      and id <> all(v_locs)
    order by id limit 3
  ) x;

  -- A non-admin is refused outright.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    perform create_territory('Should not happen', v_spare);
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err = 'not authorized' then
    raise notice 'ok   a non-admin is refused (not authorized)';
  else
    raise notice 'FAIL non-admin create_territory gave % instead of the expected refusal', coalesce(v_err, 'no error');
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- Wrong count (2, not 3-4) is refused.
  begin
    perform create_territory('Too small', v_locs[1:2]);
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err = 'a territory needs 3 or 4 locations' then
    raise notice 'ok   a 2-location territory is refused';
  else
    raise notice 'FAIL wrong-count create_territory gave % instead of the expected refusal', coalesce(v_err, 'no error');
  end if;

  -- The real territory: all 4.
  v_territory := create_territory('Test Territory', v_locs);
  if v_territory is not null then
    raise notice 'ok   an admin creates a real territory';
  else
    raise notice 'FAIL create_territory returned no id';
  end if;

  -- Reusing an already-assigned location (v_locs[1]) alongside fresh ones
  -- is refused.
  begin
    perform create_territory('Overlap', array[v_locs[1], v_spare[1], v_spare[2]]);
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err = 'every location must be open, public, and not already in a territory' then
    raise notice 'ok   a location already in a territory is refused';
  else
    raise notice 'FAIL overlapping create_territory gave % instead of the expected refusal', coalesce(v_err, 'no error');
  end if;

  -- v_user claims 3 of the 4 — not yet captured.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  for i in 1..3 loop
    v_trek := make_trek(v_user, v_locs[i]);
    perform claim_location(v_locs[i], v_trek);
  end loop;

  select held, total, captured into v_held, v_total, v_captured
  from my_territories() where territory_id = v_territory;
  if v_held = 3 and v_total = 4 and not v_captured then
    raise notice 'ok   my_territories() tracks partial progress (3 of 4, not captured)';
  else
    raise notice 'FAIL partial progress read held=% total=% captured=%', v_held, v_total, v_captured;
  end if;

  select count(*) into v_held from territory_locations(v_territory) where claimed;
  if v_held = 3 then
    raise notice 'ok   territory_locations() agrees: 3 members claimed';
  else
    raise notice 'FAIL territory_locations() claimed count was %', v_held;
  end if;

  -- The 4th claim captures it.
  v_trek := make_trek(v_user, v_locs[4]);
  select * into v_claim from claim_location(v_locs[4], v_trek) limit 1;

  select coalesce(sum(amount), 0) into v_xp
    from points_ledger where claim_id = v_claim.claim_id and source = 'territory_capture' and system = 'xp';
  select coalesce(sum(amount), 0) into v_mo
    from points_ledger where claim_id = v_claim.claim_id and source = 'territory_capture' and system = 'monthly';
  if v_xp = 60 and v_mo = 120 then
    raise notice 'ok   the 4th claim pays the territory bonus (60 xp / 120 monthly)';
  else
    raise notice 'FAIL territory bonus paid xp=% monthly=% (expected 60/120)', v_xp, v_mo;
  end if;

  select held, total, captured, duration_s into v_held, v_total, v_captured, v_duration
  from my_territories() where territory_id = v_territory;
  if v_captured and v_held = 4 and v_duration >= 0 then
    raise notice 'ok   my_territories() reports captured with a real (>=0) duration (%s)', v_duration;
  else
    raise notice 'FAIL captured=% held=% duration_s=%', v_captured, v_held, v_duration;
  end if;

  -- v_other captures the same territory too — the leaderboard is per
  -- territory, not per first-finder, so a second capture must be possible.
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  for i in 1..4 loop
    v_trek := make_trek(v_other, v_locs[i]);
    perform claim_location(v_locs[i], v_trek);
  end loop;

  select count(*) into v_leaderboard_rows from territory_leaderboard(v_territory);
  if v_leaderboard_rows = 2 then
    raise notice 'ok   territory_leaderboard() lists both captures';
  else
    raise notice 'FAIL territory_leaderboard() had % rows (expected 2)', v_leaderboard_rows;
  end if;

  -- v_captured is reused below as a scratch boolean for is_you, unrelated
  -- to its territory-progress meaning above.
  select is_you into v_captured from territory_leaderboard(v_territory) where display_name = (select display_name from profiles where id = v_other);
  if v_captured then
    raise notice 'ok   territory_leaderboard() marks the caller''s own row is_you';
  else
    raise notice 'FAIL territory_leaderboard() did not mark v_other''s row is_you when called as v_other';
  end if;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select is_you into v_captured from territory_leaderboard(v_territory) where display_name = (select display_name from profiles where id = v_other);
  if not v_captured then
    raise notice 'ok   territory_leaderboard() does not mark someone else''s row is_you';
  else
    raise notice 'FAIL v_other''s row still read is_you=true when called as v_user';
  end if;
end $$;

rollback;
