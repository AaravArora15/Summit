-- Summit: identity, points, and the league.
--
-- Three gaps this closes, in the order they break the app:
--
--   1. No profile row was ever created. `handle_new_user` is the missing half
--      of anonymous sign-in: session.ts creates an auth.users row, nothing
--      created the profiles row beside it, and `claim_explorer_number()` has
--      been silently updating zero rows ever since.
--
--   2. No points were ever awarded. `points_ledger` has existed since 0001 and
--      nothing has written to it: claim_location() allocates a number and
--      returns. Scoring lives here, in a trigger on claims, rather than inside
--      claim_location() so the 200-line validation function is not re-declared
--      every time the scoring changes.
--
--   3. The league had no tables. It is the one system the mockup shows and the
--      schema never covered.
--
-- The rule from 0001 holds throughout: the client submits a trek, the server
-- decides what it was worth. Nothing below is callable in a way that lets a
-- caller choose its own points, tier, or position.

begin;
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Identity: every auth user gets a profile and an explorer number
-- ---------------------------------------------------------------------------

-- The city a new account belongs to. Singapore is the only seeded city, but
-- reading it by name rather than hardcoding a uuid keeps the trigger correct
-- when a second city is seeded and this becomes a lookup on signup region.
create or replace function default_city_id()
returns uuid
language sql
stable
as $$
  select id from cities order by name = 'Singapore' desc, name limit 1;
$$;

-- Allocates the permanent per-city explorer number. Same shape as the pioneer
-- allocation in 0001 and for the same reason: two people signing up in the
-- same instant must not both become #0472.
--
-- Separated from claim_explorer_number() because that one reads auth.uid(),
-- which is null inside a trigger on auth.users.
create or replace function allocate_explorer_number(p_user_id uuid, p_city_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_number integer;
begin
  if p_city_id is null then
    return null;                       -- no cities seeded yet; profile still created
  end if;

  select explorer_number into v_number from profiles where id = p_user_id;
  if v_number is not null then
    return v_number;                   -- never changes, never transfers
  end if;

  perform 1 from cities where id = p_city_id for update;

  update cities
     set explorer_taken = explorer_taken + 1
   where id = p_city_id
  returning explorer_taken into v_number;

  return v_number;
end;
$$;

-- The display name for an account that has not told us anything about itself.
-- Anonymous sessions are the default path (see features/auth/session.ts), so
-- this is what most rows in the standings are named, and "User 4f2a9c" reads
-- like a database leak. "Climber #0472" is the identity the product already
-- gives them on the profile screen.
create or replace function default_display_name(p_number integer)
returns text
language sql
immutable
as $$
  select case
    when p_number is null then 'Climber'
    else 'Climber #' || lpad(p_number::text, 4, '0')
  end;
$$;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_city   uuid := default_city_id();
  v_number integer;
begin
  v_number := allocate_explorer_number(new.id, v_city);

  insert into profiles (id, display_name, home_city_id, explorer_number)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      default_display_name(v_number)
    ),
    v_city,
    v_number
  )
  on conflict (id) do nothing;

  -- Enrol immediately rather than on first points. The League tab is one of
  -- five and someone will open it before they have walked anywhere; a division
  -- you are last in is a reason to go outside, and an empty screen is not.
  perform league_for_user(new.id);

  return new;
end;
$$;

-- A failure here would block sign-up entirely, so the trigger is deliberately
-- the last thing to run and does nothing that can raise on ordinary input.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill: anyone who signed in before this migration has no profile, and
-- would otherwise be invisible to every query below.
insert into profiles (id, display_name, home_city_id, explorer_number)
select u.id,
       default_display_name(allocate_explorer_number(u.id, default_city_id())),
       default_city_id(),
       null
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id)
on conflict (id) do nothing;

-- The backfill above allocates a number but inserts null, because the number
-- must be read after the row exists to satisfy the unique constraint ordering.
-- Assign in signup order so the numbers mean what they claim to.
with numbered as (
  select p.id, row_number() over (order by u.created_at) as n
  from profiles p
  join auth.users u on u.id = p.id
  where p.explorer_number is null
)
update profiles p
   set explorer_number = numbered.n
  from numbered
 where p.id = numbered.id;

update cities c
   set explorer_taken = greatest(
     c.explorer_taken,
     (select coalesce(max(explorer_number), 0) from profiles where home_city_id = c.id)
   );

-- ---------------------------------------------------------------------------
-- 2. Points
-- ---------------------------------------------------------------------------
--
-- Every award is an itemised row, so the reward screen can show each point
-- against the thing that earned it and the total is auditable rather than
-- magical. The amounts are policy and are expected to move; they live in one
-- function so moving them is one edit.

