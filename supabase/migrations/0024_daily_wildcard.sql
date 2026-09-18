-- Summit: the Wildcard game — Wordle for places.
--
-- The app picks one open, non-secret location per user per day, biased
-- toward places few people have claimed yet (the actual point of this
-- feature: 312+ dots on a map with no reason to prefer one is choice
-- paralysis, and this quietly steers people away from the same handful of
-- popular pins). It never says which one: my_wildcard() withholds the
-- name/slug/set until the matching claim lands, and no RPC anywhere ever
-- sends its coordinates to the client. wildcard_bearing() is the only way a
-- caller learns anything about where it is — a live distance and compass
-- bearing computed here, from wherever the caller says they currently are,
-- against the real geometry that never leaves Postgres. That is what makes
-- this a hunt (find it) rather than a checklist item (walk to this pin).
--
-- Claiming that exact location within 24 hours of the pick pays a flat
-- bonus, on top of everything else that claim already earns. One reroll is
-- allowed per day, only before it's claimed.
--
-- Secret spots are excluded from the picker on purpose: their coordinates
-- are already fuzzed for a *different* hunt (see secret_spots_near()), and
-- stacking one hidden-location mechanic on top of another buys nothing.
--
-- Reuses almost everything: the location table, the points ledger, the
-- existing claim path. The only new state is "which location, which day,
-- rerolled yet, claimed yet" — one narrow table plus three RPCs plus one new
-- branch in the points trigger that already runs on every claim.

begin;
set local search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create table if not exists daily_wildcards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- UTC calendar date, not a timestamp: "one per day" is meant literally.
  -- The 24-hour claim window is tracked separately via assigned_at, so a
  -- pick made at 23:50 still gets a real 24 hours rather than 10 minutes.
  wildcard_date date not null,
  location_id   uuid not null references locations(id) on delete cascade,
  assigned_at   timestamptz not null default now(),
  rerolled      boolean not null default false,
  -- Set by award_claim_points() below the moment the matching claim lands.
  -- Left dangling (set null) rather than cascading if a claim is ever
  -- deleted — the historical fact "a wildcard was picked that day" outlives
  -- any one claim row.
  claim_id      uuid references claims(id) on delete set null,

  unique (user_id, wildcard_date)
);

create index if not exists daily_wildcards_user_idx on daily_wildcards (user_id, wildcard_date desc);

alter table daily_wildcards enable row level security;
-- No policies: my_wildcard() and reroll_wildcard() below are the only way in
-- or out, same convention as every other table in this schema.

alter table points_ledger drop constraint if exists points_ledger_source_check;
alter table points_ledger add constraint points_ledger_source_check
  check (source in (
    'distance', 'moving_time', 'badge', 'new_route', 'difficulty',
    'secret_spot', 'beat_average', 'set_complete', 'league_top', 'wildcard'
  ));

-- ---------------------------------------------------------------------------
-- Read + lazy-assign: my_wildcard()
-- ---------------------------------------------------------------------------
--
-- Not a plain read: the first call each day creates that day's row. Every
-- other read API in this schema is a pure `language sql stable` query
-- because reading someone's badges or profile should never have a side
-- effect — this one necessarily does (a game with no assignment step isn't
-- a game), so it's plpgsql and not marked stable.
--
-- rarity/difficulty are real hints ("Epic, Difficulty 3" narrows the hunt a
-- little, same as a Wordle tile turning yellow) — name/slug/set_key/set_name
-- are the actual answer and stay null until `claimed`, at which point they
-- become the reveal (see trek/arrival.tsx's use of this same function to
-- draw the badge once a Wildcard claim lands).

