-- Summit: two point systems instead of one.
--
-- Every point Summit has ever awarded landed in one points_ledger, and that
-- one ledger fed both the profile's permanent XP/level bar (my_profile(),
-- 0006 — literally sum(points_ledger.amount)) and the monthly League
-- standings (apply_points_to_league(), 0005). They were never actually
-- different numbers, just the same total read two ways.
--
-- This migration gives them different rate tables, because that's what was
-- asked for: XP rewards permanence (a badge is worth XP forever), Monthly
-- rewards the things that make someone come back this month specifically
-- (streaks, secret spots, beating the posted average). Both write to the
-- same table — now tagged `system` — rather than two tables, so the
-- itemisation, the claim_id attribution from 0010, and every existing index
-- keep meaning what they meant.
--
-- Three deliberate departures from the old formula, not oversights:
--
--   1. `first_discovery` (the old pioneer-number-tiered bonus: #1-10 paid
--      500, #11-100 paid 200, the rest paid 50) is gone. The rates given for
--      this rewrite never mention a scarcity bonus — they replace it with a
--      flat per-claim `difficulty` bonus instead. Early claimers no longer
--      earn extra beyond whatever the location's own difficulty pays; the
--      permanent pioneer number itself (see claim_location() in 0001) is
--      unaffected; only its point value changes.
--   2. Two rates weren't specified for four difficulty tiers — this app has
--      Easy/Medium/Hard/Extreme, the rate list only priced three. Extreme is
--      extrapolated by continuing each list's own progression (XP steps
--      ~1.8x per tier: 40, 72, 130, so 235; Monthly's gaps grow by 4 each
--      tier: 40, 88, 140 -> +48, +52, so +56 -> 196). Both are a judgement
--      call, not a stated number.
--   3. "With one other person" (1.2x) has no verification mechanism in the
--      spec it came from. This is a self-reported toggle
--      (treks.with_partner, set from the live-trek screen), same trust level
--      device_integrity already is — not spoof-checked, which is a
--      deliberate scope cut given building partner-proximity verification
--      is its own anti-spoof project.

begin;
set local search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table points_ledger
  add column if not exists system text not null default 'monthly'
    check (system in ('xp', 'monthly'));

alter table points_ledger drop constraint if exists points_ledger_source_check;
alter table points_ledger add constraint points_ledger_source_check
  check (source in (
    'distance', 'moving_time', 'badge', 'new_route', 'difficulty',
    'secret_spot', 'beat_average', 'set_complete', 'league_top'
  ));

-- The once-per-trek guard on distance/moving_time now needs to let both an
-- xp row and a monthly row through for the same (user, trek, source) —
-- previously there was only ever one row to guard against.
drop index if exists points_trek_source_idx;
create unique index points_trek_source_idx
  on points_ledger (user_id, trek_id, source, system)
  where trek_id is not null and source in ('distance', 'moving_time');

-- Self-reported, honour system: see the migration header.
alter table treks add column if not exists with_partner boolean not null default false;

-- ---------------------------------------------------------------------------
-- award_claim_points(): rewritten for two systems
-- ---------------------------------------------------------------------------
--
-- Same overall shape as before: trek-level sources fire once per trek (the
-- unique index above, same `on conflict do nothing` pattern); claim-level
-- sources fire every claim. The multiplier (personal best, partner, streak)
-- is computed once per trek and applied to each *activity-specific* row
-- individually rather than to a summed total first — itemisation on the
-- ledger stays intact, and multiplying each addend by k and summing is the
-- same total as summing then multiplying by k. `difficulty`, `set_complete`,
-- `secret_spot` and `beat_average` are flat and never multiplied, matching
-- the "separate from activity specific points" rates they came with.

create or replace function award_claim_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Activity-specific rates, before multipliers.
  c_xp_per_300m     constant integer := 20;
  c_xp_per_minute   constant integer := 4;
  c_xp_badge        constant integer := 20;
  c_xp_new_route    constant integer := 6;

  c_mo_per_300m     constant integer := 28;
  c_mo_per_minute   constant integer := 8;
  c_mo_badge        constant integer := 40;
  c_mo_new_route    constant integer := 12;
  c_mo_secret_spot  constant integer := 16;   -- monthly only; no XP line for this
  c_mo_beat_average constant integer := 20;   -- monthly only; no XP line for this

  -- Flat, separate from activity-specific points: never multiplied.
  c_xp_set_complete constant integer := 80;
  c_mo_set_complete constant integer := 80;
  -- Indexed 1..4 by locations.difficulty (Easy/Medium/Hard/Extreme).
  c_xp_difficulty   constant integer[] := array[40, 72, 130, 235];
  c_mo_difficulty   constant integer[] := array[40, 88, 140, 196];

  -- Multipliers, capped combined at 3x, applied to activity-specific rows.
  c_pb_mult_xp      constant numeric := 1.5;
  c_pb_mult_monthly constant numeric := 2.0;
  c_partner_mult    constant numeric := 1.2;
  c_streak_mult     constant numeric := 2.0;  -- monthly only
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
begin
  select * into v_location from locations where id = new.location_id;
  select * into v_trek     from treks     where id = new.trek_id;

  -- --- multiplier inputs, evaluated once per trek --------------------------

  if v_trek.id is not null then
    v_is_pb := coalesce(v_trek.distance_m, 0) > coalesce((
      select max(distance_m) from treks
      where user_id = new.user_id and status = 'validated' and id <> v_trek.id
    ), 0);

    -- The 3rd of three consecutive calendar days with a validated trek.
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

  -- --- trek-level activity points, once per trek ---------------------------

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

  -- --- claim-level activity points, every claim ----------------------------

  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'xp', round(c_xp_badge * v_mult_xp)::integer);
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'monthly', round(c_mo_badge * v_mult_mo)::integer);

  -- First location in a set you had never touched. Rewards breadth, which is
  -- what stops the sets board being six people's home reservoir.
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

    -- And the other end: the claim that finishes a set. Flat, both systems.
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

  -- Difficulty: flat, both systems, every claim.
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'xp', c_xp_difficulty[v_location.difficulty]);
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'monthly', c_mo_difficulty[v_location.difficulty]);

  -- Secret spot: monthly only.
  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'secret_spot', 'monthly', c_mo_secret_spot);
  end if;

  -- Faster than the posted average for the route: monthly only.
  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'beat_average', 'monthly', c_mo_beat_average);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Downstream: League only reacts to monthly points