-- Trek-level sources are per trek, not per claim. Without this, a trek that
-- claims two locations would pay for its distance twice.
create unique index if not exists points_trek_source_idx
  on points_ledger (user_id, trek_id, source)
  where trek_id is not null and source in ('distance', 'moving_time');

create or replace function award_claim_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Distance and time pay a floor rate: showing up is worth something, and it
  -- is the only source available on a walk to a place already claimed.
  c_per_100m       constant integer := 1;
  c_per_minute     constant integer := 2;

  -- Scarcity pays. A low number is the thing the product is about, and the
  -- ladder is steep on purpose: #7 should feel unlike #400.
  c_first_ten      constant integer := 500;
  c_first_hundred  constant integer := 200;
  c_pioneer        constant integer := 50;

  c_secret_spot    constant integer := 300;
  c_new_set        constant integer := 100;
  c_set_complete   constant integer := 750;
  c_beat_average   constant integer := 120;

  v_trek     treks%rowtype;
  v_location locations%rowtype;
  v_set_total integer;
  v_set_held  integer;
begin
  select * into v_location from locations where id = new.location_id;
  select * into v_trek     from treks     where id = new.trek_id;

  -- --- trek-level, once per trek --------------------------------------------

  if v_trek.id is not null then
    if coalesce(v_trek.distance_m, 0) >= 100 then
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, v_trek.id, 'distance',
              floor(v_trek.distance_m / 100)::integer * c_per_100m)
      on conflict do nothing;
    end if;

    if coalesce(v_trek.moving_time_s, 0) >= 60 then
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, v_trek.id, 'moving_time',
              floor(v_trek.moving_time_s / 60)::integer * c_per_minute)
      on conflict do nothing;
    end if;
  end if;

  -- --- the claim itself -----------------------------------------------------

  if new.pioneer_number is not null then
    insert into points_ledger (user_id, trek_id, source, amount)
    values (new.user_id, new.trek_id, 'first_discovery',
            case
              when new.pioneer_number <= 10  then c_first_ten
              when new.pioneer_number <= 100 then c_first_hundred
              else c_pioneer
            end);
  end if;

  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, source, amount)
    values (new.user_id, new.trek_id, 'secret_spot', c_secret_spot);
  end if;

  -- First location in a set you had never touched. Rewards breadth, which is
  -- what stops the sets board being six people's home reservoir.
  if v_location.set_id is not null then
    if not exists (
      select 1 from claims c
      join locations l on l.id = c.location_id
      where c.user_id = new.user_id
        and c.id <> new.id
        and l.set_id = v_location.set_id
    ) then
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, new.trek_id, 'new_route', c_new_set);
    end if;

    -- And the other end: the claim that finishes a set.
    select count(*) into v_set_total
    from locations where set_id = v_location.set_id and status = 'open';

    select count(*) into v_set_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.set_id = v_location.set_id and l.status = 'open';

    if v_set_total > 0 and v_set_held >= v_set_total then
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, new.trek_id, 'set_complete', c_set_complete);
    end if;
  end if;

  -- Faster than the posted average for the route.
  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, source, amount)
    values (new.user_id, new.trek_id, 'beat_average', c_beat_average);
  end if;

  return new;
end;
$$;

drop trigger if exists on_claim_award_points on claims;
create trigger on_claim_award_points
  after insert on claims
  for each row execute function award_claim_points();

-- ---------------------------------------------------------------------------
-- 3. The league
-- ---------------------------------------------------------------------------
--
-- Five tiers, divisions of forty-two, one month at a time. Top eight promote,
-- bottom eight relegate, which is what the rules drawn through the standings
-- on screen 21 mean.
--
-- A division is a bucket of people, not a leaderboard of everyone: forty-two
-- is small enough that a position is legible and that promotion stays possible
-- for someone who walks on weekends.

create table if not exists league_tiers (
  key        text primary key,
  name       text not null,
  sort_order integer not null unique
);

insert into league_tiers (key, name, sort_order) values
  ('trailhead', 'Trailhead', 1),
  ('foothills', 'Foothills', 2),
  ('ridgeline', 'Ridgeline', 3),
  ('highlands', 'Highlands', 4),
  ('summit',    'Summit',    5)
on conflict (key) do nothing;

-- Which tier a user is currently in. Carried between months by the rollover;
-- a new account starts at the bottom.
alter table profiles
  add column if not exists league_tier text not null default 'trailhead'
    references league_tiers(key);

