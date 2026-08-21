-- Summit: the read API the screens call.
--
-- One function per card-group on a screen, each returning rows already
-- aggregated, because the alternative is four round trips and a join done in
-- JavaScript over a connection that may not exist. Trails have no signal.
--
-- These are deliberately separate from 0005: scoring policy and the shape the
-- UI reads are different rates of change, and a screen tweak should not
-- re-declare the points trigger.
--
-- Every function here is `stable` and scoped to auth.uid(). None of them take
-- a user id: a caller must not be able to read another account's collection by
-- guessing a uuid, and the ones that do expose other people (the standings)
-- return only what the standings screen already shows in public.

begin;
set local search_path = public, extensions;

-- `create or replace function` cannot change a function's return type, and
-- every function here returns a table whose shape follows the screen it feeds.
-- Dropping first is what makes this file re-runnable when a card gains a
-- field, which is the normal way it changes.
drop function if exists my_profile();
drop function if exists my_collection();
drop function if exists my_set_progress();
drop function if exists my_recent_badges(integer);
drop function if exists my_league();
drop function if exists league_standings(integer);

-- ---------------------------------------------------------------------------
-- Level curve
-- ---------------------------------------------------------------------------
--
-- Level n → n+1 costs 200n XP, so the cumulative cost of reaching level n is
-- 100·n·(n−1). Linear-per-level rather than flat: a flat cost makes level 30
-- meaningless, and an exponential one makes it unreachable for someone who
-- walks at weekends, which is the entire audience.
--
-- Inverted in closed form rather than looped, because it is called once per
-- profile read and a loop here is a loop in the hot path of the tab.

create or replace function level_for_xp(p_xp integer)
returns integer
language sql
immutable
as $$
  select greatest(1, floor((1 + sqrt(1 + p_xp::numeric / 25)) / 2)::integer);
$$;

create or replace function xp_floor_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  select (100 * p_level * (p_level - 1))::integer;
$$;

-- ---------------------------------------------------------------------------
-- Profile (screen 26)
-- ---------------------------------------------------------------------------

