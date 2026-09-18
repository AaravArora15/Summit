-- Summit: private groups, the Groups half of the League tab.
--
-- The League tab has always had two segments and only one backend. This
-- migration adds the second: a group is a small opt-in leaderboard behind an
-- invite code, scored on this month's monthly points, run by whoever created
-- it.
--
-- Shape of the system:
--
--   create_group(p_name)          become a leader; get an invite code back
--   my_group()                    your group, if any
--   group_standings()             members ranked by month-to-date points
--   request_join_group(p_code)    ask to join by code; lands as `pending`
--   my_group_request()            your most recent outgoing request
--   pending_join_requests()       the leader's inbox of pending requests
--   respond_join_request(...)     leader accepts or declines one
--
-- Membership is gated, not open: anyone with the code can *request*, only the
-- leader lets them in. That is the whole difference between a group and the
-- public league, so it is enforced here rather than in the client.
--
-- Points are read month-to-date from points_ledger (system = 'monthly'), not
-- from league_members: a member who has not been placed in a division this
-- month -- the known rollover gap in pending.md -- still appears, and still
-- scores, in the group. Groups are between friends; the ledger is the source
-- of truth the league itself denormalises from.

begin;
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 3 and 40),
  invite_code text not null unique,
  leader_id   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists groups_leader_idx on groups (leader_id);

