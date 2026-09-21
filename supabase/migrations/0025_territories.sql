-- Summit: Capture Territory — game logic only, no map visual yet.
--
-- A territory is a small, curated cluster of 3-4 geographically close
-- locations (distinct from location_sets, which group by theme — "Trails",
-- "Coastal" — not proximity; a set can span continents, a territory never
-- should). Claim every location in one and it's captured: the time between
-- your first claim in the cluster and the one that completes it is banked,
-- and territory_leaderboard() ranks the fastest captures for that territory.
--
-- Deliberately scoped down from the full pitch: the map is not going grey/
-- clearing yet (that's a real rendering project of its own — polygon
-- overlays, progressive reveal — and belongs in its own pass once this half
-- is solid). This is the data model, the capture detection, the time
-- tracking, and a read API a list screen can be built against, same shape
-- as sets already are.
--
-- Membership is one-territory-per-location (locations.territory_id, exactly
-- like locations.set_id already works) rather than a join table: a location
-- being in two different "nearby cluster" territories at once has no
-- sensible meaning the way a location being in two thematic sets already
-- does not either.
--
-- Curation, not an on-the-fly clustering algorithm: create_territory() is
-- admin-only (reuses profiles.is_admin from 0022) and takes an explicit
-- 3-4 location ids, the same "a human decides which 3-4 belong together"
-- trust level suggestion review already has for turning a suggestion into a
-- location. A handful of starter territories are auto-detected separately,
-- in seed/0004_territories.sql (this migration runs before locations are
-- even seeded, so it cannot do that itself) — tightly grouped locations
-- within ~2km of each other, capped at a few, so the feature has something
-- to look at without an admin doing that by hand first.

begin;
set local search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create table if not exists territories (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id) on delete cascade,
  name       text not null,
  -- Centroid of its member locations at creation time. Not kept in sync if
  -- membership ever changed after the fact (it can't today — nothing here
  -- removes a location from a territory once assigned), and unused until
  -- the map-visual pass; stored now so that pass doesn't need a schema
  -- change just to read a spot to draw.
  centre     geography(Point, 4326),
  created_at timestamptz not null default now()
);

alter table locations add column if not exists territory_id uuid references territories(id) on delete set null;
create index if not exists locations_territory_idx on locations (territory_id) where territory_id is not null;

create table if not exists territory_captures (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  territory_id uuid not null references territories(id) on delete cascade,
  -- The earliest of this user's claims among the territory's locations, not
  -- necessarily "when they set out that day" — the honest, derivable
  -- definition of "time taken to claim this area" given what's actually on
  -- the ledger (claimed_at per claim), same standard my_treks()/badges
  -- already hold everything else in this schema to.
  started_at   timestamptz not null,
  captured_at  timestamptz not null default now(),
  duration_s   integer not null,

  unique (user_id, territory_id)
);

create index if not exists territory_captures_leaderboard_idx on territory_captures (territory_id, duration_s);

alter table territories enable row level security;
alter table territory_captures enable row level security;
-- No policies on either: the RPCs below are the only way in or out, same
-- convention as every other table in this schema.

alter table points_ledger drop constraint if exists points_ledger_source_check;
alter table points_ledger add constraint points_ledger_source_check
  check (source in (
    'distance', 'moving_time', 'badge', 'new_route', 'difficulty',
    'secret_spot', 'beat_average', 'set_complete', 'league_top', 'wildcard',
    'territory_capture'
  ));

-- ---------------------------------------------------------------------------
-- create_territory(): the admin-only way to curate one
-- ---------------------------------------------------------------------------
--
-- No auto-clustering here — a migration runs before locations are even
-- seeded (see deploy.sh/tests/run.sh: migrations, then
-- seed/0001_world_locations.sql), so there is nothing yet to cluster.
-- seed/0004_territories.sql runs an ST_ClusterDBSCAN pass after that seed
-- purely to give the feature some starter content; this function is the
-- real, ongoing way an admin turns 3-4 specific locations into one.

