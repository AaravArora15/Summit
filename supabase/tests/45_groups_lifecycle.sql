-- Private groups: leaving, dissolving, and removing a member.
--
-- The companion to 40_groups.sql, which covers create/request/decide/score.
-- This one covers the three mutations that end a membership, and the thing
-- most worth pinning down is what must survive them: a member leaving is not
-- allowed to disturb the leader's join-request inbox, and a solo leader
-- leaving must take the group's row with it -- the FK cascade runs
-- groups -> group_members, so deleting the membership row on its own would
-- leave a group behind that nobody belongs to, still holding a live invite
-- code and still feeding its old leader a join-request inbox.
--
-- Identity switches through request.jwt.claim.sub, exactly as PostgREST would
-- arrive with different callers. Runs inside a transaction that rolls back,
-- like 30 and 40, so it is safe to point at a real database too.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_leader   uuid;
  v_a        uuid;
  v_b        uuid;
  v_out      uuid;
  v_solo     uuid;

  v_group  uuid;
  v_code   text;
  v_group2 uuid;
  v_code2  text;
  v_rows   integer;
begin
  select make_user('lc-leader-' || floor(random() * 1e6)::int || '@t') into v_leader;
  select make_user('lc-a-'      || floor(random() * 1e6)::int || '@t') into v_a;
  select make_user('lc-b-'      || floor(random() * 1e6)::int || '@t') into v_b;
  select make_user('lc-out-'    || floor(random() * 1e6)::int || '@t') into v_out;
  select make_user('lc-solo-'   || floor(random() * 1e6)::int || '@t') into v_solo;

  ------------------------------------------------------------------ set up

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select group_id, invite_code into v_group, v_code from create_group('Leave Test');

  -- a and b are seated through the real gate, so the membership rows this
  -- test later deletes are ones the app could genuinely have created.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform request_join_group(v_code);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform request_join_group(v_code);

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  perform respond_join_request(
    (select request_id from pending_join_requests() where user_id = v_a), true);
  perform respond_join_request(
    (select request_id from pending_join_requests() where user_id = v_b), true);

  if (select member_count from my_group()) <> 3 then
    raise exception 'FAIL: setup seated % members, expected 3',
      (select member_count from my_group());
  end if;

  -- A fourth person asks and is deliberately left waiting.
  perform set_config('request.jwt.claim.sub', v_out::text, true);
  perform request_join_group(v_code);

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select count(*) into v_rows from pending_join_requests();
  if v_rows <> 1 then
    raise exception 'FAIL: leader inbox shows % requests, expected 1', v_rows;
  end if;

  ------------------------------------------------------ a member leaving

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform leave_group();

  if exists (select 1 from my_group()) then
    raise exception 'FAIL: a member who left still reads a group';
  end if;

  -- The regression that matters: leaving must touch only the leaver's own
  -- rows. An earlier version deleted every request for the group, so one
  -- member leaving silently emptied the leader's inbox.
  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select count(*) into v_rows from pending_join_requests();
  if v_rows <> 1 then
    raise exception 'FAIL: a member leaving wiped the leader inbox (% requests, expected 1)', v_rows;
  end if;

  select count(*) into v_rows from group_standings();
  if v_rows <> 2 then
    raise exception 'FAIL: standings show % rows after a leave, expected 2', v_rows;
  end if;

  -- Someone with no group cannot leave one.
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  begin
    perform leave_group();
    raise exception 'FAIL: a non-member left a group';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%not in a group%' then
      raise;
    end if;
  end;

  ------------------------------------------------- the leader cannot walk

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  begin
    perform leave_group();
    raise exception 'FAIL: a leader left a group that still had members';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1
       or sqlerrm not like '%delete the group instead%' then
      raise;
    end if;
  end;

  ------------------------------------------------------------------ kicking

  -- The group is down to leader + a, so a kick is refused: the last member
  -- is removed by dissolving the group, not by kicking them out of it.
  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  begin
    perform kick_group_member(v_a);
    raise exception 'FAIL: the last non-leader member was kicked instead of a dissolve';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%Use Delete Group%' then
      raise;
    end if;
  end;

  -- A member is not a leader.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin
    perform kick_group_member(v_leader);
    raise exception 'FAIL: an ordinary member removed another member';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1
       or sqlerrm not like '%Only the leader can remove members%' then
      raise;
    end if;
  end;

  -- The leader cannot kick themselves.
  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  begin
    perform kick_group_member(v_leader);
    raise exception 'FAIL: the leader kicked themselves';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1
       or sqlerrm not like '%cannot remove yourself%' then
      raise;
    end if;
  end;

  -- Three members again, so a kick has somewhere to land.
  perform respond_join_request((select request_id from pending_join_requests()), true);
  if (select member_count from my_group()) <> 3 then
    raise exception 'FAIL: accepting the waiter gave % members, expected 3',
      (select member_count from my_group());
  end if;

  perform kick_group_member(v_out);

  perform set_config('request.jwt.claim.sub', v_out::text, true);
  if exists (select 1 from my_group()) then
    raise exception 'FAIL: a kicked member still reads a group';
  end if;

  -- Kicked and not banned: asking again is allowed.
  perform request_join_group(v_code);

  perform set_config('request.jwt.claim.sub', v_leader::text, true);
  select count(*) into v_rows from group_standings();
  if v_rows <> 2 then
    raise exception 'FAIL: standings show % rows after a kick, expected 2', v_rows;
  end if;

  ---------------------------------------------------------------- dissolving

  perform delete_group();

  if exists (select 1 from my_group()) then
    raise exception 'FAIL: a deleted group still reads back';
  end if;

  select count(*) into v_rows from pending_join_requests();
  if v_rows <> 0 then
    raise exception 'FAIL: % join requests outlived the group', v_rows;
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  if exists (select 1 from my_group()) then
    raise exception 'FAIL: an ex-member still reads the deleted group';
  end if;

  -- The invite code died with the group: a fresh request finds nothing.
  perform set_config('request.jwt.claim.sub', v_out::text, true);
  begin
    perform request_join_group(v_code);
    raise exception 'FAIL: a deleted group''s code still found a group';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%No group with that code%' then
      raise;
    end if;
  end;

  ------------------------------------------- a solo leader leaving dissolves

  -- The cascade runs groups -> group_members, so this is the case that has to
  -- delete the groups row explicitly rather than relying on it.
  perform set_config('request.jwt.claim.sub', v_solo::text, true);
  select group_id, invite_code into v_group2, v_code2 from create_group('Solo Exit');
  perform leave_group();

  if exists (select 1 from my_group()) then
    raise exception 'FAIL: a solo leader who left still reads a group';
  end if;

  if exists (select 1 from groups where id = v_group2) then
    raise exception 'FAIL: a solo leader leaving left the group row behind';
  end if;

  -- And the freed code is genuinely gone rather than pointing at a ghost.
  perform set_config('request.jwt.claim.sub', v_out::text, true);
  begin
    perform request_join_group(v_code2);
    raise exception 'FAIL: a group orphaned by a solo leader was still joinable';
  exception when others then
    if position('FAIL:' in sqlerrm) = 1 or sqlerrm not like '%No group with that code%' then
      raise;
    end if;
  end;

  raise notice 'groups lifecycle: PASS';
end $$;

rollback;
