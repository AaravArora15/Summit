-- run_league_rollover() must not just recompute tiers -- it has to actually
-- place everyone from last period's leagues into a real league_members row
-- for the new period, at 0 points, in whatever tier they now sit in.
-- Otherwise my_league() finds nothing for the new month until the user
-- scores again, and the app falls back to showing demo league data. See
-- pending.md's "known gap" note under the 2026-08-22 entry.
\pset tuples_only on
\pset format unaligned

begin;

do $$
declare
  v_period     date := date_trunc('month', now())::date - interval '1 month';
  v_new_period date := date_trunc('month', now())::date;
  v_league     uuid;
  v_top        uuid;
  v_mid        uuid;
  v_active     uuid;  -- already scored something this month before rollover ran
  v_tier       text;
  v_points     integer;
begin
  v_top    := make_user('rollover-top-'    || floor(random()*1e6) || '@t');
  v_mid    := make_user('rollover-mid-'    || floor(random()*1e6) || '@t');
  v_active := make_user('rollover-active-' || floor(random()*1e6) || '@t');

  -- Signing up already enrolled each of these into *this* month's league
  -- (handle_new_user() -> league_for_user()), same as any real signup. Undo
  -- that for v_top/v_mid: they stand in for a user who joined in an earlier
  -- month, which is what every genuine rollover candidate looks like.
  delete from league_members
   using leagues l
   where league_members.league_id = l.id
     and l.period = v_new_period
     and league_members.user_id in (v_top, v_mid);

  -- One division, last period, tier trailhead. Both rank inside
  -- c_promote_top (8), so both should be promoted to foothills.
  insert into leagues (period, tier, division_no, city_id)
  values (v_period, 'trailhead', 999001, null)
  returning id into v_league;

  insert into league_members (league_id, user_id, points, joined_at)
  values
    (v_league, v_top, 900, now() - interval '20 days'),
    (v_league, v_mid, 300, now() - interval '20 days');

  -- v_active already scored something *this* month, before the rollover job
  -- ran -- the ordinary lazy-enrollment path. Rollover must not clobber it.
  perform league_for_user(v_active, v_new_period);
  update league_members lm set points = 250
    from leagues l
   where lm.league_id = l.id and l.period = v_new_period and lm.user_id = v_active;

  perform run_league_rollover(v_period);

  select l.tier, lm.points into v_tier, v_points
  from league_members lm join leagues l on l.id = lm.league_id
  where lm.user_id = v_top and l.period = v_new_period;

  if v_tier is null then
    raise exception 'FAIL: top performer was not re-enrolled for the new period';
  end if;
  if v_tier <> 'foothills' then
    raise exception 'FAIL: top performer landed in % instead of foothills', v_tier;
  end if;
  if v_points <> 0 then
    raise exception 'FAIL: re-enrolled member should start at 0 points, got %', v_points;
  end if;

  select l.tier, lm.points into v_tier, v_points
  from league_members lm join leagues l on l.id = lm.league_id
  where lm.user_id = v_mid and l.period = v_new_period;

  if v_tier is distinct from 'foothills' then
    raise exception 'FAIL: second member landed in % instead of foothills', v_tier;
  end if;
  if v_points <> 0 then
    raise exception 'FAIL: re-enrolled member should start at 0 points, got %', v_points;
  end if;

  -- The user who already scored this month keeps their points: rollover
  -- must not reset an enrollment that already exists.
  select lm.points into v_points
  from league_members lm join leagues l on l.id = lm.league_id
  where lm.user_id = v_active and l.period = v_new_period;

  if v_points <> 250 then
    raise exception 'FAIL: rollover clobbered an existing in-progress enrollment (got %)', v_points;
  end if;

  -- Re-running for the same period must not duplicate or reset anything.
  perform run_league_rollover(v_period);

  if (select count(*) from league_members lm join leagues l on l.id = lm.league_id
      where lm.user_id = v_top and l.period = v_new_period) <> 1 then
    raise exception 'FAIL: re-running rollover duplicated an enrollment';
  end if;

  select lm.points into v_points
  from league_members lm join leagues l on l.id = lm.league_id
  where lm.user_id = v_top and l.period = v_new_period;

  if v_points <> 0 then
    raise exception 'FAIL: re-running rollover reset an already-carried-over member''s points';
  end if;

  raise notice 'PASS';
end $$;

rollback;