create table if not exists leagues (
  id          uuid primary key default gen_random_uuid(),
  -- First of the month, in the city's local sense. Monthly is the whole point:
  -- a weekly reset punishes anyone who travels for work, an annual one is not
  -- a race.
  period      date not null,
  tier        text not null references league_tiers(key),
  division_no integer not null,
  city_id     uuid references cities(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (period, tier, division_no, city_id)
);

create table if not exists league_members (
  league_id  uuid not null references leagues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Denormalised from points_ledger by the trigger below. The ledger stays the
  -- source of truth; this exists so the standings query is an index scan
  -- rather than a sum over every point the user has ever earned.
  points     integer not null default 0,
  treks      integer not null default 0,
  distance_m numeric(12,1) not null default 0,
  joined_at  timestamptz not null default now(),
  primary key (league_id, user_id),
  -- One division per user per period. The partial unique index below enforces
  -- it across leagues, which the composite key above cannot.
  unique (user_id, league_id)
);

create index if not exists league_members_rank_idx
  on league_members (league_id, points desc, user_id);

create index if not exists leagues_period_idx on leagues (period, tier);

-- The division a user belongs to this month, creating it on first need.
--
-- SECURITY DEFINER and takes the user as an argument rather than reading
-- auth.uid(), because it is called from the points trigger, which may run
-- inside claim_location() where the effective user is already established.
create or replace function league_for_user(p_user_id uuid, p_period date default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_division_size constant integer := 42;

  v_period    date := coalesce(p_period, date_trunc('month', now())::date);
  v_tier      text;
  v_city      uuid;
  v_league    uuid;
  v_division  integer;
begin
  select coalesce(league_tier, 'trailhead'), home_city_id
    into v_tier, v_city
  from profiles where id = p_user_id;

  if v_tier is null then
    return null;                       -- no profile: nothing to join
  end if;

  select lm.league_id into v_league
  from league_members lm
  join leagues l on l.id = lm.league_id
  where lm.user_id = p_user_id and l.period = v_period;

  if v_league is not null then
    return v_league;
  end if;

  -- Lock the tier's divisions for this period so two people joining at once
  -- cannot both create division 1.
  perform 1 from leagues
   where period = v_period and tier = v_tier and city_id is not distinct from v_city
   for update;

  -- The lowest-numbered division with room. Filling in order rather than
  -- balancing keeps a half-empty division from being the norm at the top tiers.
  select l.id into v_league
  from leagues l
  where l.period = v_period and l.tier = v_tier and l.city_id is not distinct from v_city
    and (select count(*) from league_members m where m.league_id = l.id) < c_division_size
  order by l.division_no
  limit 1;

  if v_league is null then
    select coalesce(max(division_no), 0) + 1 into v_division
    from leagues
    where period = v_period and tier = v_tier and city_id is not distinct from v_city;

    insert into leagues (period, tier, division_no, city_id)
    values (v_period, v_tier, v_division, v_city)
    on conflict (period, tier, division_no, city_id) do update set tier = excluded.tier
    returning id into v_league;
  end if;

  insert into league_members (league_id, user_id)
  values (v_league, p_user_id)
  on conflict do nothing;

  return v_league;
end;
$$;

-- Points land in the league of the month they were awarded in, not the current
-- one. A trek synced from an offline phone on 2 September still counts for
-- August, which is the case this handles and the reason it reads awarded_at.
create or replace function apply_points_to_league()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_period date := date_trunc('month', new.awarded_at)::date;
  v_league uuid;
begin
  v_league := league_for_user(new.user_id, v_period);
  if v_league is null then
    return new;
  end if;

  update league_members
     set points = points + new.amount
   where league_id = v_league and user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists on_points_apply_league on points_ledger;
create trigger on_points_apply_league
  after insert on points_ledger
  for each row execute function apply_points_to_league();

-- Trek counters are separate from points: the standings show "14 treks · 62 km"
-- beside a score, and a trek that earned nothing still happened.
create or replace function apply_trek_to_league()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_period date := date_trunc('month', coalesce(new.ended_at, new.started_at))::date;
  v_league uuid;
begin
  if new.status <> 'validated' or coalesce(old.status, 'recording') = 'validated' then
    return new;
  end if;

  v_league := league_for_user(new.user_id, v_period);
  if v_league is null then
    return new;
  end if;

  update league_members
     set treks      = treks + 1,
         distance_m = distance_m + coalesce(new.distance_m, 0)
   where league_id = v_league and user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists on_trek_validated_league on treks;
create trigger on_trek_validated_league
  after update of status on treks
  for each row execute function apply_trek_to_league();

-- Enrol everyone who already has a profile into this month's division. Covers
-- both the backfill above and a re-run of this migration after a month rolls
-- over. `league_for_user` is a no-op for anyone already placed.
select league_for_user(p.id)
from profiles p
where not exists (
  select 1 from league_members m
  join leagues l on l.id = m.league_id
  where m.user_id = p.id and l.period = date_trunc('month', now())::date
);

commit;
