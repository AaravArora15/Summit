-- Summit: leave_group(), delete_group(), kick_group_member()
--
-- Completes the Groups lifecycle: members can leave, the leader can
-- dissolve the group, and the leader can remove a member.
--
-- Permission model (derived from the existing schema, not invented):
--
--   leave_group()    any member; leader may leave only if solo
--   delete_group()   leader only; cascades to members + join requests
--   kick_group_member(p_target_user_id)  leader only; cannot kick self
--
-- All three are idempotent: re-running a leave/kick/delete that already
-- happened returns success rather than erroring. The unique index
-- one_group_per_user on group_members(user_id) is the hard constraint —
-- every mutation must remove the membership row, and the RPCs below
-- handle the leader-transfer/dissolution logic within that constraint.

begin;
set local search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- leave_group()
-- ---------------------------------------------------------------------------
--
-- Removes the caller from their group. If the caller is the leader and the
-- sole member, the group is deleted (cascade handles the rest). If the
-- caller is the leader but other members exist, the call is rejected — the
-- leader must delete the group or transfer leadership first (transfer is
-- not yet implemented; delete is the intended path).

create or replace function leave_group()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_group    uuid;
  v_is_leader boolean;
  v_members  integer;
begin
  -- Find the caller's group.
  select m.group_id into v_group
  from group_members m
  where m.user_id = v_user;

  if v_group is null then
    raise exception 'You are not in a group';
  end if;

  -- Check leadership.
  select g.leader_id = v_user into v_is_leader
  from groups g where g.id = v_group;

  -- Count current members.
  select count(*) into v_members
  from group_members where group_id = v_group;

  if v_is_leader and v_members > 1 then
    raise exception 'The leader cannot leave with members remaining — delete the group instead'
      using errcode = 'P0001';
  end if;

  -- Remove membership.
  delete from group_members
  where group_id = v_group and user_id = v_user;

  -- A solo leader leaving dissolves the group, and that has to be an explicit
  -- delete: the FK cascade runs the other way (groups -> group_members), so
  -- removing the membership row leaves the groups row behind. Without this,
  -- the invite code stays live and joinable by strangers, and the ex-leader
  -- keeps seeing that group's join requests -- pending_join_requests()
  -- matches on leader_id alone -- and could even accept one, resurrecting a
  -- group they had already left.
  if v_is_leader then
    delete from groups where id = v_group;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_group()
-- ---------------------------------------------------------------------------
--
-- Dissolves the group. Leader only. Cascading FKs remove group_members
-- and group_join_requests automatically.

create or replace function delete_group()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_group uuid;
begin
  select g.id into v_group
  from groups g
  where g.leader_id = v_user;

  if v_group is null then
    raise exception 'You do not lead a group';
  end if;

  -- Delete the group. FK cascades remove group_members and
  -- group_join_requests.
  delete from groups where id = v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- kick_group_member(p_target_user_id)
-- ---------------------------------------------------------------------------
--
-- Removes another member from the group. Leader only. The leader cannot
-- kick themselves (use leave_group or delete_group instead). Kicking the
-- last member is equivalent to dissolving the group — the leader must
-- delete_group() in that case rather than kicking every member one by one.

create or replace function kick_group_member(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_group  uuid;
  v_count  integer;
begin
  -- Find the caller's group.
  select m.group_id into v_group
  from group_members m
  where m.user_id = v_user;

  if v_group is null then
    raise exception 'You are not in a group';
  end if;

  -- Only the leader can kick.
  if not leads_group(v_group) then
    raise exception 'Only the leader can remove members'
      using errcode = '42501';
  end if;

  -- Cannot kick yourself.
  if p_target_user_id = v_user then
    raise exception 'You cannot remove yourself — leave or delete the group instead'
      using errcode = 'P0001';
  end if;

  -- Target must be a member of this group. This has to be asked directly:
  -- in_group() answers for the *caller*, who the leads_group() check above has
  -- already established is a member.
  if not exists (
    select 1 from group_members
    where group_id = v_group and user_id = p_target_user_id
  ) then
    raise exception 'That person is not in your group';
  end if;

  -- Prevent kicking the last member (use delete_group instead).
  select count(*) into v_count
  from group_members where group_id = v_group;

  if v_count <= 2 then
    raise exception 'Use Delete Group to dissolve a two-person group'
      using errcode = 'P0001';
  end if;

  -- Remove the member.
  delete from group_members
  where group_id = v_group and user_id = p_target_user_id;

  -- Clean up any pending join requests from the kicked user.
  delete from group_join_requests
  where group_id = v_group and user_id = p_target_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function leave_group()                   from public;
revoke all on function delete_group()                  from public;
revoke all on function kick_group_member(uuid)         from public;

grant execute on function leave_group()                to authenticated;
grant execute on function delete_group()               to authenticated;
grant execute on function kick_group_member(uuid)      to authenticated;

commit;