create or replace function create_territory(p_name text, p_location_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_count        integer;
  v_distinct     integer;
  v_city_id      uuid;
  v_territory_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_count := coalesce(array_length(p_location_ids, 1), 0);
  if v_count < 3 or v_count > 4 then
    raise exception 'a territory needs 3 or 4 locations' using errcode = 'P0001';
  end if;

  select count(distinct id) into v_distinct from locations where id = any(p_location_ids);
  if v_distinct <> v_count then
    raise exception 'unknown or duplicate location id' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from locations
    where id = any(p_location_ids)
      and (status <> 'open' or is_secret or territory_id is not null)
  ) then
    raise exception 'every location must be open, public, and not already in a territory' using errcode = 'P0001';
  end if;

  select city_id into v_city_id from locations where id = p_location_ids[1];

  insert into territories (city_id, name, centre)
  select v_city_id, p_name, st_centroid(st_collect(geom::geometry))::geography
  from locations where id = any(p_location_ids)
  returning id into v_territory_id;

  update locations set territory_id = v_territory_id where id = any(p_location_ids);

  return v_territory_id;
end;
$$;

revoke all on function create_territory(text, uuid[]) from public;
grant execute on function create_territory(text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Read APIs
-- ---------------------------------------------------------------------------

-- Ordered the same way my_set_progress() already is: closest to completion
-- first, an untouched territory last.
create or replace function my_territories()
returns table (
  territory_id    uuid,
  name            text,
  held            integer,
  total           integer,
  captured        boolean,
  duration_s      integer,
  best_duration_s integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with counted as (
    select t.id, t.name,
           count(l.id)::integer as total,
           count(l.id) filter (
             where exists (select 1 from claims c where c.location_id = l.id and c.user_id = auth.uid())
           )::integer as held
    from territories t
    left join locations l on l.territory_id = t.id and l.status = 'open' and not l.is_secret
    group by t.id, t.name
  )
  select
    c.id, c.name, c.held, c.total,
    tc.id is not null,
    tc.duration_s,
    (select min(duration_s) from territory_captures where territory_id = c.id)
  from counted c
  left join territory_captures tc on tc.territory_id = c.id and tc.user_id = auth.uid()
  order by
    case when c.total = 0 then 1 when c.held = 0 then 1 else 0 end,
    c.held desc,
    c.name;
$$;

revoke all on function my_territories() from public;
grant execute on function my_territories() to authenticated;

-- Same shape as set_locations() (0020): every member location, whether this
-- caller already holds it.
create or replace function territory_locations(p_territory_id uuid)
returns table (
  id             uuid,
  name           text,
  slug           text,
  rarity         rarity,
  difficulty     smallint,
  claimed        boolean,
  pioneer_number integer,
  claimed_at     timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    l.id, l.name, l.slug, l.rarity, l.difficulty,
    c.id is not null,
    c.pioneer_number,
    c.claimed_at
  from locations l
  left join claims c on c.location_id = l.id and c.user_id = auth.uid()
  where l.territory_id = p_territory_id
    and not l.is_secret
  order by (c.id is null), c.claimed_at desc nulls last, l.difficulty, l.name;
$$;

revoke all on function territory_locations(uuid) from public;
grant execute on function territory_locations(uuid) to authenticated;

-- The fastest captures for one territory. Public within the app the same
-- way league standings already name other users — nothing here is a
-- narrower disclosure than that.
create or replace function territory_leaderboard(p_territory_id uuid, p_limit integer default 20)
returns table (
  rank         integer,
  display_name text,
  duration_s   integer,
  captured_at  timestamptz,
  is_you       boolean
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    row_number() over (order by tc.duration_s asc)::integer,
    p.display_name,
    tc.duration_s,
    tc.captured_at,
    tc.user_id = auth.uid()
  from territory_captures tc
  join profiles p on p.id = tc.user_id
  where tc.territory_id = p_territory_id
  order by tc.duration_s asc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function territory_leaderboard(uuid, integer) from public;
grant execute on function territory_leaderboard(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Capture detection: one new branch in the trigger every claim already fires
-- ---------------------------------------------------------------------------
--
-- Flat bonus, like set_complete — not multiplied by the personal-best/
-- partner/streak multipliers, which apply only to activity-specific
-- (distance/moving_time) rows. Smaller than set_complete's 400/80 on
-- purpose: a territory is 3-4 locations, not a whole themed collection.

create or replace function award_claim_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_xp_per_300m     constant integer := 20;
  c_xp_per_minute   constant integer := 4;
  c_xp_badge        constant integer := 20;
  c_xp_new_route    constant integer := 6;

  c_mo_per_300m     constant integer := 28;
  c_mo_per_minute   constant integer := 8;
  c_mo_badge        constant integer := 40;
  c_mo_new_route    constant integer := 12;
  c_mo_secret_spot  constant integer := 16;
  c_mo_beat_average constant integer := 20;

  c_xp_set_complete constant integer := 400;
  c_mo_set_complete constant integer := 80;
  c_xp_difficulty   constant integer[] := array[40, 72, 130, 235];
  c_mo_difficulty   constant integer[] := array[40, 88, 140, 196];

  c_xp_wildcard     constant integer := 50;
  c_mo_wildcard     constant integer := 100;

  -- 0025: Capture Territory's bonus, paid once per user per territory.
  c_xp_territory    constant integer := 60;
  c_mo_territory    constant integer := 120;

  c_pb_mult_xp      constant numeric := 1.5;
  c_pb_mult_monthly constant numeric := 2.0;
  c_partner_mult    constant numeric := 1.2;
  c_streak_mult     constant numeric := 2.0;
  c_multiplier_cap  constant numeric := 3.0;

  v_trek      treks%rowtype;
  v_location  locations%rowtype;
  v_set_total integer;
  v_set_held  integer;
  v_is_pb     boolean := false;
  v_streak3   boolean := false;
  v_mult_xp   numeric := 1;
  v_mult_mo   numeric := 1;
  v_is_new_route boolean := false;
  v_wildcard  daily_wildcards%rowtype;
  v_terr_total   integer;
  v_terr_held    integer;
  v_terr_started timestamptz;
begin
  select * into v_location from locations where id = new.location_id;
  select * into v_trek     from treks     where id = new.trek_id;

  if v_trek.id is not null then
    v_is_pb := coalesce(v_trek.distance_m, 0) > coalesce((
      select max(distance_m) from treks
      where user_id = new.user_id and status = 'validated' and id <> v_trek.id
    ), 0);

    v_streak3 :=
      exists (
        select 1 from treks t
        where t.user_id = new.user_id and t.status = 'validated'
          and date_trunc('day', t.started_at) = date_trunc('day', v_trek.started_at) - interval '1 day'
      )
      and exists (
        select 1 from treks t
        where t.user_id = new.user_id and t.status = 'validated'
          and date_trunc('day', t.started_at) = date_trunc('day', v_trek.started_at) - interval '2 days'
      );

    v_mult_xp := least(c_multiplier_cap,
      (case when v_is_pb then c_pb_mult_xp else 1 end) *
      (case when v_trek.with_partner then c_partner_mult else 1 end));

    v_mult_mo := least(c_multiplier_cap,
      (case when v_is_pb then c_pb_mult_monthly else 1 end) *
      (case when v_trek.with_partner then c_partner_mult else 1 end) *
      (case when v_streak3 then c_streak_mult else 1 end));
  end if;

  if v_trek.id is not null then
    if coalesce(v_trek.distance_m, 0) >= 100 then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'distance', 'xp',
              round(floor(v_trek.distance_m / 300)::integer * c_xp_per_300m * v_mult_xp)::integer)
      on conflict do nothing;

      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'distance', 'monthly',
              round(floor(v_trek.distance_m / 300)::integer * c_mo_per_300m * v_mult_mo)::integer)
      on conflict do nothing;
    end if;

    if coalesce(v_trek.moving_time_s, 0) >= 60 then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'moving_time', 'xp',
              round(floor(v_trek.moving_time_s / 60)::integer * c_xp_per_minute * v_mult_xp)::integer)
      on conflict do nothing;

      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'moving_time', 'monthly',
              round(floor(v_trek.moving_time_s / 60)::integer * c_mo_per_minute * v_mult_mo)::integer)
      on conflict do nothing;
    end if;
  end if;

  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'xp', round(c_xp_badge * v_mult_xp)::integer)
  on conflict do nothing;
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'monthly', round(c_mo_badge * v_mult_mo)::integer)
  on conflict do nothing;

  if v_location.set_id is not null then
    v_is_new_route := not exists (
      select 1 from claims c
      join locations l on l.id = c.location_id
      where c.user_id = new.user_id and c.id <> new.id and l.set_id = v_location.set_id
    );

    if v_is_new_route then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', 'xp', round(c_xp_new_route * v_mult_xp)::integer)
      on conflict do nothing;
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', 'monthly', round(c_mo_new_route * v_mult_mo)::integer)
      on conflict do nothing;
    end if;

    select count(*) into v_set_total
    from locations where set_id = v_location.set_id and status = 'open';

    select count(*) into v_set_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.set_id = v_location.set_id and l.status = 'open';

    if v_set_total > 0 and v_set_held >= v_set_total then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', 'xp', c_xp_set_complete)
      on conflict do nothing;
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', 'monthly', c_mo_set_complete)
      on conflict do nothing;
    end if;
  end if;

  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'xp', c_xp_difficulty[v_location.difficulty])
  on conflict do nothing;
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'monthly', c_mo_difficulty[v_location.difficulty])
  on conflict do nothing;

  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'secret_spot', 'monthly', c_mo_secret_spot)
    on conflict do nothing;
  end if;

  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'beat_average', 'monthly', c_mo_beat_average)
    on conflict do nothing;
  end if;

  -- Wildcard: this exact location, still within 24 hours of being picked,
  -- not already claimed against a wildcard row.
  select * into v_wildcard
  from daily_wildcards
  where user_id = new.user_id
    and location_id = new.location_id
    and claim_id is null
    and now() <= assigned_at + interval '24 hours'
  order by assigned_at desc
  limit 1
  for update;

  if found then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'wildcard', 'xp', c_xp_wildcard)
    on conflict do nothing;
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'wildcard', 'monthly', c_mo_wildcard)
    on conflict do nothing;

    update daily_wildcards set claim_id = new.id where id = v_wildcard.id;
  end if;

  -- Territory: every location in the cluster now held, and not already
  -- captured by this user (unique(user_id, territory_id) would refuse a
  -- second insert anyway; the exists check keeps this idempotent without
  -- relying on catching that constraint violation).
  if v_location.territory_id is not null
     and not exists (
       select 1 from territory_captures
       where user_id = new.user_id and territory_id = v_location.territory_id
     ) then
    select count(*) into v_terr_total
    from locations where territory_id = v_location.territory_id and status = 'open' and not is_secret;

    select count(*) into v_terr_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.territory_id = v_location.territory_id
      and l.status = 'open' and not l.is_secret;

    if v_terr_total > 0 and v_terr_held >= v_terr_total then
      select min(c.claimed_at) into v_terr_started
      from claims c
      join locations l on l.id = c.location_id
      where c.user_id = new.user_id and l.territory_id = v_location.territory_id;

      insert into territory_captures (user_id, territory_id, started_at, captured_at, duration_s)
      values (
        new.user_id, v_location.territory_id, v_terr_started, new.claimed_at,
        greatest(0, extract(epoch from (new.claimed_at - v_terr_started)))::integer
      );

      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'territory_capture', 'xp', c_xp_territory)
      on conflict do nothing;
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'territory_capture', 'monthly', c_mo_territory)
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$$;

commit;
