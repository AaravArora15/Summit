-- Private groups: create, request, decide, score.
--
-- The whole gate lives server-side, so this exercises the RPCs the way the
-- app calls them: switching identity through request.jwt.claim.sub between
-- steps, exactly as PostgREST would arrive with different callers. What must
-- NOT be possible is the interesting part here: a non-leader deciding, a
-- second group, joining while already in one, and XP rows leaking into a
-- monthly scoreboard.
--
-- Runs inside a transaction that rolls back, like 30, so it is safe to point
-- at a real database as well as the throwaway one.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_leader   uuid;
  v_joinee   uuid;
  v_third    uuid;
  v_outsider uuid;

  v_group   uuid;
  v_code    text;
  v_request uuid;
  v_status  text;
  v_rows    integer;
  v_points  integer;
begin
  select make_user('grp-leader-' || floor(random() * 1e6)::int || '@t') into v_leader;
  select make_user('grp-joiner-' || floor(random() * 1e6)::int || '@t') into v_joinee;
  select make_user('grp-third-'  || floor(random() * 1e6)::int || '@t') into v_third;
  select make_user('grp-out-'    || floor(random() * 1e6)::int || '@t') into v_outsider;

  -------------------------------------------------------------------- create

  perform set_config('request.jwt.claim.sub', v_leader::text, true);

  -- A refused short name is the happy path here; anything else re-raises.
  begin
    perform create_group('ab');
    raise exception 'FAIL: a shorter-than-three name was accepted';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%longer name%' then
      raise;
    end if;
  end;

  select group_id, invite_code into v_group, v_code from create_group('Sunday Walkers');

  if v_code !~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$' then
    raise exception 'FAIL: invite code shape wrong: %', v_code;
  end if;

  if (select member_count from my_group()) <> 1 then
    raise exception 'FAIL: creator was not enrolled as the first member';
  end if;

  --------------------------------------------------------------- ask to join

  perform set_config('request.jwt.claim.sub', v_joinee::text, true);

  begin
    perform request_join_group('NOPE-XXXX');
    raise exception 'FAIL: a bogus code found a group';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%No group with that code%' then
      raise;
    end if;
  end;

  -- Lowercase and dash-less: the normalisation a pasted code arrives in.
  perform request_join_group(replace(lower(v_code), '-', ''));

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select count(*) into v_rows from pending_join_requests();
  if v_rows <> 1 then
    raise exception 'FAIL: leader inbox shows % requests, expected 1', v_rows;
  end if;
  select request_id into v_request from pending_join_requests();

  -- A second ask must not stack a second row.
  perform set_config('request.jwt.claim.sub', v_joinee::text, true);
  perform request_join_group(v_code);
  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select count(*) into v_rows from pending_join_requests();
  if v_rows <> 1 then
    raise exception 'FAIL: re-request duplicated the queue';
  end if;

  ------------------------------------------------------------------- the gate

  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  begin
    perform respond_join_request(v_request, true);
    raise exception 'FAIL: someone other than the leader answered a request';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%Only the group leader%' then
      raise;
    end if;
  end;

  ------------------------------------------------------------ decline / retry

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  perform respond_join_request(v_request, false);

  perform set_config('request.jwt.claim.sub', v_joinee::text, true);
  select status into v_status from my_group_request();
  if v_status <> 'rejected' then
    raise exception 'FAIL: declined request reads as %', v_status;
  end if;

  perform request_join_group(v_code);
  select status into v_status from my_group_request();
  if v_status <> 'pending' then
    raise exception 'FAIL: re-request did not reopen the question (%)', v_status;
  end if;

  --------------------------------------------------------------------- accept

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  perform respond_join_request(v_request, true);
  perform respond_join_request(v_request, true);   -- idempotent double-tap

  if (select member_count from my_group()) <> 2 then
    raise exception 'FAIL: acceptance did not seat the joinee exactly once';
  end if;

  perform set_config('request.jwt.claim.sub', v_joinee::text, true);
  if exists (select 1 from my_group_request()) then
    raise exception 'FAIL: a seated member still sees an open request';
  end if;

  ------------------------------------------------------------------ the walls

  begin
    perform create_group('Another One');
    raise exception 'FAIL: a member created a second group';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%already in a group%' then
      raise;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', v_third::text, true);
  perform create_group('Hill Hoppers');

  begin
    perform request_join_group(v_code);
    raise exception 'FAIL: someone already in a group joined another';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%already in a group%' then
      raise;
    end if;
  end;

  -------------------------------------------------------------------- scoring

  -- Monthly rows only, month-to-date. An xp row of the same size sits beside
  -- them on purpose: if the scoreboard doubles, this catches it here rather
  -- than in a screenshot.
  insert into points_ledger (user_id, source, system, amount, awarded_at)
  values (v_joinee, 'badge', 'monthly', 500, now()),
         (v_joinee, 'difficulty', 'monthly', 40, now()),
         (v_joinee, 'badge', 'xp', 9999, now());

  perform set_config('request.jwt.claim.sub', v_joinee::text, true);
  select rank, points into v_rows, v_points from group_standings() where is_you;
  if v_rows <> 1 or v_points <> 540 then
    raise exception 'FAIL: standings read rank=% points=%, expected rank 1 at 540', v_rows, v_points;
  end if;

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select rank into v_rows from group_standings() where is_you;
  if v_rows <> 2 then
    raise exception 'FAIL: zero-point leader ranked %, expected 2nd of 2', v_rows;
  end if;

  raise notice 'groups: PASS';
end $$;

rollback;