-- ---------------------------------------------------------------------------
--
-- Every claim now writes both an xp row and a monthly row. Without this
-- guard, apply_points_to_league() (0005) would add both into
-- league_members.points and every claim would count twice.

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
  if new.system <> 'monthly' then
    return new;
  end if;

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

-- ---------------------------------------------------------------------------
-- Downstream: XP on the profile is the xp system only
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
    from points_ledger where user_id = auth.uid() and system = 'xp'
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
-- Downstream: locations_near()'s points_earned is the permanent (xp) record
-- ---------------------------------------------------------------------------

create or replace function locations_near(
  p_lat    double precision,
  p_lng    double precision,
  p_radius integer default 5000
)
returns table (
  id            uuid,
  name          text,
  slug          text,
  lng           double precision,
  lat           double precision,
  set_id        uuid,
  set_key       text,
  set_name      text,
  rarity        rarity,
  difficulty    smallint,
  distance_m    double precision,
  elevation_m   real,
  pioneer_taken integer,
  pioneer_cap   integer,
  status        text,
  claimed       boolean,
  pioneer_number integer,
  points_earned integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    l.id, l.name, l.slug,
    st_x(l.geom::geometry), st_y(l.geom::geometry),
    l.set_id, s.key, s.name,
    l.rarity, l.difficulty,
    st_distance(l.geom, st_point(p_lng, p_lat)::geography) as distance_m,
    l.elevation_m,
    l.pioneer_taken, l.pioneer_cap, l.status,
    c.id is not null,
    c.pioneer_number,
    (select sum(pl.amount)::integer from points_ledger pl where pl.claim_id = c.id and pl.system = 'xp')
  from locations l
  left join location_sets s on s.id = l.set_id
  left join claims c on c.location_id = l.id and c.user_id = auth.uid()
  where not l.is_secret
    and st_dwithin(l.geom, st_point(p_lng, p_lat)::geography, p_radius)
  order by distance_m;
$$;

revoke all on function locations_near(double precision, double precision, integer) from public;
grant execute on function locations_near(double precision, double precision, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Downstream: the monthly league's #1 finisher earns a permanent XP bonus
-- ---------------------------------------------------------------------------
--
-- League rollover (0008) already knows, at the moment it runs, who ranked #1
-- in each division for the period that just ended. This awards that person
-- (or everyone tied for it) a one-time XP bonus. The "friend challenge
-- leaderboard" bonus from the same rate list is not implemented here: Groups
-- (the private-league feature it depends on) has no backend yet, so there is
-- nothing to rank.

create or replace function run_league_rollover(p_period date default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_promote_top     constant integer := 8;   -- matches promotion_cutoff in my_league()
  c_relegate_bottom constant integer := 8;   -- matches relegation_cutoff's width
  c_xp_league_top   constant integer := 120;

  v_period    date := coalesce(p_period, (date_trunc('month', now()) - interval '1 month')::date);
  v_min_order integer;
  v_max_order integer;
  v_updated   integer;
begin
  select min(sort_order), max(sort_order) into v_min_order, v_max_order from league_tiers;

  -- The bonus, first: read-only against league_members, so it does not
  -- interact with the tier update below. Guarded against a second run of the
  -- same period by checking whether this user already got one this calendar
  -- month (the job runs once, at the start of the month after `v_period`).
  insert into points_ledger (user_id, source, system, amount, awarded_at)
  select lm.user_id, 'league_top', 'xp', c_xp_league_top, now()
  from league_members lm
  join leagues l on l.id = lm.league_id
  where l.period = v_period
    and lm.points > 0
    and lm.points = (
      select max(lm2.points) from league_members lm2 where lm2.league_id = l.id
    )
    and not exists (
      select 1 from points_ledger pl
      where pl.user_id = lm.user_id and pl.source = 'league_top'
        and date_trunc('month', pl.awarded_at) = date_trunc('month', now())
    );

  with ranked as (
    select
      lm.user_id,
      l.tier,
      row_number() over (partition by l.id order by lm.points desc, lm.joined_at, lm.user_id) as rnk,
      count(*) over (partition by l.id) as division_size
    from league_members lm
    join leagues l on l.id = lm.league_id
    where l.period = v_period
  ),
  delta as (
    select
      r.user_id,
      t.sort_order + (case
        when r.rnk <= c_promote_top then 1
        when r.division_size > c_promote_top
             and r.rnk > r.division_size - c_relegate_bottom then -1
        else 0
      end) as target_order
    from ranked r
    join league_tiers t on t.key = r.tier
  ),
  clamped as (
    select user_id, least(greatest(target_order, v_min_order), v_max_order) as target_order
    from delta
  ),
  transitions as (
    select c.user_id, nt.key as new_tier
    from clamped c
    join league_tiers nt on nt.sort_order = c.target_order
  )
  update profiles p
     set league_tier = t.new_tier
    from transitions t
   where p.id = t.user_id
     and p.league_tier is distinct from t.new_tier;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function run_league_rollover(date) from public;

commit;