create or replace function my_profile()
returns table (
  user_id          uuid,
  display_name     text,
  initials         text,
  explorer_number  integer,
  city_name        text,
  is_founding      boolean,
  level            integer,
  xp_into_level    integer,
  xp_for_level     integer,
  total_xp         integer,
  badges           integer,
  numbers          integer,
  spots            integer,
  sets_completed   integer,
  treks_this_month integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with me as (
    select p.*, c.name as city_name
    from profiles p
    left join cities c on c.id = p.home_city_id
    where p.id = auth.uid()
  ),
  xp as (
    select coalesce(sum(amount), 0)::integer as total
    from points_ledger where user_id = auth.uid()
  ),
  lvl as (
    select level_for_xp(xp.total) as n, xp.total from xp
  ),
  held as (
    select
      count(*)::integer                                        as badges,
      count(*) filter (where c.pioneer_number is not null)::integer as numbers,
      count(*) filter (where l.is_secret)::integer              as spots
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = auth.uid()
  ),
  sets_done as (
    select count(*)::integer as n
    from (
      select l.set_id
      from locations l
      where l.set_id is not null and l.status = 'open'
      group by l.set_id
      having count(*) = count(*) filter (
        where exists (
          select 1 from claims c
          where c.location_id = l.id and c.user_id = auth.uid()
        )
      )
    ) s
  ),
  month_treks as (
    select count(*)::integer as n
    from treks
    where user_id = auth.uid()
      and status = 'validated'
      and coalesce(ended_at, started_at) >= date_trunc('month', now())
  )
  select
    me.id,
    me.display_name,
    -- Initials from the display name, capped at two. "Climber #0472" gives "C",
    -- which is what the avatar in the mockup shows for a guest.
    upper(substr(regexp_replace(me.display_name, '[^a-zA-Z ]', '', 'g'), 1, 1))
      || coalesce(upper(substr(split_part(
           trim(regexp_replace(me.display_name, '[^a-zA-Z ]', '', 'g')), ' ', 2), 1, 1)), ''),
    me.explorer_number,
    me.city_name,
    -- The first five hundred people in a city keep the standing permanently.
    me.explorer_number is not null and me.explorer_number <= 500,
    lvl.n,
    (lvl.total - xp_floor_for_level(lvl.n))::integer,
    (xp_floor_for_level(lvl.n + 1) - xp_floor_for_level(lvl.n))::integer,
    lvl.total,
    held.badges, held.numbers, held.spots,
    sets_done.n,
    month_treks.n
  from me, lvl, held, sets_done, month_treks;
$$;

-- ---------------------------------------------------------------------------
-- Collection (screen 13)
-- ---------------------------------------------------------------------------

create or replace function my_collection()
returns table (
  owned                integer,
  total                integer,
  common_held          integer,
  rare_held            integer,
  epic_held            integer,
  legendary_held       integer,
  numbers_held         integer,
  best_number          integer,
  best_number_location text,
  sets_completed       integer,
  sets_total           integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with mine as (
    select c.pioneer_number, l.rarity, l.name
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = auth.uid()
  ),
  best as (
    select pioneer_number, name from mine
    where pioneer_number is not null
    order by pioneer_number
    limit 1
  ),
  sets_done as (
    select count(*)::integer as n
    from (
      select l.set_id
      from locations l
      where l.set_id is not null and l.status = 'open'
      group by l.set_id
      having count(*) = count(*) filter (
        where exists (select 1 from claims c
                      where c.location_id = l.id and c.user_id = auth.uid())
      )
    ) s
  )
  select
    (select count(*) from mine)::integer,
    -- Secret spots are excluded from the denominator: a total that counts
    -- places you are not allowed to be told about is not a total.
    (select count(*) from locations where status = 'open' and not is_secret)::integer,
    (select count(*) from mine where rarity = 'common')::integer,
    (select count(*) from mine where rarity = 'rare')::integer,
    (select count(*) from mine where rarity = 'epic')::integer,
    (select count(*) from mine where rarity = 'legendary')::integer,
    (select count(*) from mine where pioneer_number is not null)::integer,
    (select pioneer_number from best),
    (select name from best),
    (select n from sets_done),
    (select count(*) from location_sets)::integer;
$$;

-- Ordered by closeness to completion, which is the order that gets people out
-- of the house. A set you have never touched is last, not first.
create or replace function my_set_progress()
returns table (
  set_id   uuid,
  key      text,
  name     text,
  colour   text,
  held     integer,
  total    integer,
  next_location_id   uuid,
  next_location_name text,
  next_location_difficulty smallint
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with counted as (
    select s.id, s.key, s.name, s.colour, s.sort_order,
           count(l.id)::integer as total,
           count(l.id) filter (
             where exists (select 1 from claims c
                           where c.location_id = l.id and c.user_id = auth.uid())
           )::integer as held
    from location_sets s
    left join locations l on l.set_id = s.id and l.status = 'open' and not l.is_secret
    group by s.id, s.key, s.name, s.colour, s.sort_order
  )
  select c.id, c.key, c.name, c.colour, c.held, c.total,
         nxt.id, nxt.name, nxt.difficulty
  from counted c
  left join lateral (
    -- Easiest unclaimed first: this is the row that answers "what could I do
    -- this weekend", so it should not open on the hardest thing in the set.
    select l.id, l.name, l.difficulty
    from locations l
    where l.set_id = c.id and l.status = 'open' and not l.is_secret
      and not exists (select 1 from claims cl
                      where cl.location_id = l.id and cl.user_id = auth.uid())
    order by l.difficulty, l.name
    limit 1
  ) nxt on true
  order by
    case when c.total = 0 then 1 when c.held = 0 then 1 else 0 end,
    (c.total - c.held),
    c.sort_order;
$$;

-- The three most recent badges, for the strip on Collect and the featured
-- slots on Profile.
create or replace function my_recent_badges(p_limit integer default 3)
returns table (
  claim_id       uuid,
  location_id    uuid,
  slug           text,
  name           text,
  rarity         rarity,
  set_key        text,
  set_colour     text,
  pioneer_number integer,
  claimed_at     timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select c.id, l.id, l.slug, l.name, l.rarity, s.key, s.colour,
         c.pioneer_number, c.claimed_at
  from claims c
  join locations l on l.id = c.location_id
  left join location_sets s on s.id = l.set_id
  where c.user_id = auth.uid()
  order by c.claimed_at desc
  limit greatest(1, least(p_limit, 50));
$$;

-- ---------------------------------------------------------------------------
-- League (screens 21 and 24)
-- ---------------------------------------------------------------------------

create or replace function my_league()
returns table (
  league_id           uuid,
  period              date,
  tier                text,
  tier_name           text,
  tier_index          integer,
  tier_count          integer,
  rank                integer,
  division_size       integer,
  points              integer,
  treks               integer,
  distance_m          numeric,
  promotion_cutoff    integer,
  relegation_cutoff   integer,
  points_to_promotion integer,
  points_to_safety    integer,
  resets_on           date,
  days_left           integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with period as (select date_trunc('month', now())::date as p),
  mine as (
    select lm.*, l.id as lid, l.period, l.tier
    from league_members lm
    join leagues l on l.id = lm.league_id
    where lm.user_id = auth.uid() and l.period = (select p from period)
  ),
  ranked as (
    select lm.user_id, lm.points,
           row_number() over (order by lm.points desc, lm.joined_at, lm.user_id)::integer as rank
    from league_members lm
    where lm.league_id = (select lid from mine)
  ),
  me as (select * from ranked where user_id = auth.uid()),
  -- The score sitting in the last promotion slot, and in the first safe slot
  -- above the drop. Both are "what would it take", which is the only form of
  -- this number anyone acts on.
  cutoffs as (
    select
      (select points from ranked where rank = 8) as promo_points,
      (select points from ranked where rank = 34) as safe_points,
      (select count(*)::integer from ranked) as size
  )
  select
    mine.lid,
    mine.period,
    mine.tier,
    t.name,
    t.sort_order,
    (select count(*)::integer from league_tiers),
    me.rank,
    cutoffs.size,
    mine.points,
    mine.treks,
    mine.distance_m,
    8,
    35,
    -- Already inside the promotion places, or in a division that has not
    -- filled to eight yet, means there is nothing to close. Zero rather than a
    -- negative: "0 pts to promotion" is a true statement and "-240" is a puzzle.
    case when me.rank <= 8 or cutoffs.promo_points is null then 0
         else greatest(0, cutoffs.promo_points - mine.points + 1) end,
    case when me.rank >= 35 and cutoffs.safe_points is not null
      then greatest(0, cutoffs.safe_points - mine.points + 1)
      else 0 end,
    (mine.period + interval '1 month')::date,
    (mine.period + interval '1 month')::date - now()::date
  from mine
  join league_tiers t on t.key = mine.tier
  cross join cutoffs
  cross join me;
$$;

-- The standings window: you, plus p_around either side.
--
-- Not the whole division. Forty-two rows is a scroll nobody reads, and the
-- only rows that change behaviour are the ones you can actually catch.
create or replace function league_standings(p_around integer default 2)
returns table (
  rank       integer,
  user_id    uuid,
  name       text,
  initials   text,
  points     integer,
  treks      integer,
  distance_m numeric,
  is_you     boolean
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with my_league_id as (
    select lm.league_id
    from league_members lm
    join leagues l on l.id = lm.league_id
    where lm.user_id = auth.uid()
      and l.period = date_trunc('month', now())::date
  ),
  ranked as (
    select
      row_number() over (order by lm.points desc, lm.joined_at, lm.user_id)::integer as rank,
      lm.user_id, lm.points, lm.treks, lm.distance_m,
      p.display_name
    from league_members lm
    join profiles p on p.id = lm.user_id
    where lm.league_id = (select league_id from my_league_id)
  ),
  me as (select rank from ranked where user_id = auth.uid())
  select
    r.rank, r.user_id, r.display_name,
    upper(substr(regexp_replace(r.display_name, '[^a-zA-Z ]', '', 'g'), 1, 1))
      || coalesce(upper(substr(split_part(
           trim(regexp_replace(r.display_name, '[^a-zA-Z ]', '', 'g')), ' ', 2), 1, 1)), ''),
    r.points, r.treks, r.distance_m,
    r.user_id = auth.uid()
  from ranked r, me
  where r.rank between me.rank - greatest(0, p_around) and me.rank + greatest(0, p_around)
  order by r.rank;
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

alter table leagues        enable row level security;
alter table league_members enable row level security;
alter table league_tiers   enable row level security;

drop policy if exists "tiers are public" on league_tiers;
create policy "tiers are public" on league_tiers for select using (true);

-- A division is readable by the people in it. Not world-readable: there is no
-- screen that shows someone else's division, and "public" here would let a
-- scraper reconstruct every account's monthly activity.
--
-- The membership test has to be SECURITY DEFINER. A policy on league_members
-- whose USING clause selects from league_members re-enters its own policy and
-- Postgres raises "infinite recursion detected in policy". Definer rights skip
-- RLS on the inner read, which breaks the cycle. It leaks nothing: it answers
-- one boolean about the caller's own membership and takes no user argument.
create or replace function in_league(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from league_members
    where league_id = p_league_id and user_id = auth.uid()
  );
$$;

drop policy if exists "own divisions" on leagues;
create policy "own divisions" on leagues
  for select using (in_league(id));

drop policy if exists "own division members" on league_members;
create policy "own division members" on league_members
  for select using (in_league(league_id));

revoke all on function my_profile()            from public;
revoke all on function my_collection()         from public;
revoke all on function my_set_progress()       from public;
revoke all on function my_recent_badges(integer) from public;
revoke all on function my_league()             from public;
revoke all on function league_standings(integer) from public;
revoke all on function league_for_user(uuid, date) from public;
revoke all on function in_league(uuid) from public;
revoke all on function allocate_explorer_number(uuid, uuid) from public;

grant execute on function my_profile()            to authenticated;
grant execute on function my_collection()         to authenticated;
grant execute on function my_set_progress()       to authenticated;
grant execute on function my_recent_badges(integer) to authenticated;
grant execute on function my_league()             to authenticated;
grant execute on function league_standings(integer) to authenticated;
grant execute on function in_league(uuid) to authenticated;

commit;