create table if not exists group_members (
  group_id  uuid not null references groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- One group per person, for now. The mockup shows a single private league per
-- climber and every screen above it assumes that too ("your group", not
-- "groups"); relaxing it later means dropping this index and nothing else.
create unique index if not exists one_group_per_user on group_members (user_id);

create table if not exists group_join_requests (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending'
               check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (group_id, user_id)
);

-- The inbox query filters to pending; a partial index keeps it tiny no matter
-- how many declined requests pile up behind it.
create index if not exists group_join_requests_pending_idx
  on group_join_requests (group_id, created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------
--
-- Four characters, a dash, four more, from an alphabet with the lookalikes
-- (0/O, 1/I/L) removed: a code gets read aloud over a WhatsApp call, and
-- "is that an O or a zero" is the failure mode. Randomness over word-lists
-- because a word-list big enough to avoid collisions is a dependency; 31^8 is
-- about 850 billion codes and the retry loop below absorbs the rest.

create or replace function new_invite_code()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  with picked as (
    select string_agg(
      substr(c.alphabet, (floor(random() * length(c.alphabet)))::int + 1, 1), ''
    ) as s
    from (select 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'::text as alphabet) c,
         generate_series(1, 8)
  )
  select left(s, 4) || '-' || right(s, 4) from picked;
$$;

revoke all on function new_invite_code() from public;

-- ---------------------------------------------------------------------------
-- Membership helpers (RLS building blocks)
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason in_league() is (0006): a policy whose
-- USING clause selects from the table it protects re-enters its own policy.
create or replace function in_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create or replace function leads_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from groups
    where id = p_group_id and leader_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: creating and reading your own group
-- ---------------------------------------------------------------------------

create or replace function create_group(p_name text)
returns table (group_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_group uuid;
  v_code  text;
  v_tries integer := 0;
begin
  if char_length(v_name) < 3 then
    raise exception 'Give the group a longer name';
  end if;

  if exists (select 1 from group_members where user_id = v_user) then
    raise exception 'You are already in a group';
  end if;

  loop
    begin
      v_code := new_invite_code();
      insert into groups (name, invite_code, leader_id)
      values (v_name, v_code, v_user)
      returning id into v_group;
      exit;
    exception when unique_violation then
      -- A colliding code is a coincidence, not an error. Five tries puts the
      -- odds of giving up at better than 1 in 10^15.
      v_tries := v_tries + 1;
      if v_tries >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into group_members (group_id, user_id) values (v_group, v_user);

  -- A leader who asked to join someone else's group before changing their
  -- mind does not want both queues open.
  delete from group_join_requests where user_id = v_user and status = 'pending';

  return query select v_group, v_code;
end;
$$;

create or replace function my_group()
returns table (
  group_id     uuid,
  name         text,
  invite_code  text,
  leader_id    uuid,
  member_count integer,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select g.id, g.name, g.invite_code, g.leader_id,
         (select count(*)::integer from group_members m where m.group_id = g.id),
         g.created_at
  from groups g
  where exists (
    select 1 from group_members m
    where m.group_id = g.id and m.user_id = auth.uid()
  );
$$;

-- Ranked by this month's monthly points, month-to-date from the ledger. Tie-
-- break matches the league standings: join time, then id, so equal scores hold
-- stable positions instead of flickering between refreshes.
create or replace function group_standings()
returns table (
  rank      integer,
  user_id   uuid,
  name      text,
  initials  text,
  points    integer,
  treks     integer,
  distance_m numeric,
  is_you    boolean,
  is_leader boolean
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with mine as (
    select m.group_id
    from group_members m
    where m.user_id = auth.uid()
  ),
  month_points as (
    select l.user_id, sum(l.amount)::integer as points
    from points_ledger l
    where l.system = 'monthly'
      and l.awarded_at >= date_trunc('month', now())
    group by l.user_id
  ),
  month_treks as (
    select t.user_id,
           count(*)::integer as treks,
           sum(t.distance_m)::numeric as distance_m
    from treks t
    where t.status = 'validated'
      and coalesce(t.ended_at, t.started_at) >= date_trunc('month', now())
    group by t.user_id
  )
  select
    row_number() over (
      order by coalesce(mp.points, 0) desc, m.joined_at, m.user_id
    )::integer,
    m.user_id,
    p.display_name,
    upper(substr(regexp_replace(p.display_name, '[^a-zA-Z ]', '', 'g'), 1, 1))
      || coalesce(upper(substr(split_part(
           trim(regexp_replace(p.display_name, '[^a-zA-Z ]', '', 'g')), ' ', 2), 1, 1)), ''),
    coalesce(mp.points, 0),
    coalesce(mt.treks, 0),
    coalesce(mt.distance_m, 0),
    m.user_id = auth.uid(),
    g.leader_id = m.user_id
  from group_members m
  join groups g on g.id = m.group_id
  join profiles p on p.id = m.user_id
  left join month_points mp on mp.user_id = m.user_id
  left join month_treks mt on mt.user_id = m.user_id
  where m.group_id = (select group_id from mine)
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- RPC: asking to join, and answering
-- ---------------------------------------------------------------------------

create or replace function request_join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_norm  text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_group uuid;
begin
  if v_norm = '' then
    raise exception 'Enter an invite code';
  end if;

  -- Compare dash-stripped both sides: pasted codes arrive lowercase, spaced,
  -- or without the dash, and all three mean the same group.
  select id into v_group from groups where replace(invite_code, '-', '') = v_norm;
  if v_group is null then
    raise exception 'No group with that code';
  end if;

  if exists (
    select 1 from group_members where user_id = v_user
  ) then
    raise exception 'You are already in a group';
  end if;

  insert into group_join_requests (group_id, user_id)
  values (v_group, v_user)
  on conflict (group_id, user_id) do update
    -- A decline is not a door slammed forever: asking again resets the same
    -- row rather than stacking duplicates the unique constraint would refuse.
    set status = 'pending', created_at = now(), decided_at = null;

  return v_group;
end;
$$;

-- The requester's side of the queue: most recent attempt that still means
-- something -- waiting, or declined. An accepted row is deliberately absent:
-- acceptance seats the person in the same transaction, so membership already
-- says everything that row could say.
create or replace function my_group_request()
returns table (
  request_id  uuid,
  group_id    uuid,
  group_name  text,
  leader_name text,
  status      text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select r.id, r.group_id, g.name,
         coalesce(lp.display_name, 'the leader'),
         r.status, r.created_at
  from group_join_requests r
  join groups g on g.id = r.group_id
  left join profiles lp on lp.id = g.leader_id
  where r.user_id = auth.uid() and r.status <> 'accepted'
  order by r.created_at desc
  limit 1;
$$;

-- The leader's side: everyone waiting on a decision, oldest first.
create or replace function pending_join_requests()
returns table (
  request_id uuid,
  user_id    uuid,
  name       text,
  initials   text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select r.id, r.user_id, p.display_name,
         upper(substr(regexp_replace(p.display_name, '[^a-zA-Z ]', '', 'g'), 1, 1))
           || coalesce(upper(substr(split_part(
                trim(regexp_replace(p.display_name, '[^a-zA-Z ]', '', 'g')), ' ', 2), 1, 1)), ''),
         r.created_at
  from group_join_requests r
  join groups g on g.id = r.group_id
  join profiles p on p.id = r.user_id
  where g.leader_id = auth.uid() and r.status = 'pending'
  order by r.created_at;
$$;

create or replace function respond_join_request(p_request_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_group_cap constant integer := 50;

  v_request record;
  v_count   integer;
begin
  select r.*, g.leader_id as grp_leader
    into v_request
  from group_join_requests r
  join groups g on g.id = r.group_id
  where r.id = p_request_id
  for update of r;

  if not found then
    raise exception 'That request no longer exists';
  end if;

  if v_request.grp_leader <> auth.uid() then
    raise exception 'Only the group leader decides who joins';
  end if;

  -- Already answered somewhere else, on another device, seconds earlier: a
  -- second tap lands here and changes nothing, which beats erroring on a
  -- double-press over a flaky connection.
  if v_request.status <> 'pending' then
    return false;
  end if;

  if p_accept then
    select count(*) into v_count from group_members where group_id = v_request.group_id;
    if v_count >= c_group_cap then
      raise exception 'The group is full';
    end if;

    begin
      insert into group_members (group_id, user_id)
      values (v_request.group_id, v_request.user_id);
    exception when unique_violation then
      -- They joined a different group between asking and being accepted.
      update group_join_requests set status = 'rejected', decided_at = now()
      where id = p_request_id;
      raise exception 'They joined another group';
    end;
  end if;

  update group_join_requests
     set status = case when p_accept then 'accepted' else 'rejected' end,
         decided_at = now()
   where id = p_request_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
--
-- Reads go through the policies below AND through the SECURITY DEFINER
-- functions above, which bypass RLS entirely. Writes have no policies at all:
-- every mutation is an RPC, so there is no path where a client writes a row
-- directly, and therefore none where a caller makes themselves a member.

alter table groups              enable row level security;
alter table group_members       enable row level security;
alter table group_join_requests enable row level security;

drop policy if exists "members read their group" on groups;
create policy "members read their group" on groups
  for select using (in_group(id) or leader_id = auth.uid());

drop policy if exists "co-members are visible" on group_members;
create policy "co-members are visible" on group_members
  for select using (in_group(group_id));

drop policy if exists "own or leading requests" on group_join_requests;
create policy "own or leading requests" on group_join_requests
  for select using (user_id = auth.uid() or leads_group(group_id));

revoke all on function create_group(text)                        from public;
revoke all on function my_group()                                from public;
revoke all on function group_standings()                         from public;
revoke all on function request_join_group(text)                  from public;
revoke all on function my_group_request()                        from public;
revoke all on function pending_join_requests()                   from public;
revoke all on function respond_join_request(uuid, boolean)       from public;
revoke all on function in_group(uuid)                            from public;
revoke all on function leads_group(uuid)                         from public;

grant execute on function create_group(text)                     to authenticated;
grant execute on function my_group()                             to authenticated;
grant execute on function group_standings()                      to authenticated;
grant execute on function request_join_group(text)               to authenticated;
grant execute on function my_group_request()                     to authenticated;
grant execute on function pending_join_requests()                to authenticated;
grant execute on function respond_join_request(uuid, boolean)    to authenticated;
grant execute on function in_group(uuid)                         to authenticated;
grant execute on function leads_group(uuid)                      to authenticated;

commit;
