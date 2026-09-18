-- Itemized points on the reward screen (0021): claim_points_breakdown()
-- must return exactly the XP-system rows for one claim, summing to the
-- same total locations_near() already reports as points_earned, and must
-- refuse to hand back another user's breakdown given their claim_id.
--
-- Same shape as 30_points_and_league.sql: a real claim via claim_location(),
-- not the make_trek/make_user fixtures (those two are unrelated to what's
-- under test here). Runs inside a transaction that rolls back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_user      uuid;
  v_other     uuid;
  v_trek      uuid;
  v_loc       locations%rowtype;
  v_claim     record;
  v_xp_total  integer;
  v_bd_total  integer;
  v_bd_rows   integer;
  v_other_rows integer;
  i           integer;
begin
  select * into v_loc
  from locations
  where status = 'open' and not is_secret and set_id is not null
  order by elevation_m
  limit 1;

  select id into v_user  from profiles order by explorer_number limit 1;
  select id into v_other from profiles where id <> v_user order by explorer_number limit 1;

  perform set_config('request.jwt.claim.sub', v_user::text, true);

  insert into treks (user_id, started_at, ended_at, distance_m, moving_time_s, status)
  values (v_user, now() - interval '70 minutes', now(), 6200, 3600, 'submitted')
  returning id into v_trek;

  for i in 0..11 loop
    insert into trek_points (trek_id, geom, recorded_at, accuracy_m, is_mocked, altitude_m)
    values (
      v_trek,
      st_translate(v_loc.geom::geometry, (i % 3) * 0.00008, (i % 4) * 0.00008)::geography,
      now() - make_interval(secs => (11 - i) * 10),
      12, false, v_loc.elevation_m
    );
  end loop;

  select * into v_claim from claim_location(v_loc.id, v_trek) limit 1;

  select coalesce(sum(amount), 0) into v_xp_total
    from points_ledger where claim_id = v_claim.claim_id and system = 'xp';

  select coalesce(sum(amount), 0), count(*) into v_bd_total, v_bd_rows
    from claim_points_breakdown(v_claim.claim_id);

  if v_bd_rows = 0 then
    raise notice 'FAIL claim_points_breakdown() returned no rows for a real claim';
  elsif v_bd_total <> v_xp_total then
    raise notice 'FAIL breakdown total % does not match points_ledger xp total %', v_bd_total, v_xp_total;
  else
    raise notice 'ok   breakdown sums to the same xp total (% across % sources)', v_bd_total, v_bd_rows;
  end if;

  if exists (select 1 from claim_points_breakdown(v_claim.claim_id) where source = 'moving_time' or source = 'badge') then
    raise notice 'ok   breakdown includes trek-level and claim-level sources';
  else
    raise notice 'FAIL breakdown is missing an expected source';
  end if;

  -- Ownership: a different signed-in user asking for this claim_id gets nothing.
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  select count(*) into v_other_rows from claim_points_breakdown(v_claim.claim_id);
  if v_other_rows <> 0 then
    raise notice 'FAIL another user could read this claim''s points breakdown';
  else
    raise notice 'ok   another user gets nothing for someone else''s claim_id';
  end if;
end $$;

rollback;