create or replace function my_wildcard()
returns table (
  wildcard_id uuid,
  location_id uuid,
  slug        text,
  name        text,
  rarity      rarity,
  difficulty  smallint,
  set_key     text,
  set_name    text,
  assigned_at timestamptz,
  expires_at  timestamptz,
  rerolled    boolean,
  claimed     boolean
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_today  date := (now() at time zone 'utc')::date;
  v_row    daily_wildcards%rowtype;
  v_pick   uuid;
begin
  select * into v_row from daily_wildcards
  where user_id = auth.uid() and wildcard_date = v_today;

  if not found then
    select l.id into v_pick
    from locations l
    where l.status = 'open'
      and not l.is_secret
      and not exists (
        select 1 from claims c where c.user_id = auth.uid() and c.location_id = l.id
      )
    order by l.pioneer_taken asc, random()
    limit 1;

    -- Nothing left to pick (every open, non-secret location already
    -- claimed) — no row today rather than a nonsense repeat.
    if v_pick is null then
      return;
    end if;

    insert into daily_wildcards (user_id, wildcard_date, location_id)
    values (auth.uid(), v_today, v_pick)
    returning * into v_row;
  end if;

  return query
  select
    v_row.id, l.id,
    case when v_row.claim_id is not null then l.slug end,
    case when v_row.claim_id is not null then l.name end,
    l.rarity, l.difficulty,
    case when v_row.claim_id is not null then s.key end,
    case when v_row.claim_id is not null then s.name end,
    v_row.assigned_at, v_row.assigned_at + interval '24 hours', v_row.rerolled,
    v_row.claim_id is not null
  from locations l
  left join location_sets s on s.id = l.set_id
  where l.id = v_row.location_id;
end;
$$;

revoke all on function my_wildcard() from public;
grant execute on function my_wildcard() to authenticated;

-- ---------------------------------------------------------------------------
-- wildcard_bearing(): the only clue — live distance + direction, never the
-- coordinates themselves
-- ---------------------------------------------------------------------------
--
-- Takes wherever the caller says they currently are and returns how far and
-- which way today's (still-unclaimed) pick is from there — the real
-- geometry is read and compared server-side and never once leaves this
-- function. Meant to be polled every few seconds while walking (see
-- trek/live.tsx), the same way a metal detector gets louder: distance
-- shrinks, bearing updates, and the true point is never actually shown.
--
-- bearing_deg is degrees clockwise from true north (0-360), i.e. "which way
-- to walk if you were facing north" — trek/live.tsx combines it with the
-- device's own compass heading to rotate an arrow to the *relative* screen
-- direction, since that's what's actually walkable, not a raw heading
-- number. Null bearing (points coincident) only happens standing right on
-- top of it, at which point distance_m is already ~0 and claim_location()'s
-- own dwell check is what actually confirms arrival — this is a clue, not a
-- claim mechanism.
--
-- No rows at all (rather than an error) once there is nothing left to find:
-- no wildcard assigned yet today, or today's is already claimed.

create or replace function wildcard_bearing(p_lat double precision, p_lng double precision)
returns table (
  distance_m  double precision,
  bearing_deg double precision
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    st_distance(l.geom, st_point(p_lng, p_lat)::geography),
    mod(
      degrees(st_azimuth(
        st_point(p_lng, p_lat)::geography::geometry,
        l.geom::geometry
      ))::numeric + 360, 360
    )::double precision
  from daily_wildcards w
  join locations l on l.id = w.location_id
  where w.user_id = auth.uid()
    and w.wildcard_date = (now() at time zone 'utc')::date
    and w.claim_id is null;
$$;

revoke all on function wildcard_bearing(double precision, double precision) from public;
grant execute on function wildcard_bearing(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- reroll_wildcard(): once per day, only before it's claimed
-- ---------------------------------------------------------------------------

create or replace function reroll_wildcard()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_row   daily_wildcards%rowtype;
  v_pick  uuid;
begin
  select * into v_row from daily_wildcards
  where user_id = auth.uid() and wildcard_date = v_today
  for update;

  if not found then
    raise exception 'no wildcard assigned yet today' using errcode = 'P0001';
  end if;
  if v_row.rerolled then
    raise exception 'already rerolled today''s wildcard' using errcode = 'P0001';
  end if;
  if v_row.claim_id is not null then
    raise exception 'today''s wildcard is already claimed' using errcode = 'P0001';
  end if;

  select l.id into v_pick
  from locations l
  where l.status = 'open'
    and not l.is_secret
    and l.id <> v_row.location_id
    and not exists (
      select 1 from claims c where c.user_id = auth.uid() and c.location_id = l.id
    )
  order by l.pioneer_taken asc, random()
  limit 1;

  if v_pick is null then
    raise exception 'nothing else to reroll to' using errcode = 'P0001';
  end if;

  update daily_wildcards set location_id = v_pick, rerolled = true where id = v_row.id;
end;
$$;

revoke all on function reroll_wildcard() from public;
grant execute on function reroll_wildcard() to authenticated;

-- ---------------------------------------------------------------------------
-- The bonus itself: one new branch in the trigger every claim already fires
-- ---------------------------------------------------------------------------
--
-- Flat, like secret_spot/beat_average/set_complete — not multiplied by the
-- personal-best/partner/streak multipliers those computed above apply only
-- to activity-specific (distance/moving_time) rows.

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

  -- 0024: the Wildcard bonus. Flat, on top of whatever else this claim
  -- already earns, matching the "for bonus points" pitch — this is on top
  -- of a normal claim, not instead of one.
  c_xp_wildcard     constant integer := 50;
  c_mo_wildcard     constant integer := 100;

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
  values (new.user_id, new.trek_id, new.id, 'badge', 'xp', round(c_xp_badge * v_mult_xp)::integer);
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'monthly', round(c_mo_badge * v_mult_mo)::integer);

  if v_location.set_id is not null then
    v_is_new_route := not exists (
      select 1 from claims c
      join locations l on l.id = c.location_id
      where c.user_id = new.user_id and c.id <> new.id and l.set_id = v_location.set_id
    );

    if v_is_new_route then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', 'xp', round(c_xp_new_route * v_mult_xp)::integer);
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', 'monthly', round(c_mo_new_route * v_mult_mo)::integer);
    end if;

    select count(*) into v_set_total
    from locations where set_id = v_location.set_id and status = 'open';

    select count(*) into v_set_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.set_id = v_location.set_id and l.status = 'open';

    if v_set_total > 0 and v_set_held >= v_set_total then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', 'xp', c_xp_set_complete);
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', 'monthly', c_mo_set_complete);
    end if;
  end if;

  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'xp', c_xp_difficulty[v_location.difficulty]);
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'monthly', c_mo_difficulty[v_location.difficulty]);

  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'secret_spot', 'monthly', c_mo_secret_spot);
  end if;

  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'beat_average', 'monthly', c_mo_beat_average);
  end if;

  -- Wildcard: this exact location, still within 24 hours of being picked,
  -- not already claimed against a wildcard row (a location can only ever be
  -- claimed once per user anyway — claims' own unique(user_id, location_id)
  -- — so "not already claimed" here is really "not already backfilled",
  -- which for update can't happen twice; the guard is for clarity, not a
  -- race this function needs to win).
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
    values (new.user_id, new.trek_id, new.id, 'wildcard', 'xp', c_xp_wildcard);
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'wildcard', 'monthly', c_mo_wildcard);

    update daily_wildcards set claim_id = new.id where id = v_wildcard.id;
  end if;

  return new;
end;
$$;

commit;
